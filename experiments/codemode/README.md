# REA Code Mode experiment

Frozen baseline: `fb94d9dde0ccda83ae520ac6fb22b1d283562cf3`, fetched from
`origin/main` on 2026-10-11. Branch: `experiment/codemode-bridge-20261011`.
This is a local experiment, not a change to the published CLI or MCP API.

The analyst question is whether composing REA's existing named tools in code
improves investigation efficiency enough to justify an optional bridge. Existing
users must keep their current names, input schemas, Evidence and session behavior.
Provider analysis settings must stay identical between comparison profiles.

The bridge owns one upstream stdio MCP connection and discovers its complete live
catalog. Only discovery and JavaScript execution are exposed downstream. Code
calls `tools.<original_name>(original_arguments)` and receives the original MCP
result envelope. REA still validates input, chooses providers, retains Evidence,
and owns analysis resources. There is no second tool implementation or schema
catalog to keep synchronized. A fresh QuickJS WASM context exposes only those
tool calls, JSON helpers and explicit output; it has no host filesystem, network,
process or module loader.

Start the bridge without changing an existing registration:

```bash
node bridge.mjs /absolute/path/to/node /absolute/path/to/rea/scripts/rea.mjs mcp
```

Register that command as a separate, temporary MCP server for a trial. Existing
REA registrations keep their original tools. `rea_search` accepts a query or exact
names; use `schemas: false` for the complete lightweight name/description list.
Query discovery returns names/descriptions by default; exact-name discovery
returns original input schemas and derived input/output TypeScript declarations.
These declarations help write code; they do not replace JSON validation contracts.
`schemas` explicitly overrides that choice.
Start with one domain word and request all selected exact names in one call.
Request `output_schemas: true` when a
result contract is needed; the original output schema is then returned unchanged.
`catalog_sha256` identifies the SDK catalog; it must not be substituted for REA's
`server_identity.catalog.digests` fields.
`rea_execute` accepts a JavaScript async function body. For example:

```js
const session = json(await tools.binary_session({})).result;
return { open: session.open, identity: session.server_identity };
```

The returned projection is not a new Evidence record. `calls` preserves operation,
argument/result digests, upstream errors and actual producer Evidence IDs when
provided, including original `evidence_links`. The upstream ledger retains complete original Evidence for later views
and exports. Non-Evidence session responses have no invented Evidence ID.
Calls and executions sharing one active target are serialized; `Promise.all`
currently provides composition rather than parallel provider execution.

`npm test` runs actual upstream and downstream stdio MCP against this checkout's
compiled runtime. The standalone experiment's twelve tests cover discovery parity,
original results/errors, bulk promise settlement, host capability absence, CPU
deadline recovery, retained Evidence after an error or provider timeout,
queued-call cancellation, unresolved promises and the
two-tool downstream boundary, guest heap exhaustion/reuse, and SDK-converted
schemas validated as [JSON Schema 2020-12](https://modelcontextprotocol.io/specification/2025-11-25/basic/index#schema-dialect).
Execution rejects delays above Node's signed 32-bit timer range instead of
allowing Node to coerce them to 1 ms. These tests do not establish real native/Android/
firmware provider behavior. A lifecycle regression revealed that the QuickJS job
pump can allocate an additional context: the execution scope now owns every
context at creation and releases them before the runtime. Increasing memory did
not fix that regression.

Install experimental dependencies separately with `npm ci` in this directory.
They do not change the production package or lockfile. Use the repository's pinned
Node and npm versions. No binary, provider database or raw third-party source is
committed. Corpus identities and upstream download locations are in `corpus.json`.

Measure three baselines: normal full-catalog MCP, discovery-only MCP, and Code
Mode. Count discovery, input code, intermediate results, final output, errors and
retries. Report actual wall time separately from model-facing turns and local
token estimates. Existing summary/page/workflow tools are fair alternatives;
do not manufacture a gain by forcing full output on the direct-tool baseline.
Replay measurements establish mechanism costs, not model task accuracy or
inference latency. Real-agent trials must additionally verify supported facts,
source identity, omissions and preserved Evidence references.

`benchmark.mjs` replays a fixed question against real providers with identical
original arguments. For example:

```bash
python3 resource-run.py -- node benchmark.mjs --artifact newpipe.apk \
  --mode bridge --artifact-root /absolute/path/artifacts \
  --providers /absolute/path/selected-provider-settings.json \
  --output /absolute/path/new-result-directory
```

Modes are `direct`, `discovery` and `bridge`. The discovery mode isolates catalog
cost while retaining original results; it is not a new production MCP client.
Raw responses remain outside Git. Result summaries separate complete envelopes
from single text content and count code explicitly. Measured findings and failures
are recorded in [results.md](results.md).

`--artifact obsidian.asar --workflow obsidian-inventory` asks a distinct package
inventory question using existing tools. It must not be compared as an equivalent
completion of the JavaScript AST question. Workflow names and original arguments
are retained in replay summaries.

`agent-trial.py` runs a real local Codex CLI with a disposable account/config and
one MCP registration. It copies authentication only, removes the profile on normal
completion, timeout and handled termination, and retains JSONL events, the answer
and measured API usage outside the repo.
It defaults to `gpt-5.6-terra` with high reasoning, as requested. Run one task under
the resource wrapper:

```bash
python3 resource-run.py -- python3 agent-trial.py \
  --mode direct --prompt /absolute/path/question.txt \
  --output /absolute/path/new-trial-directory
```

Reproducible questions are in [questions/](questions/). Supply a template with
`--prompt questions/android.txt --artifact-path /absolute/path/NewPipe_v0.29.1.apk`
(or another matching corpus target). The runner preserves the supplied path in
the rendered prompt and records template and rendered-prompt digests. Native's
entry-address seed is derived from this corpus's jq header and is not reusable
for another build. Run comparisons serially with the same question and provider
settings; retain failures as well as successful repetitions.

Use `--mode bridge` for the experimental server; `--mode client-code` requests
Codex's own Code Mode. Optional `--providers` selects a JSON object of explicit
provider settings. No ambient environment snapshot is retained. A configured flag
or a model's `tool_mode` does not prove the model actually composed tools or
filtered an intermediate result. Inspect the transcript, and mark accuracy as
unassessed until the requested facts and source support have been reviewed.
`grade-trial.py` checks Android (default), managed, native, firmware or
electron-inventory (`--task NAME`) against a successful
real-provider replay and verifies cited IDs in producer values, their original
Evidence links or the bridge audit. This verifies references observed in the
transcript; the grader does not resolve every cited payload. It accepts
JSON or one complete JSON fence, without repairing prose or partial values. This
checks requested producer facts and reference existence, not runtime behavior or
independent decompiler correctness. Unparseable result text is reported explicitly;
IDs in a truncated JSON fragment cannot satisfy the automated reference check.
The Android projection includes the provider's overload index, so a supported
signature with that field omitted fails this stronger assertion.
An omitted DEX descriptor differs from an explicit null, and booleans differ from
numeric counts. Native containing-procedure reports compare resolved identity;
the full analyzed procedure is verified separately.
Firmware's run-local region UUIDs remain in answers but are excluded from parity
against an independently acquired report. Classification evidence, explicit
unknowns and coverage remain part of the requested fact checks.
The question comparison accepts grouped original path records, extra known
coverage counts and explicitly named firmware length/coverage report fields.
Derived extent ends must agree with offset plus reported length. It verifies
engine version and executable digest rather than display capitalization; a manual
review is still needed for limitations and claims beyond these assertions.
Grades record the grader source digest, and earlier strict grades are retained
when the comparison changes. These are report parsers, not REA API aliases.

The completed serial cohort is in [agent-results.json](agent-results.json), with
source/configuration fingerprints, measured API usage and sampled cgroup stats.
The recommendation and migration boundaries are in [decision.md](decision.md).
Raw transcripts and original replay replies remain outside Git.

The supplied feedback is a research lead. Its Ghidra timing claim also changed
auto-analysis options, so it does not isolate Code Mode's effect. Relevant primary
sources: [Cloudflare Code Mode](https://blog.cloudflare.com/code-mode/),
[MCP patterns](https://developers.cloudflare.com/agents/model-context-protocol/codemode/),
[Anthropic code execution](https://www.anthropic.com/engineering/code-execution-with-mcp),
and [QuickJS WASM](https://github.com/justjake/quickjs-emscripten).

Run expensive commands with `python3 resource-run.py -- COMMAND ARGS...` on Linux
with a user systemd manager. It uses a transient scope with one CPU, a 4 GiB hard
memory ceiling, a 3 GiB early-stop threshold, no swap, and a task ceiling. It
refuses to start when less than 8 GiB is available and stops if host available
memory drops below 4 GiB. These limits protect the host; a resource abort is a
failed measurement, never a successful benchmark. Also cap Node and Java heaps.
The task ceiling is 192. The wrapper records observed memory/task events and
stops a trial that touches the task limit. A limit event invalidates a measurement
even when the application later returns successfully.
