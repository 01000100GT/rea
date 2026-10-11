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
`rea_execute` accepts a JavaScript async function body. For example:

```js
const session = json(await tools.binary_session({})).result;
return { open: session.open, identity: session.server_identity };
```

The returned projection is not a new Evidence record. `calls` preserves operation,
argument/result digests, upstream errors and actual producer Evidence IDs when
provided. The upstream ledger retains complete original Evidence for later views
and exports. Non-Evidence session responses have no invented Evidence ID.
Calls and executions sharing one active target are serialized; `Promise.all`
currently provides composition rather than parallel provider execution.

`npm test` runs actual upstream and downstream stdio MCP against this checkout's
compiled runtime. The standalone experiment's nine tests cover discovery parity,
original results/errors, bulk promise settlement, host capability absence, CPU
deadline recovery, retained Evidence after an error, unresolved promises and the
two-tool downstream boundary. These tests do not establish real native/Android/
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

`agent-trial.py` runs a real local Codex CLI with a disposable account/config and
one MCP registration. It copies authentication only, removes the profile on every
exit, and retains JSONL events, the answer and measured API usage outside the repo.
It defaults to `gpt-5.6-terra` with high reasoning, as requested. Run one task under
the resource wrapper:

```bash
python3 resource-run.py -- python3 agent-trial.py \
  --mode direct --prompt /absolute/path/question.txt \
  --output /absolute/path/new-trial-directory
```

Use `--mode bridge` for the experimental server; `--mode client-code` requests
Codex's own Code Mode. Optional `--providers` selects a JSON object of explicit
provider settings. No ambient environment snapshot is retained. A configured flag
or a model's `tool_mode` does not prove the model actually composed tools or
filtered an intermediate result. Inspect the transcript, and mark accuracy as
unassessed until the requested facts and source support have been reviewed.

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
