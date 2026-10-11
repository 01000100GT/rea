# Decision from the frozen Code Mode experiment

Keep REA's existing CLI/MCP contracts as the default. Improve Evidence-aware
workflow guidance and retain this two-tool bridge as an optional experiment.
The measured Codex profiles do not justify a broad API refactor or a default
switch to the external executor.

## What supports that choice

The [serial cohort](agent-results.json) contains sixteen real Codex CLI trials,
configured with `gpt-5.6-terra` high, across Android, managed PE/CLI, Electron ASAR
inventory, firmware and native Ghidra analysis. Twelve pass the strict requested
fact/reference checks. Two bridge managed answers omit the classification's
container field; two normal-MCP managed transcripts truncate a large producer
envelope, preventing complete-envelope verification of one cited ID. Their
remaining requested facts match the real-provider oracle. The complete-container
assertion is stronger than the question's general classification wording.

The bridge's Android repetitions take 48.231 and 134.555 seconds, compared with
67.329 and 71.624 for normal MCP. The faster bridge trial composes three original
operations once; the slower one performs seven original calls across five scripts.
The faster trial uses typed discovery; this does not make the model reliably
choose that workflow. Uncached input is lower in both bridge repetitions;
output and latency vary. This is not a stable overall efficiency win.

Managed bridge latency also varies, and its two answers omit the same field.
Firmware's one-operation question takes 81.944 seconds with the bridge versus
30.161 directly. Ghidra takes 334.642 versus 327.150 seconds, with sampled aggregate
CPU times of 271.096 and 263.738 seconds. The bridge performs three original
operations versus four directly, deriving containing identity from the analyzed
procedure. Native analysis cost remains dominant with unchanged default settings.

Obsidian inventory exposes a useful contract boundary: nested Evidence types leave
their normalized payload generic. The model initially returns the whole inventory
and repeats analysis. Giving both profiles the concrete manifest/occurrences
layout yields a single focused bridge workflow: 101994 total input tokens versus
263484 directly, but 40554 versus 41532 uncached tokens and 85.909 versus 67.540
seconds. Clear producer/layout guidance matters; total context compression alone
does not establish lower cost or latency. Cache pricing is not estimated here.

Deterministic replays demonstrate large projection savings across real providers.
They measure a known script, not the model's ability to discover and write it.
SQLite WASM fails the frozen WABT parser on an unpadded DataCount row; Obsidian's
full AST analysis times out with a retained partial reference. Inventory does not
replace AST analysis. Neither failure is counted as a Code Mode success.

## Migration scope

Current users retain original operation names, arguments, provider choices,
Evidence and session behavior. A client with equivalent execution support can use
the existing registration and focused workflows. The installed Codex transcript
does not expose its executor source, so its exact internal composition is unknown.

For clients that need the bridge, use a separate opt-in profile for an investigation.
The bridge owns one original REA connection and looks up live contracts by name.
Its session and Evidence ledger are separate from another REA registration; do
not mix target lifecycle calls or same-session IDs across those registrations.
Derived TypeScript assists code authoring; original JSON schemas remain available.
Original producer IDs, links, errors and partial-reference IDs survive auditing;
caller projections do not become new Evidence records.

The outer execution tool combines original effects and client requirements.
This prototype has not forwarded roots/elicitation/sampling or preserved a client's
per-original-operation approval flow. That capability boundary must be addressed
before offering it as a production replacement. The guest's lack of host IO does
not remove effects reachable through original REA tools.

An additive producer-description improvement explaining nested payload layout is
a smaller next candidate than changing names or inventing another workflow API.
Original inputs and output defaults should remain intact. Provider analysis
settings must be evaluated separately from discovery and projection improvements.

## Verification limits

These are descriptive samples with matching questions/provider settings per pair,
mode-specific instructions and model-selected arguments. They do not provide
confidence intervals, independent decompiler truth, Android/.NET runtime behavior,
full native-function coverage, complete firmware reconstruction or Windows/IDA
provider verification. Citations are checked against observed producer values and
links, not resolved individually after session exit.

Sixteen trials finish without sampled memory/task-limit events or resource aborts.
Their maximum sampled memory is 1659744256 bytes (about 1.55 GiB), with at most
126 tasks, under one CPU and a 4 GiB hard ceiling/3 GiB early stop. Copied profiles
are removed. Twelve actual stdio tests additionally cover cancellation, partial
Evidence readback, guest allocation failure/recovery, and advertised schema
validation. The earlier 2 GiB build-scope kill remains a documented failed build.
