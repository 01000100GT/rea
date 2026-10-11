import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import Ajv2020 from "ajv/dist/2020.js";
import { CodeModeBridge, connectUpstream, json } from "./bridge.mjs";

const entrypoint = fileURLToPath(
  new URL("../../scripts/rea.mjs", import.meta.url),
);
const fixture = fileURLToPath(
  new URL("../../tests/conformance/readiness/javascript-cli", import.meta.url),
);
const analysisArgs = {
  input_path: fixture,
  detail: "summary",
  max_heap_mb: 128,
};
let upstream;
let bridge;
before(async () => {
  upstream = await connectUpstream({
    command: process.execPath,
    args: [entrypoint, "mcp"],
    env: { ...process.env, REA_LOG_LEVEL: "silent" },
  });
  bridge = new CodeModeBridge(upstream);
});
after(async () => {
  await upstream?.close();
});

test("discovery preserves exact current REA schemas and names", async () => {
  const result = await bridge.search({
    names: ["binary_session"],
    output_schemas: true,
  });
  assert.equal(result.total_tools, upstream.catalog.length);
  const original = upstream.catalog.find(
    (tool) => tool.name === "binary_session",
  );
  const { typescript, output_typescript, ...discovered } = result.tools[0];
  assert.deepEqual(discovered, original);
  assert.match(typescript, /export interface BinarySession_Input/);
  assert.match(output_typescript, /export interface BinarySession_Output/);
  const inputOnly = await bridge.search({ names: ["binary_session"] });
  assert.deepEqual(inputOnly.tools[0].inputSchema, original.inputSchema);
  assert.equal(inputOnly.tools[0].outputSchema, undefined);
  assert.equal(inputOnly.tools[0].output_typescript, output_typescript);
  const all = await bridge.search({ schemas: false });
  assert.deepEqual(
    all.tools.map((tool) => tool.name),
    upstream.catalog.map((tool) => tool.name),
  );
  const query = await bridge.search({ query: "android" });
  assert.ok(query.tools.length > 0);
  assert.ok(query.tools.every((tool) => tool.inputSchema === undefined));
  const querySchemas = await bridge.search({ query: "android", schemas: true });
  assert.ok(querySchemas.tools.every((tool) => tool.inputSchema !== undefined));
  const outputRequested = await bridge.search({
    query: "android",
    output_schemas: true,
  });
  assert.ok(
    outputRequested.tools.every((tool) => tool.outputSchema !== undefined),
  );
  const missed = await bridge.search({
    query: "android impossible_query_word",
  });
  assert.equal(missed.matched_tools, 0);
  assert.ok(
    missed.suggestions.some((tool) => tool.name === "inspect_android_package"),
  );
  assert.ok(missed.suggestions.every((tool) => tool.inputSchema === undefined));
});

test("raw original result and parsed result survive a real MCP call", async () => {
  const result = await bridge.execute({
    code: "const r = await tools.binary_session({}); return {raw:r, parsed:json(r)};",
  });
  assert.equal(result.bridge_error, undefined);
  assert.deepEqual(json(result.value.raw), result.value.parsed);
  assert.equal(result.calls[0].name, "binary_session");
  assert.match(result.calls[0].result_sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.calls[0].is_error, false);
});

test("Promise.all calls settle in order without losing pending work", async () => {
  const result = await bridge.execute({
    code: "return await Promise.all([tools.binary_session({}), tools.binary_session({}), tools.binary_session({})]);",
  });
  assert.equal(result.bridge_error, undefined);
  assert.equal(result.value.length, 3);
  assert.equal(result.calls.length, 3);
  assert.ok(result.calls.every((call) => call.result_sha256));
});

test("upstream invalid-input result remains an original MCP error envelope", async () => {
  const args = {
    input_path: "/nonexistent/rea-codemode-artifact",
    detail: "summary",
  };
  const direct = await upstream.call("analyze_javascript_application", args);
  const result = await bridge.execute({
    code: `return await tools.analyze_javascript_application(${JSON.stringify(args)});`,
  });
  assert.equal(result.bridge_error, undefined);
  assert.equal(result.value.isError, true);
  assert.deepEqual(json(result.value).error, json(direct).error);
  assert.equal(result.calls[0].is_error, true);
});

test("guest has no Node, filesystem, fetch or module-loading capabilities", async () => {
  const result = await bridge.execute({
    code: "return [typeof process,typeof require,typeof fetch,typeof Deno,Function('return typeof process')()];",
  });
  assert.deepEqual(result.value, Array(5).fill("undefined"));
  const imported = await bridge.execute({
    code: "return await import('node:fs');",
  });
  assert.ok(imported.bridge_error);
});

test("CPU deadline interrupts runaway code and the next execution works", async () => {
  const result = await bridge.execute({
    code: "while(true) {}",
    timeout_ms: 20,
  });
  assert.ok(result.bridge_error);
  assert.deepEqual(result.calls, []);
  assert.equal((await bridge.execute({ code: "return 42;" })).value, 42);
});

test("guest allocation pressure fails within its heap budget and permits reuse", async () => {
  const result = await bridge.execute({
    code: "return new Array(1_000_000).fill('x');",
    memory_bytes: 2 * 1024 * 1024,
  });
  assert.match(result.bridge_error.message, /memory/i);
  assert.deepEqual(result.calls, []);
  assert.equal((await bridge.execute({ code: "return 42;" })).value, 42);
  assert.throws(() =>
    bridge.execute({ code: "return 1;", timeout_ms: 2_147_483_648 }),
  );
});

test("error after successful call preserves original Evidence reference", async () => {
  const result = await bridge.execute({
    code: `await tools.analyze_javascript_application(${JSON.stringify(analysisArgs)}); throw new Error('after-call');`,
  });
  assert.match(result.bridge_error.message, /after-call/);
  assert.ok(result.calls[0].evidence_id);
  assert.ok(result.calls[0].evidence_links.length > 0);
  const readback = await upstream.call("get_evidence_bundle", {
    detail: "summary",
  });
  assert.equal(readback.isError, undefined);
  assert.ok(
    JSON.stringify(json(readback)).includes(result.calls[0].evidence_id),
  );
  for (const evidence_id of result.calls[0].evidence_links) {
    const view = json(
      await upstream.call("inspect_analysis_view", {
        source: { kind: "retained-evidence", evidence_id },
        view: { kind: "summary" },
      }),
    );
    assert.equal(view.normalized_result.parent_evidence_id, evidence_id);
  }
});

test("provider timeout retains its actual partial Evidence reference", async () => {
  const result = await bridge.execute({
    code: `const reply = await tools.analyze_javascript_application(${JSON.stringify({ ...analysisArgs, analysis_timeout_ms: 1 })}); return json(reply);`,
  });
  const partial = result.value.error.details.partial_observation;
  assert.equal(partial.kind, "retained-evidence");
  assert.equal(result.calls[0].is_error, true);
  assert.equal(result.calls[0].partial_evidence_id, partial.evidence_id);
  const view = json(
    await upstream.call("inspect_analysis_view", {
      source: partial,
      view: { kind: "summary" },
    }),
  );
  assert.equal(view.normalized_result.parent_evidence_id, partial.evidence_id);
});

test("cancelling queued calls releases deferred handles and permits reuse", async () => {
  let callStarted;
  const started = new Promise((resolve) => {
    callStarted = resolve;
  });
  const cancelled = new AbortController();
  const controlled = new CodeModeBridge({
    catalog: upstream.catalog,
    async call(name, args, options) {
      const reply = await upstream.call(name, args, options);
      callStarted();
      // A controlled delivery delay after a real result makes the queued
      // cancellation deterministic, without simulating provider behavior.
      await new Promise((resolve) => setTimeout(resolve, 50));
      return reply;
    },
  });
  const execution = controlled.execute(
    {
      code: "return await Promise.all([tools.binary_session({}), tools.binary_session({})]);",
    },
    { signal: cancelled.signal },
  );
  await started;
  cancelled.abort(new Error("controlled queued cancellation"));
  const result = await execution;
  assert.ok(result.bridge_error);
  assert.equal(result.calls.length, 2);
  assert.match(
    result.calls[1].transport_error,
    /controlled queued cancellation/,
  );
  assert.equal((await controlled.execute({ code: "return 42;" })).value, 42);
});

test("a guest promise without any producer fails without hanging", async () => {
  const result = await bridge.execute({
    code: "return await new Promise(() => {});",
  });
  assert.match(result.bridge_error.message, /cannot progress/);
});

test("bridge's two tools are usable through actual downstream stdio MCP", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      fileURLToPath(new URL("./bridge.mjs", import.meta.url)),
      process.execPath,
      entrypoint,
      "mcp",
    ],
    env: { ...process.env, REA_LOG_LEVEL: "silent" },
    stderr: "inherit",
  });
  const client = new Client({ name: "codemode-boundary-test", version: "1" });
  try {
    await client.connect(transport);
    const catalog = await client.listTools();
    assert.deepEqual(
      catalog.tools.map((tool) => tool.name),
      ["rea_search", "rea_execute"],
    );
    const ajv = new Ajv2020({ strict: true });
    const byName = new Map(catalog.tools.map((tool) => [tool.name, tool]));
    for (const tool of catalog.tools) {
      assert.equal(
        tool.inputSchema.$schema ??
          "https://json-schema.org/draft/2020-12/schema",
        "https://json-schema.org/draft/2020-12/schema",
      );
      assert.equal(
        ajv.validateSchema(tool.inputSchema),
        true,
        ajv.errorsText(),
      );
    }
    const validate = ajv.compile(byName.get("rea_execute").inputSchema);
    assert.equal(
      validate({ code: "return 1;", timeout_ms: 2_147_483_647 }),
      true,
    );
    assert.equal(
      validate({ code: "return 1;", timeout_ms: 2_147_483_648 }),
      false,
    );
    assert.equal(
      validate({ code: "return 1;", memory_bytes: 128 * 1024 * 1024 + 1 }),
      false,
    );
    const found = json(
      await client.callTool({
        name: "rea_search",
        arguments: { names: ["binary_session"] },
      }),
    );
    assert.equal(found.matched_tools, 1);
    const result = json(
      await client.callTool({
        name: "rea_execute",
        arguments: {
          code: "return json(await tools.binary_session({}));",
        },
      }),
    );
    assert.equal(result.value.result.open, false);
    const invalid = await client.callTool({
      name: "rea_execute",
      arguments: { code: 7 },
    });
    assert.equal(invalid.isError, true);
    const oversized = await client.callTool({
      name: "rea_execute",
      arguments: { code: "return 1;", timeout_ms: 2_147_483_648 },
    });
    assert.equal(oversized.isError, true);
    const oversizedMemory = await client.callTool({
      name: "rea_execute",
      arguments: { code: "return 1;", memory_bytes: 128 * 1024 * 1024 + 1 },
    });
    assert.equal(oversizedMemory.isError, true);
  } finally {
    await client.close();
  }
});
