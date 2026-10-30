# Kacheri Court: proof-carrying code review (hackathon build)

Problem: AI code reviewers produce plausible findings nobody can check, so developers ignore them.
Rule: **no evidence, no finding.** Each accusation must come with an executable witness test that FAILS on the PR head and PASSES on the base, consistently (3 runs each). Everything else is dismissed automatically.

Pipeline (packages/court, owner claude):
1. Filing: Nemotron **Nano** (prosecutor, reasoning on, cheap, may run k=3 times in parallel at different temperatures) reads the diff plus the touched files and files Charges, each with witnessCode.
2. Trial: the engine checks out base and head into temporary detached worktrees, writes each witness at witnessPath, runs `witnessCommand` (default `node --test <file>`) 3x per side with a timeout. Admissible = head fails 3/3 and base passes 3/3. A witness that errors on base (bad test) is inadmissible.
3. Defense: Nemotron **Super** sees each admissible charge, its witness and the logs, and argues it is not a bug (e.g. the test asserts unspecified behaviour, or the change is intentional per the PR description) or concedes.
4. Ruling: Nemotron **Ultra** (reasoning on) gets the evidence log and rebuttals and rules convicted/dismissed per admissible charge. Inadmissible charges are dismissed without a model call.
5. Output: a CaseRecord (packages/shared) streamed as CourtEvents, plus a markdown verdict.

Baseline for the benchmark: one Nemotron Super call, "review this diff, list findings as JSON" (no evidence requirement). That is what most AI reviewers do.

Benchmark (packages/bench): injected bugs (mutants) that the target repo's OWN test suite does not catch, i.e. bugs that reach review. Measure per system: hit rate (finds the injected bug), false positives per PR, cost, latency.

LLM access (packages/llm): Nebius Token Factory, OpenAI-compatible, base `https://api.tokenfactory.nebius.com/v1/`, key in env `NEBIUS_API_KEY`. Replay mode so tests, CI and the hosted demo never need a key.
