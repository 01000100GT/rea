import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { compile } from "json-schema-to-typescript";
import { newQuickJSWASMModule, Scope } from "quickjs-emscripten";
import { z } from "zod";

const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const json = (reply) => {
  if (reply.structuredContent !== undefined) return reply.structuredContent;
  const texts = reply.content.filter((item) => item.type === "text");
  if (texts.length !== 1) throw new Error("Expected one REA JSON text block");
  return JSON.parse(texts[0].text);
};

/** One upstream session, original tool names, complete live catalog. */
export async function connectUpstream({
  command,
  args,
  env,
  stderr = "inherit",
}) {
  const transport = new StdioClientTransport({ command, args, env, stderr });
  const client = new Client({
    name: "rea-codemode-experiment",
    version: "0.0.0",
  });
  try {
    await client.connect(transport, { timeout: 60_000 });
    const catalog = [];
    let cursor;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      catalog.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    if (new Set(catalog.map((tool) => tool.name)).size !== catalog.length)
      throw new Error("Duplicate upstream tool names");
    return {
      client,
      catalog,
      call: (name, args, options) =>
        client.callTool({ name, arguments: args }, options),
      close: () => client.close(),
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}

export class CodeModeBridge {
  constructor(upstream) {
    this.upstream = upstream;
    this.byName = new Map(upstream.catalog.map((tool) => [tool.name, tool]));
    this.catalogDigest = digest(upstream.catalog);
    this.queue = Promise.resolve();
  }

  /** Search exposes original schemas and generated input types on demand. */
  async search({ query = "", names = [], schemas, output_schemas = false }) {
    const includeSchemas = schemas ?? (names.length > 0 || output_schemas);
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const selected = this.upstream.catalog.filter((tool) =>
      names.length
        ? names.includes(tool.name)
        : terms.every((term) =>
            `${tool.name} ${tool.description ?? ""}`
              .toLowerCase()
              .includes(term),
          ),
    );
    // Failed all-word searches keep their original semantics. Offer only the
    // best positive lexical matches as names, without expanding their schemas.
    const ranked =
      selected.length || !terms.length || names.length
        ? []
        : this.upstream.catalog.map((tool) => ({
            tool,
            score: terms.filter((term) =>
              `${tool.name} ${tool.description ?? ""}`
                .toLowerCase()
                .includes(term),
            ).length,
          }));
    const bestScore = Math.max(0, ...ranked.map((row) => row.score));
    const suggestions = ranked
      .filter((row) => row.score === bestScore && bestScore > 0)
      .map(({ tool }) => ({ name: tool.name, description: tool.description }));
    const tools = [];
    for (const tool of selected) {
      const inputType = includeSchemas
        ? await compile(tool.inputSchema, `${tool.name}_Input`, {
            bannerComment: "",
            format: false,
            unknownAny: true,
          })
        : undefined;
      tools.push(
        includeSchemas
          ? {
              ...tool,
              ...(!output_schemas ? { outputSchema: undefined } : {}),
              typescript: inputType,
            }
          : {
              name: tool.name,
              description: tool.description,
              annotations: tool.annotations,
            },
      );
    }
    return {
      catalog_sha256: this.catalogDigest,
      total_tools: this.byName.size,
      matched_tools: tools.length,
      tools,
      ...(suggestions.length ? { suggestions } : {}),
    };
  }

  /** Serialize scripts sharing the active target; no implicit batch races. */
  execute(input, options = {}) {
    const work = this.queue.then(() => this.run(input, options));
    this.queue = work.catch(() => undefined);
    return work;
  }

  async run(
    { code, timeout_ms = 120_000, memory_bytes = 128 * 1024 * 1024 },
    options,
  ) {
    const controller = new AbortController();
    const signal = options.signal
      ? AbortSignal.any([controller.signal, options.signal])
      : controller.signal;
    signal.throwIfAborted();
    const deadline = Date.now() + timeout_ms;
    const timer = setTimeout(
      () => controller.abort(new Error("Code Mode deadline exceeded")),
      timeout_ms,
    );
    const QuickJS = await newQuickJSWASMModule();
    const runtime = QuickJS.newRuntime();
    // Pending-job execution can create another context in the runtime.
    // Own contexts at creation, including those allocated by the job pump.
    const contexts = new Scope();
    const newContext = runtime.newContext.bind(runtime);
    runtime.newContext = (options) => contexts.manage(newContext(options));
    runtime.setMemoryLimit(memory_bytes);
    runtime.setMaxStackSize(1024 * 1024);
    runtime.setInterruptHandler(() => signal.aborted || Date.now() > deadline);
    const vm = runtime.newContext();
    const pending = new Set();
    const calls = [];
    let toolQueue = Promise.resolve();
    let finished = false;
    let promise;
    let value;
    let failure;
    const checkedEval = (source) => {
      const result = vm.evalCode(source);
      if (result.error) {
        const error = vm.dump(result.error);
        result.error.dispose();
        throw new Error(JSON.stringify(error));
      }
      return result.value;
    };
    const pump = () => {
      const result = runtime.executePendingJobs();
      if (result.error) {
        failure = vm.dump(result.error);
        result.error.dispose();
        finished = true;
      }
    };
    const fromJson = (data) =>
      checkedEval(`JSON.parse(${JSON.stringify(JSON.stringify(data))})`);
    const callHandle = vm.newFunction("call", (nameHandle, argumentsHandle) => {
      const name = vm.getString(nameHandle);
      const args = JSON.parse(vm.getString(argumentsHandle));
      if (!this.byName.has(name))
        throw new Error(`Unknown upstream tool: ${name}`);
      signal.throwIfAborted();
      const deferred = vm.newPromise();
      const audit = { name, arguments_sha256: digest(args) };
      calls.push(audit);
      const work = toolQueue.then(async () => {
        const started = performance.now();
        try {
          signal.throwIfAborted();
          const reply = await this.upstream.call(name, args, {
            signal,
            timeout: Math.max(1, deadline - Date.now()),
            onprogress: options.onprogress,
          });
          audit.elapsed_ms = performance.now() - started;
          audit.result_sha256 = digest(reply);
          audit.is_error = reply.isError === true;
          try {
            const record = json(reply);
            if (record.evidence_id) audit.evidence_id = record.evidence_id;
            const partial = record.error?.details?.partial_observation;
            if (partial?.kind === "retained-evidence")
              audit.partial_evidence_id = partial.evidence_id;
          } catch {
            /* Non-JSON MCP content is still preserved in reply. */
          }
          const handle = fromJson(reply);
          deferred.resolve(handle);
          handle.dispose();
        } catch (error) {
          audit.transport_error = error.message;
          const handle = fromJson({ name: error.name, message: error.message });
          deferred.reject(handle);
          handle.dispose();
        } finally {
          deferred.dispose();
          pump();
        }
      });
      const settled = work.catch((error) => {
        failure = { message: error.message };
        finished = true;
      });
      toolQueue = settled;
      pending.add(settled);
      void settled.then(() => pending.delete(settled));
      // The callback transfers its returned handle to QuickJS. Keep the
      // deferred's original host handle until settlement, with a separate
      // guest handle; otherwise bulk promise cleanup shares one lifetime.
      return deferred.handle.dup();
    });
    const doneHandle = vm.newFunction("done", (data) => {
      value = JSON.parse(vm.getString(data));
      finished = true;
    });
    const failHandle = vm.newFunction("fail", (error) => {
      failure = vm.dump(error);
      finished = true;
    });
    try {
      vm.setProp(vm.global, "__call", callHandle);
      vm.setProp(vm.global, "__done", doneHandle);
      vm.setProp(vm.global, "__fail", failHandle);
      checkedEval(`
        const tools = Object.freeze(Object.fromEntries(${JSON.stringify([...this.byName.keys()])}.map(
          name => [name, args => __call(name, JSON.stringify(args))]
        )));
        const json = reply => {
          if (reply.structuredContent !== undefined) return reply.structuredContent;
          const texts = reply.content.filter(item => item.type === 'text');
          if (texts.length !== 1) throw new Error('Expected one REA JSON text block');
          return JSON.parse(texts[0].text);
        };
      `).dispose();
      promise = checkedEval(`(async () => {\n${code}\n})().then(
        value => __done(JSON.stringify(value === undefined ? null : value)),
        error => __fail({name: error?.name, message: error?.message ?? String(error)})
      )`);
      pump();
      while (!finished && !signal.aborted) {
        if (pending.size) await Promise.race(pending);
        else
          throw new Error(
            "Guest promise cannot progress: no pending tool calls",
          );
        pump();
      }
      signal.throwIfAborted();
      if (calls.some((call) => !call.result_sha256 && !call.transport_error)) {
        controller.abort(
          new Error("Code returned before awaiting all tool calls"),
        );
        await Promise.allSettled(pending);
        failure = {
          message:
            "Code returned before awaiting all tool calls; calls were cancelled",
        };
      } else await Promise.allSettled(pending);
    } catch (error) {
      failure = { name: error.name, message: error.message };
      controller.abort(error);
      await Promise.allSettled(pending);
    } finally {
      clearTimeout(timer);
      promise?.dispose();
      callHandle.dispose();
      doneHandle.dispose();
      failHandle.dispose();
      contexts.dispose();
      runtime.dispose();
    }
    return {
      catalog_sha256: this.catalogDigest,
      calls,
      ...(failure ? { bridge_error: failure } : { value }),
    };
  }
}

export function createBridgeServer(bridge) {
  const server = new McpServer({
    name: "rea-codemode-experiment",
    version: "0.0.0",
  });
  const reply = (result) => ({
    content: [{ type: "text", text: JSON.stringify(result) }],
    ...(result.bridge_error ? { isError: true } : {}),
  });
  server.registerTool(
    "rea_search",
    {
      description:
        "Discover original REA tools. Start with one domain word, e.g. query=android; query words must all occur. Query/empty discovery defaults to names and descriptions. Then supply all selected exact names together to obtain original input schemas and TypeScript. schemas=true/false overrides this choice. Request output_schemas=true only when needed. catalog_sha256 hashes the SDK catalog, not REA server_identity.catalog.digests. Code calls tools.<name>(original_arguments); json(reply) parses the original MCP value.",
      inputSchema: z.strictObject({
        query: z.string().default(""),
        names: z.array(z.string()).default([]),
        schemas: z.boolean().optional(),
        output_schemas: z.boolean().default(false),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => reply(await bridge.search(input)),
  );
  server.registerTool(
    "rea_execute",
    {
      description:
        "Run a JavaScript async function body with tools.<original_REA_name>(original_arguments), json(reply) and return. Await every call. json(reply) returns the original REA value: Evidence has normalized_result, evidence_id and limitations; session values have result. Select the needed normalized_result fields inside code before returning them with Evidence IDs and limitations. One upstream session persists. Calls run in order, including Promise.all. All original REA effects, validation and retention apply; projections are caller selections, not new Evidence. No host IO or imports. Call audit and Evidence IDs survive script errors. Default deadline 120s and guest memory 128 MiB; use longer deadline for native analysis.",
      inputSchema: z.strictObject({
        code: z.string(),
        timeout_ms: z.number().int().positive().optional(),
        memory_bytes: z
          .number()
          .int()
          .positive()
          .max(128 * 1024 * 1024)
          .optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input, context) =>
      reply(
        await bridge.execute(input, {
          signal: context.mcpReq.signal,
          onprogress:
            context.mcpReq._meta?.progressToken === undefined
              ? undefined
              : (progress) =>
                  context.mcpReq.notify({
                    method: "notifications/progress",
                    params: {
                      ...progress,
                      progressToken: context.mcpReq._meta.progressToken,
                    },
                  }),
        }),
      ),
  );
  return server;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command) throw new Error("Usage: node bridge.mjs COMMAND [ARG...]");
  const upstream = await connectUpstream({ command, args, env: process.env });
  const server = createBridgeServer(new CodeModeBridge(upstream));
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await server.close();
    await upstream.close();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
  const transport = new StdioServerTransport();
  transport.onclose = () => void close();
  await server.connect(transport);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
