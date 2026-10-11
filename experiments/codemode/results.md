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
