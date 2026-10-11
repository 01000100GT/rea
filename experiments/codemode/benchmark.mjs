import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getEncoding } from "js-tiktoken";
import { CodeModeBridge, connectUpstream, json } from "./bridge.mjs";

// Replay isolates transport/discovery costs. It does not simulate model reasoning.
const workflows = {
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
      "search_procedures",
      "analyze_function",
      "close_binary",
    ],
    question:
      "Find jq_compile, analyze it and report its first 512 pseudocode units and caller/callee counts.",
    code: `
await call("open_binary", {path: input.path, provider_id: "ghidra"});
try {
  const found = await call("search_procedures", {pattern: "jq_compile", mode: "literal", case_sensitive: true});
  const fn = await call("analyze_function", {procedure: "jq_compile"});
  const n = fn.normalized_result;
  return {artifact_sha256: fn.subject?.digest.sha256,
    matches: found.normalized_result, procedure: n.procedure,
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
    mode: { type: "string", default: "direct" },
    "artifact-root": { type: "string" },
    providers: { type: "string" },
    output: { type: "string" },
  },
});
if (
  !workflows[values.artifact] ||
  !["direct", "discovery", "bridge"].includes(values.mode) ||
  !values["artifact-root"] ||
  !values.output
)
  throw new Error(
    "Use --artifact ID --mode direct|discovery|bridge --artifact-root ABS --output NEW_DIR [--providers JSON]",
  );
const experiment = dirname(fileURLToPath(import.meta.url));
const repository = resolve(experiment, "../..");
const corpus = JSON.parse(
  await readFile(resolve(experiment, "corpus.json"), "utf8"),
);
const artifact = corpus.artifacts.find((x) => x.id === values.artifact);
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
const workflow = workflows[values.artifact];
const input = { path: artifactPath };
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
  await upstream.close();
}
const catalogExposure = values.mode === "direct" ? upstream.catalog : discovery;
const summary = {
  scope: "deterministic_real_provider_replay_not_model_accuracy",
  baseline_sha: "fb94d9dde0ccda83ae520ac6fb22b1d283562cf3",
  artifact: artifact.id,
  artifact_sha256: sha256,
  mode: values.mode,
  question: workflow.question,
  startup_ms: connected - started,
  operation_ms: performance.now() - operationStarted,
  original_calls: records.map(({ reply: _reply, ...metadata }) => metadata),
  exposed_catalog: catalogExposure ? measure(catalogExposure) : null,
  execution_code: values.mode === "bridge" ? measure(code) : null,
  exposed_tool_results:
    values.mode === "bridge"
      ? [measure(bridgeReply)]
      : records.filter((x) => x.output).map((x) => x.output),
  projection: value,
  failure: failure ?? null,
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
    failure: summary.failure,
  }),
);
if (failure) process.exitCode = 1;
