# Preliminary measurements

These are real Codex CLI 0.161.0 trials on the frozen checkout, using
`gpt-5.6-terra`, high reasoning, one CPU and a guarded memory scope. The task
called `binary_session` once and requested open state and server identity. This
is a health probe, not an investigation benchmark. API input tokens are cumulative
across model steps; cached tokens are a subset, not an additional cost.

| Profile                            | Seconds | Input tokens | Cached input | Output tokens | Outcome                                                         |
| ---------------------------------- | ------: | -----------: | -----------: | ------------: | --------------------------------------------------------------- |
| Direct MCP                         |  47.635 |       103154 |        70656 |           940 | Correct closed state; identity omitted after preview truncation |
| Client Code Mode flag              |  67.345 |       197315 |       157696 |          1458 | Correct closed state; extra failed resource lookup              |
| Client Code Mode only flag         |  54.276 |       126609 |        84992 |           939 | Correct closed state; identity omitted                          |
| Bridge, original prompt            | 300.173 |  unavailable |  unavailable |   unavailable | Timeout before any completed tool call                          |
| Bridge, explicit projection prompt |  84.790 |       209248 |       175616 |          2125 | Correct closed state/version; conflated catalog identities      |

These prompts and flags do not establish a controlled comparison. The projection
trial used a more explicit prompt. The client trials expose nested original MCP
calls in their transcripts; the flags alone do not establish code composition or
intermediate-result filtering. The timeout is retained as a failed trial without
an attributed root cause.

The direct tool delivered the original session result, including package version
6.4.0 and REA's catalog digests. In the bridge projection trial the script selected
the nonexistent `server_identity.catalog.digest`, which JavaScript omitted. The
answer instead used the bridge's SDK catalog hash. That is not the requested REA
identity and must fail that factual check. No unsupported digest is used as an
oracle for subsequent trials.

Discovery was unnecessarily returning entire output schemas. For example, the
live `binary_session` output schema occupies 18039 compact JSON bytes, compared
with 859 for its input schema. `analyze_javascript_application` uses 41662 and
2863 bytes respectively. The complete SDK catalog contains 172 tools and 1986857
compact JSON bytes. The bridge now defaults to input schemas and makes unchanged
output schemas available explicitly. Actual model savings from this change remain
unmeasured.

The upstream/downstream stdio boundary suite passed all nine tests. The repository
typecheck and lint passed under a one-CPU resource scope with a sampled peak of
2934038528 bytes. A 2 GiB soft limit caused heavy reclaim during native TypeScript
checking; the wrapper's soft limit is now aligned with its 3 GiB early-stop
threshold. Its 4 GiB hard ceiling and host-available-memory checks remain in force.
An earlier cached-build attempt was killed inside its 2 GiB scope; that is a
failed build attempt, not evidence of a host OOM or a benchmark result.

## Real shipped artifacts

All acquired bytes match `corpus.json`; ShareX's archive also matches the GitHub
asset digest and SQLite's npm archive matches its published SHA-512 integrity.
No target was executed. These measurements use real REA providers and SDK stdio,
with the same analysis arguments in each compared profile.

NewPipe's direct, discovery-only replay and bridge replay produce equal selected
facts, including exact target digest, package/version, two MainActivity matches,
reported `onCreate` signature, overload index and unavailable DEX descriptor. The
bridge retains all three real producer IDs. Discovery-only here is a replay cost
decomposition, not an implemented new MCP client protocol.

| Replay delivery                                    | Discovery estimate | Intermediate/final result estimate |
| -------------------------------------------------- | -----------------: | ---------------------------------: |
| Direct: input definitions only, text content once  |             107076 |                              94945 |
| On-demand input definitions, original text content |                877 |                              94945 |
| On-demand definitions, one composed projection     |                877 |                               1057 |

The bridge also sends 290 estimated tokens of code. Estimates use `cl100k_base`;
they are not Terra API tokens, latency or model task success. The direct baseline
uses input definitions and single text content, avoiding an inflated comparison
against duplicated MCP envelopes or unused output schemas. The full SDK envelope
figures, where useful for local transport, are recorded separately.

ShareX's real PE/CLI metadata and native-boundary workflows agree across direct
and bridge: assembly ShareX 19.0.2.0, modern .NET, x86_64, framework
`.NETCoreApp,Version=v9.0`, declared native boundaries and explicit coverage.
Single text-content estimates are 204766 tokens for the two original results and
4148 for the bridge projection. No .NET runtime behavior was verified.

jq's original trial failed because the stripped shipped executable has no
`jq_compile` symbol. The corrected direct trial uses the observed ELF entry
`0x403a50`, resolves it to Ghidra's `entry` function and analyzes that function.
It succeeds with retained Evidence and a closed ephemeral provider session.
The corrected bridge returns identical selected facts and limitations. Its final
result estimate is 1544 tokens versus 10189 for direct single-text results, plus
1610 for discovery and 267 for code. This small entry function
does not establish large-function or complete native-analysis coverage.

OpenWrt's original direct trial returned `unreadable_output` without the expected
report. Twelve independent bounded Binwalk invocations produced reports. An
observer launcher and a subsequent unchanged real Binwalk bridge trial succeeded,
reporting uImage at offset 0 and SquashFS at 2741985 with `signature_scan` coverage.
The observer is a diagnostic with a different launcher identity, not a benchmark
baseline. The original failure remains unexplained. Subsequent direct and bridge
workflows agree on all region facts and coverage; random upstream region IDs vary
and are preserved. Single-text estimates are 1387 tokens direct and 827 projected,
so this one-operation task provides much less composition benefit than Android.

SQLite's actual WASM fails the frozen REA WABT output parser with `Unrecognized
WABT section row`. WABT 1.0.42 prints the nine-character DataCount label without
leading padding; the owning parser currently requires leading whitespace. No
downstream shim is used, and no successful WASM provider claim is made.
Obsidian's initial real-model analysis ended without Evidence after Codex's host
closed stdout. Its standalone SDK replay returns a real provider timeout with a
retained partial Evidence ID. This was observed before automatic partial-summary
recovery was added, so the transcript retains that reference but does not export
its payload. A source-fixture production-boundary test now verifies that provider
timeout IDs survive auditing and resolve through the retained-evidence view.
Neither failure is a Code Mode speedup.

## Real Android agents

After raising the task ceiling, a direct Terra trial completes in 107.478 seconds
with 348556 API input tokens (292608 cached), 1815 output tokens and five completed
MCP calls. All six strict producer-fact assertions and cited-ID checks pass. Its
sampled peak is 1349251072 bytes and 127 tasks, with zero observed limit events.

A client Code Mode trial passes the same assertions in 183.361 seconds with
414869 input tokens (372480 cached), 3618 output tokens. The transcript must still
be inspected before attributing native composition or filtering to that flag.

The bridge trial before explicit projection guidance takes 84.754 seconds,
292063 input tokens (244992 cached) and 1661 output tokens. It returns whole
Evidence instead of filtering most intermediates. Requested facts and IDs are
supported, but its stronger exact-projection check fails because overload index
was omitted. A clarified question explicitly requires that index in later trials.

The next bridge trial composes three calls and filters their results, but selects
`normalized_result.engine.artifact_sha256` as the target hash. This is the Jadx
bridge JAR identity, not the APK identity. The strict hash check fails. It takes
166.411 seconds and 324417 input tokens (279040 cached), 2362 output tokens.
This confirms a real provenance risk in model-written projections. Trial
instructions now identify `Evidence.subject.digest.sha256` explicitly. This
change has not yet established a reliable repeated model efficiency gain.

The following bridge trial passes all six assertions and cited-ID checks, using
one execution script for all three original operations. It takes 137.966 seconds,
190313 input tokens (156672 cached) and 1695 output tokens. Four discovery calls
precede the script. This is an encouraging token result, but its revised prompt,
instructions and concurrent host workload prevent a controlled speed comparison.
Instructions and prompt digests are now retained without authentication or an
ambient environment snapshot, so future equal-task repetitions can be audited.

The 6.1 sol diagnostic touched the 96-task limit; it is invalid as a comparison
and was interrupted, with its copied profile removed. The wrapper now allows 192
tasks, records task/memory limit events and rejects capacity-limited trials. A
real thread-creation probe hit exactly 192 tasks, was stopped with exit 125 and
retained its limit reason; it used about 12 MiB and caused no memory-limit event.
The nine actual stdio boundary tests pass after discovery changes.

Wall times above include contention on the same pinned CPU during exploratory
work and differing prompts/instructions. They cannot support a controlled speed
ratio. A reproducible efficiency conclusion requires successful equal-task trials
and serial repetitions with the strongest existing-client baseline.

The stronger client trial uses an explicit instruction to compose and project the
existing operations, and passes all six checks: 72.341 seconds, 161370 input
tokens (120576 cached), 1664 output tokens and three completed MCP calls. An
equivalent question with the bridge passes in 115.962 seconds, 321295 input tokens
(283648 cached), 2274 output tokens, five discovery calls and one execution. The
native transcript does not expose executor source, so exact internal composition
is unverified. Nevertheless, this measured client profile is a materially stronger
baseline than the original repeated-call trial. Total input, uncached input,
output and wall time must be considered separately; cached-token differences make
total input an incomplete cost metric.

This reverses the preliminary temptation to equate replay compression with the
best Codex experience. Existing client support with explicit Evidence-aware
recipes may be enough. An optional bridge needs to justify discovery overhead and
remains useful to test for clients without equivalent execution support.

Eleven actual SDK/stdio tests pass, including a controlled delivery delay after a
real upstream result to exercise queued cancellation. Both the delayed call and
its queued successor release deferred guest handles before runtime disposal.
This test does not simulate or establish new provider behavior.

The bridge remains an experiment and has not changed any published REA contract.

## Existing-client and managed follow-up

The same Android v3 question with normal MCP, without the experimental Code Mode
feature flags, passes all six fact assertions and reference checks: 75.117 seconds,
103471 API input tokens (73728 cached), 1538 output tokens and three original MCP
calls. This is the strongest measured Android baseline so far. Its wall time also
includes a short boundary-test overlap, so it is not a controlled latency ratio.
The installed model catalog requests code-mode-only tool delivery; flag settings
and nested MCP events alone cannot establish the internal executor's behavior.

The first real ShareX managed-agent comparison uses the same question with Terra
high and identical provider settings. Normal MCP takes 81.578 seconds, 217573 input
tokens (186368 cached), 2647 output tokens and two original calls. The bridge takes
96.930 seconds, 218089 input tokens (155904 cached), 3247 output tokens, four
searches and two executions. Its first script uses an expression instead of the
required async-body `return`, yielding no projection; it repeats both operations.
Query discovery now defaults to lightweight names/descriptions, while exact-name
discovery supplies input schemas. This run still requested full output schemas
individually and therefore does not establish an efficiency gain from that change.

Both answers match all seven requested managed fact groups, including exact target
SHA-256, assembly/module identities, classification evidence, framework, declared
ModuleRef/PInvoke arrays and coverage. Those empty arrays concern ShareX.dll only.
The bridge passes cited-reference verification. Codex truncated the original
managed-artifact response in its normal-MCP JSONL at roughly one MiB, leaving an
invalid JSON fragment; the automated grader cannot validate that one reference
from a complete producer envelope. Its reference-failure result is retained,
despite the matching ID being visible in the transcript prefix and replay. This
is a verification limitation, not a demonstrated fabricated ID.

The runner now handles SIGTERM so copied trial credentials are removed during a
resource abort. A controlled non-model launcher received owned-scope SIGTERM,
exited 143 and left no trial profile while preserving the dummy source auth file.
This verifies credential cleanup only. The eleven actual stdio tests pass after
the adaptive discovery change, with a sampled peak of 1365106688 bytes, 42 tasks
and zero observed memory/task limit events.

## Serial comparison and package inventory

A serial Android v3 pair, without concurrent provider/build work, passes every
fact and cited-reference check. Normal MCP uses 56.962 seconds, 105861 input
(75776 cached, 30085 uncached), 1106 output tokens and three original calls. The
adaptive-discovery bridge uses 106.134 seconds, 200537 input (175872 cached,
24665 uncached), 2177 output tokens, four searches and one execution. Its smaller
uncached input does not imply lower overall cost: output, cache rates and latency
also matter. It still requests original output schemas and mistakenly searches
for the already exposed bridge executor. Sampled memory peaks are 1333710848 and
1656098816 bytes respectively; neither run touches memory/task limits. One pair
is insufficient for a statistical latency or reliability claim.

A separate Obsidian package-inventory replay succeeds with existing REA tools.
Direct and bridge return byte-for-byte equal selected facts: 397 graph nodes and
occurrences, 369 files, 28 directories, root main.js/package.json occurrences,
no root preload.js, no observed integrity contradiction, complete-within-substeps
coverage and an explicit unexplored JavaScript analysis branch. Both original
Evidence IDs are preserved. Direct/bridge operations take 6.267/6.618 seconds;
original single-text results total 178958 estimated tokens versus a 1404-token
bridge result, 1305 for discovery and 322 for code. These are replay estimates,
not model latency or success. Inventory does not complete the timed-out AST task.

An output-type discovery probe compiles seven real SDK schemas successfully.
Derived TypeScript estimates are 784/719/751 tokens for Android package/search/
class, 1558/1420 for managed artifact/native boundaries, 1264 for artifact inventory
and 2289 for function analysis. Their original JSON schemas use 1666/1480/1576,
3524/2932, 2812 and 5091 respectively. These declarations describe code values;
they do not preserve every JSON Schema validation rule. Exact-name discovery now
includes them without replacing explicitly requested original JSON schemas. Real
model benefit from this addition remains to be tested. The audit also carries
original Evidence links; a real retained-view readback verifies linked IDs rather
than trusting references invented by a projection.

The output-declaration boundary suite first failed its type-name assertion because
the compiler preferred the schema's URN identity as a display name. The derived
compilation now supplies a descriptive title while returning the original schema
unchanged. All eleven tests then pass, including original-link readback, at a
sampled peak of 1399996416 bytes and zero observed limit events. Declarations are
cached per exact tool name for this immutable live-catalog connection; repeated
discovery does not regenerate them. No provider implementation or published
REA API has changed.

## Typed-discovery serial agent checkpoint

All rows below use real Codex CLI 0.161.0, Terra high, the same rendered question
within each pair, and the same provider settings. The bridge/runtime/runner source
fingerprints match commit `22326e819`; model-written original arguments can differ.
Comparisons include required mode-specific instructions and are not a controlled
causal decomposition of inference, caching and provider time.

| Case               | Profile | Wall seconds |  Input | Cached | Uncached | Output | MCP calls | Fact/reference check              |
| ------------------ | ------- | -----------: | -----: | -----: | -------: | -----: | --------: | --------------------------------- |
| android            | direct  |       67.329 | 107007 |  83712 |    23295 |   1670 |         3 | pass                              |
| android            | bridge  |       48.231 | 113256 |  91648 |    21608 |   1456 |         3 | pass                              |
| managed            | bridge  |       73.145 | 116974 |  92672 |    24302 |   2065 |         3 | classification field omitted      |
| managed            | direct  |        33.15 | 108096 |  75776 |    32320 |   2315 |         2 | facts match; reference unverified |
| electron-inventory | direct  |       89.494 | 266121 | 238848 |    27273 |   3215 |         3 | pass                              |
| electron-inventory | bridge  |      145.577 | 462809 | 407040 |    55769 |   5624 |         8 | pass                              |
| firmware           | bridge  |       81.944 | 152886 | 126976 |    25910 |   2192 |         3 | pass                              |
| firmware           | direct  |       30.161 | 103224 |  74752 |    28472 |   1761 |         1 | pass                              |

The managed bridge omits the producer classification container field (`pe`) while
preserving status/runtime/implementation/architecture and all classification
evidence. Its strict complete-classification assertion fails; this is an omission,
not an incorrect architecture claim. Normal MCP matches requested facts but its
large-result JSONL truncation again prevents automated verification of one ID.

The initial grader treated grouped path records, extra known coverage counts and
an empty per-source contradiction object as mismatches. Task-specific comparison
now accepts those lossless report forms. Firmware compares observed offset/length
facts, checks any supplied derived end arithmetically, and verifies engine version
and executable digest. Run-local UUIDs and differently named display fields are
not compared as if they were stable source identity. Original strict grades and
pre-equivalence grades remain outside Git, and new grades include a grader digest.
These report-format comparisons do not add aliases to any REA tool contract.

Obsidian bridge discovery takes six searches and two executions. The first returns
the entire nested inventory; the second repeats it and computes a focused answer.
The live nested Evidence schema describes normalized_result as generic JSON, so
derived types alone cannot teach its concrete manifest/occurrences layout. Its
recursive record walk happens to match this corpus, but format-specific field
selection is the stronger recipe. Both model profiles choose record-and-continue
for integrity; deterministic inventory replays used fail. No contradictions were
observed, and the exact caller-selected arguments are retained.

## Completed serial cohort

The final sixteen-row cohort, raw-event digests, exact runner/bridge/lockfile
fingerprints, prompt/instruction/provider digests and sampled resource stats are
in [agent-results.json](agent-results.json). The requested model configuration is
Terra high. Two managed bridge answers omit the classification container field
under the stronger full-object check; two normal-MCP managed logs have a truncated
producer envelope. The twelve other rows pass requested fact and observed-reference
checks. This is producer parity, not independent runtime truth or a per-fact
citation-association proof. Earlier stricter report-form grades remain retained.

| Trial                              | Wall seconds |  Input | Cached | Uncached | Output | MCP calls | Check                             |
| ---------------------------------- | -----------: | -----: | -----: | -------: | -----: | --------: | --------------------------------- |
| android-direct-5                   |       67.329 | 107007 |  83712 |    23295 |   1670 |         3 | pass                              |
| android-bridge-7                   |       48.231 | 113256 |  91648 |    21608 |   1456 |         3 | pass                              |
| managed-bridge-2                   |       73.145 | 116974 |  92672 |    24302 |   2065 |         3 | classification container omitted  |
| managed-direct-2                   |       33.150 | 108096 |  75776 |    32320 |   2315 |         2 | facts match; reference unverified |
| electron-inventory-direct-1        |       89.494 | 266121 | 238848 |    27273 |   3215 |         3 | pass                              |
| electron-inventory-bridge-1        |      145.577 | 462809 | 407040 |    55769 |   5624 |         8 | pass                              |
| firmware-bridge-1                  |       81.944 | 152886 | 126976 |    25910 |   2192 |         3 | pass                              |
| firmware-direct-1                  |       30.161 | 103224 |  74752 |    28472 |   1761 |         1 | pass                              |
| native-direct-1                    |      327.150 | 151343 | 122368 |    28975 |   2458 |         4 | pass                              |
| native-bridge-1                    |      334.642 | 285961 | 245504 |    40457 |   2129 |         4 | pass                              |
| android-bridge-8                   |      134.555 | 159370 | 134400 |    24970 |   3250 |         7 | pass                              |
| android-direct-6                   |       71.624 | 153031 | 117504 |    35527 |   1501 |         3 | pass                              |
| managed-direct-3                   |       75.229 | 108593 |  75776 |    32817 |   2774 |         2 | facts match; reference unverified |
| managed-bridge-3                   |       40.609 | 125519 |  96000 |    29519 |   2274 |         3 | classification container omitted  |
| electron-inventory-guided-bridge-1 |       85.909 | 101994 |  61440 |    40554 |   2563 |         3 | pass                              |
| electron-inventory-guided-direct-1 |       67.540 | 263484 | 221952 |    41532 |   2499 |         4 | pass                              |

Ghidra's aggregate sampled CPU time is 263.738 seconds directly and 271.096 with
the bridge. The bridge uses three original operations versus four directly,
obtaining containing identity from the analyzed procedure. Both close the session
successfully. The native comparison uses the same default analysis settings;
these data do not establish a meaningful native speedup.

The second Android bridge repetition completes seven original calls across five
scripts, without tool errors, before its final composed answer. Its 134.555-second
result reverses the first repetition's latency advantage. The model did not
reliably choose one composed execution even with explicit guidance. Uncached
input is lower in both bridge repetitions, while output and latency vary.

The guided Electron question explicitly names the existing operations and the
nested inventory's manifest/occurrences layout for both profiles. Both pass, with
integrity_policy=fail. The bridge composes open/inspect/close once; the normal-MCP
profile repeats inspect_artifact. The total-input reduction from 263484 to 101994
is large, but uncached input differs by only 978 tokens and bridge latency is
higher. Earlier non-guided profiles are a different question and cannot support
a causal prompt-improvement ratio. Unknown nested payload types remain an observed
contract-discovery problem; caller-selected values and identities are preserved.

All sixteen runs stay below memory/task ceilings, with maximum sampled memory
1659744256 bytes and 126 tasks; no observed memory/task limit event or resource
abort occurs. Copied profile count is zero at completion. Runtime measurements
belong to the recorded source fingerprint at 22326e819; subsequent timer-range
validation and test-only Ajv installation are not new model measurements.

Final boundary verification passes twelve actual SDK/stdio tests. A 2 MiB guest
budget rejects allocation pressure and the next execution succeeds. This is a
guest-budget failure, not an OS OOM or provider behavior claim. A local pinned-Node
probe shows a 2147483648-ms timeout becomes 1 ms; the owning named execution
contract now rejects that range before allocation. After SDK conversion, both
advertised bridge input schemas validate under JSON Schema 2020-12, and the actual
stdio client rejects invalid code, oversized memory and timer values. Sampled
suite memory peaks at 1387433984 bytes, with zero observed memory/task limit events.

See [decision.md](decision.md) for the recommendation: keep current REA contracts,
improve focused Evidence-aware workflow guidance, and retain the bridge as an
opt-in candidate. A broad default switch is not justified by these samples.
