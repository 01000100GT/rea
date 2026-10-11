import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getEncoding } from "js-tiktoken";
import { CodeModeBridge, connectUpstream, json } from "./bridge.mjs";

// Replay isolates transport/discovery costs. It does not simulate model reasoning.
const workflows = {
  "sharex.dll": {
    tools: ["inspect_managed_artifact", "inspect_managed_native_boundaries"],
    question:
      "Report assembly/module identity, target framework and declared P/Invoke libraries with their uncertainty.",
    code: `
const artifact = await call("inspect_managed_artifact", {path: input.path});
const boundaries = await call("inspect_managed_native_boundaries", {});
const n = artifact.normalized_result;
return {artifact_sha256: artifact.subject?.digest.sha256,
  classification: n.classification, assembly: n.assembly, module: n.module,
  target_frameworks: n.target_frameworks, coverage: n.coverage,
  native_boundaries: boundaries.normalized_result,
  evidence_ids: [artifact.evidence_id, boundaries.evidence_id],
  limitations: [...artifact.limitations, ...boundaries.limitations]};`,
  },
  "sqlite.wasm": {
    tools: ["inspect_wasm_artifact"],
    question:
      "Report exact WASM validation, all exported names and runtime/network observation states without executing it.",
    code: `
const wasm = await call("inspect_wasm_artifact", {path: input.path});
const n = wasm.normalized_result;
return {artifact_sha256: wasm.subject?.digest.sha256,
  validation: n.validation, sections: n.sections, exports: n.exports,
  runtime_execution: n.runtime_execution, network_fetch: n.network_fetch,
  evidence_ids: [wasm.evidence_id], limitations: [...wasm.limitations, ...n.limitations]};`,
  },
  "obsidian.asar": {
    tools: ["analyze_javascript_application", "inspect_analysis_view"],
    question:
      "Report application identity, analysis coverage/counts and the first eight module identities.",
    code: `
const summary = await call("analyze_javascript_application", {
  input_path: input.path, detail: "summary", max_heap_mb: 1024,
  analysis_timeout_ms: 300000, integrity_policy: "fail"
});
const parent = summary.normalized_result.parent_evidence_id;
const page = await call("inspect_analysis_view", {
  source: {kind: "retained-evidence", evidence_id: parent},
  view: {kind: "page", collection: "modules", offset: 0, limit: 8}
});
return {artifact_sha256: summary.subject?.digest.sha256,
  summary: summary.normalized_result, modules: page.normalized_result,
  evidence_ids: [summary.evidence_id, parent, page.evidence_id],
  limitations: [...summary.limitations, ...page.limitations]};`,
  },
  "obsidian-inventory": {
    artifact: "obsidian.asar",
    tools: ["open_binary", "inspect_artifact", "close_binary"],
    question:
      "Report ASAR identity, complete inventory manifest, entry-kind counts, root package/main/preload occurrences, integrity contradictions and inventory coverage; do not claim AST or runtime analysis.",
    code: `
await call("open_binary", {path: input.path});
try {
  const inspected = await call("inspect_artifact", {integrity_policy: "fail"});
  const n = inspected.normalized_result;
  const inventory = n.substeps.find(x => x.operation === "inventory_artifact").evidence;
  const graph = inventory.normalized_result;
  const counts = {};
  for (const row of graph.occurrences)
    counts[row.entry_kind] = (counts[row.entry_kind] ?? 0) + 1;
  return {artifact_sha256: inspected.subject.digest.sha256,
    manifest: graph.manifest, entry_kind_counts: counts,
    requested_paths: graph.occurrences.filter(x => ["package.json", "main.js", "preload.js"].includes(x.logical_path)),
    integrity_contradictions: graph.integrity_contradictions,
    coverage: n.coverage, unexplored_branches: n.unexplored_branches,
    evidence_ids: [inspected.evidence_id, inventory.evidence_id],
    limitations: [...inspected.limitations, ...n.limitations, ...inventory.limitations]};
} finally { await call("close_binary", {}); }`,
  },
  "newpipe.apk": {
    tools: [
      "inspect_android_package",
      "search_android_classes",
      "inspect_android_class",
    ],
    question:
      "Report package/version, exact MainActivity matches and its onCreate method descriptors.",
    code: `
const pkg = await call("inspect_android_package", {path: input.path});
const found = await call("search_android_classes", {path: input.path, query: "MainActivity"});
if (!found.normalized_result.matches.includes("org.schabi.newpipe.MainActivity"))
  throw new Error("Requested shipped MainActivity was not found");
const cls = await call("inspect_android_class", {
  path: input.path, class_name: "org.schabi.newpipe.MainActivity"
});
return {artifact_sha256: pkg.subject?.digest.sha256,
  package_name: pkg.normalized_result.package_name,
  version_name: pkg.normalized_result.version_name,
  version_code: pkg.normalized_result.version_code,
  matches: found.normalized_result.matches, coverage: found.normalized_result.coverage,
  onCreate: cls.normalized_result.methods.filter(x => x.name === "onCreate"),
  evidence_ids: [pkg.evidence_id, found.evidence_id, cls.evidence_id],
  limitations: [...pkg.limitations, ...found.limitations, ...cls.limitations]};`,
  },
  "openwrt.bin": {
    tools: ["inspect_firmware_regions"],
    question:
      "Report firmware identity, every reported region offset/signature and examined coverage.",
    code: `
const inspected = await call("inspect_firmware_regions", {path: input.path});
return {artifact_sha256: inspected.subject?.digest.sha256,
  result: inspected.normalized_result, evidence_ids: [inspected.evidence_id],
  limitations: inspected.limitations};`,
  },
  jq: {
    tools: [
      "open_binary",
      "resolve_containing_procedure",
      "analyze_function",
      "close_binary",
    ],
    question:
      "Resolve the observed ELF entry address and report the recovered function's first 512 pseudocode units and caller/callee counts.",
    code: `
await call("open_binary", {path: input.path, provider_id: "ghidra"});
try {
  const found = await call("resolve_containing_procedure", {address: input.entry_address});
  const fn = await call("analyze_function", {procedure: input.entry_address});
  const n = fn.normalized_result;
  return {artifact_sha256: fn.subject?.digest.sha256,
    entry_address: input.entry_address, containing_procedure: found.normalized_result, procedure: n.procedure,
    pseudocode_prefix: n.pseudocode.slice(0, 512),
    caller_count: n.callers.length, callee_count: n.callees.length,
    evidence_ids: [found.evidence_id, fn.evidence_id],
    limitations: [...found.limitations, ...fn.limitations, ...n.limitations]};
} finally { await call("close_binary", {}); }`,
  },
};

const { values } = parseArgs({
  options: {
    artifact: { type: "string" },
    workflow: { type: "string" },
    mode: { type: "string", default: "direct" },
    "artifact-root": { type: "string" },
    providers: { type: "string" },
    output: { type: "string" },
  },
});
if (
  !workflows[values.workflow ?? values.artifact] ||
  !["direct", "discovery", "bridge"].includes(values.mode) ||
  !values["artifact-root"] ||
  !values.output
)
  throw new Error(
    "Use --artifact ID [--workflow NAME] --mode direct|discovery|bridge --artifact-root ABS --output NEW_DIR [--providers JSON]",
  );
const experiment = dirname(fileURLToPath(import.meta.url));
const repository = resolve(experiment, "../..");
const corpus = JSON.parse(
  await readFile(resolve(experiment, "corpus.json"), "utf8"),
);
const artifact = corpus.artifacts.find((x) => x.id === values.artifact);
const workflowName = values.workflow ?? values.artifact;
const workflow = workflows[workflowName];
if (!artifact || artifact.id !== (workflow.artifact ?? workflowName))
  throw new Error(
    "Selected workflow does not match the frozen corpus artifact",
  );
const artifactPath = resolve(values["artifact-root"], artifact.file);
const bytes = await readFile(artifactPath);
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (sha256 !== artifact.sha256 || bytes.length !== artifact.bytes)
  throw new Error("Artifact identity differs from frozen corpus");
await mkdir(values.output, { recursive: false, mode: 0o700 });
const encoding = getEncoding("cl100k_base");
const measure = (value) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return {
    bytes: Buffer.byteLength(text),
    cl100k_estimated_tokens: encoding.encode(text).length,
  };
};
const modelText = (reply) =>
  reply.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
const environment = values.providers
  ? JSON.parse(await readFile(values.providers, "utf8"))
  : {};
const started = performance.now();
const upstream = await connectUpstream({
  command: process.execPath,
  args: [resolve(repository, "scripts/rea.mjs"), "mcp"],
  env: environment,
});
const connected = performance.now();
const records = [];
const realCall = upstream.call;
upstream.call = async (name, args, options) => {
  const began = performance.now();
  try {
    const reply = await realCall(name, args, { timeout: 600_000, ...options });
    const parsed = json(reply);
    records.push({
      name,
      arguments: args,
      elapsed_ms: performance.now() - began,
      is_error: reply.isError === true,
      input: measure(args),
      output: measure(reply),
      text_output: measure(modelText(reply)),
      evidence_id: parsed.evidence_id,
      reply,
    });
    return reply;
  } catch (error) {
    records.push({
      name,
      arguments: args,
      elapsed_ms: performance.now() - began,
      failure: String(error),
      input: measure(args),
    });
    throw error;
  }
};
const bridge = new CodeModeBridge(upstream);
const input = { path: artifactPath };
if (artifact.id === "jq") {
  if (bytes.subarray(0, 6).toString("hex") !== "7f454c460201")
    throw new Error("Expected ELF64 little-endian header for entry seed");
  input.entry_address = `0x${bytes.readBigUInt64LE(24).toString(16)}`;
}
const code = `const input = ${JSON.stringify(input)};
async function call(name, args) {
  const reply = await tools[name](args);
  const parsed = json(reply);
  if (reply.isError) throw new Error(JSON.stringify(parsed));
  return parsed;
}
${workflow.code}`;
let discovery;
let value;
let failure;
let bridgeReply;
const recovery = [];
const operationStarted = performance.now();
try {
  if (values.mode !== "direct")
    discovery = await bridge.search({ names: workflow.tools });
  if (values.mode === "bridge") {
    bridgeReply = await bridge.execute({ code, timeout_ms: 900_000 });
    value = bridgeReply.value;
    failure = bridgeReply.bridge_error;
  } else {
    const tools = Object.fromEntries(
      upstream.catalog.map((tool) => [
        tool.name,
        (args) => upstream.call(tool.name, args),
      ]),
    );
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    value = await new AsyncFunction("tools", "json", code)(tools, json);
  }
} catch (error) {
  failure = String(error);
} finally {
  const partials = new Set(
    records.flatMap((record) => {
      if (!record.reply?.isError) return [];
      try {
        const partial = json(record.reply).error?.details?.partial_observation;
        return partial?.kind === "retained-evidence"
          ? [partial.evidence_id]
          : [];
      } catch {
        return []; // Preserve non-JSON failures in calls.json, without inventing IDs.
      }
    }),
  );
  for (const evidence_id of partials) {
    // Capture already retained partial facts before disposing the replay session.
    // Recovery is not a successful completion of the failed analyst workflow.
    try {
      const reply = await realCall(
        "inspect_analysis_view",
        {
          source: { kind: "retained-evidence", evidence_id },
          view: { kind: "summary" },
        },
        { timeout: 60_000 },
      );
      recovery.push({ parent_evidence_id: evidence_id, reply });
    } catch (error) {
      recovery.push({
        parent_evidence_id: evidence_id,
        failure: String(error),
      });
    }
  }
  await upstream.close();
}
const catalogExposure = values.mode === "direct" ? upstream.catalog : discovery;
const summary = {
  scope: "deterministic_real_provider_replay_not_model_accuracy",
  baseline_sha: "fb94d9dde0ccda83ae520ac6fb22b1d283562cf3",
  artifact: artifact.id,
  workflow: workflowName,
  artifact_sha256: sha256,
  mode: values.mode,
  question: workflow.question,
  startup_ms: connected - started,
  operation_ms: performance.now() - operationStarted,
  original_calls: records.map(({ reply: _reply, ...metadata }) => metadata),
  exposed_catalog: catalogExposure ? measure(catalogExposure) : null,
  direct_input_definitions: measure(
    upstream.catalog.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  ),
  execution_code: values.mode === "bridge" ? measure(code) : null,
  exposed_tool_results:
    values.mode === "bridge"
      ? [measure(bridgeReply)]
      : records.filter((x) => x.output).map((x) => x.output),
  exposed_text_results:
    values.mode === "bridge"
      ? [measure(bridgeReply)]
      : records.filter((x) => x.text_output).map((x) => x.text_output),
  projection: value,
  failure: failure ?? null,
  partial_recovery: recovery,
  correctness: failure
    ? "failed_workflow"
    : "requires_cross_profile_fact_review",
  estimator:
    "cl100k_base_compact_MCP_JSON_including_envelope_not_actual_model_tokens",
};
await writeFile(
  resolve(values.output, "summary.json"),
  JSON.stringify(summary, null, 2),
);
await writeFile(resolve(values.output, "calls.json"), JSON.stringify(records));
await writeFile(resolve(values.output, "code.js"), code);
console.log(
  JSON.stringify({
    artifact: artifact.id,
    mode: values.mode,
    calls: records.length,
    startup_ms: summary.startup_ms,
    operation_ms: summary.operation_ms,
    failure: summary.failure
      ? String(
          typeof summary.failure === "object"
            ? summary.failure.message
            : summary.failure,
        ).slice(0, 1000)
      : null,
  }),
);
if (failure) process.exitCode = 1;
