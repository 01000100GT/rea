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

Real shipped-artifact investigations and provider parity are still unverified.
The bridge is an experiment and has not changed any published REA contract.
