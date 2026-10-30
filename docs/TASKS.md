# Tasks and ownership (Court build)

Contracts: `packages/shared/src/index.ts` (owner claude, do NOT edit; request changes under ISSUES). Spec: docs/COURT.md.
Only edit your owned paths. Add deps to your own package.json. Root config is claude's.

| ID | Owner | Paths | Deliverable | Reviewer |
|---|---|---|---|---|
| T1-T5 | done | git-engine, jury, daemon, web (orchestrator v1) | merged | done |
| T6 | claude | packages/court/** | `runCase`, `runBaseline`, witness runner, CLI `src/cli.ts` | codex |
| T7 | codex | packages/llm/**, packages/daemon/** | Token Factory client + replay client; daemon court routes | gemini |
| T8 | codex (2nd worktree) | packages/bench/** | mutant generator over a vendored JS fixture repo, bench runner, results | claude |
| T9 | cursor | packages/web/** | Courtroom UI (live via daemon SSE, or static demo JSON), benchmark page | codex |

## T7 llm + daemon
- `createTokenFactoryClient({ apiKey?, baseUrl?, fetch? }): LlmClient` in packages/llm/src/index.ts. POST {baseUrl}/chat/completions with model = MODELS[tier].id, messages, max_tokens, temperature, `response_format: {type:'json_object'}` when json. Reasoning on/off: send `chat_template_kwargs: { enable_thinking: bool }` (check docs.tokenfactory.nebius.com for the correct field for Nemotron 3; if it differs, implement what the docs say and note it). Strip `<think>...</think>` and any `reasoning_content` from the returned content. Retries: 429/5xx exponential backoff, max 4, honour Retry-After. Cost from MODELS prices and returned usage. Timeout 180 s per call.
- `createReplayClient({ dir, live?: LlmClient, mode: 'replay'|'record' })`: key = sha256 of JSON {tier, messages, json, reasoning, temperature}; replay reads `dir/<key>.json`, record calls live and writes it. Missing fixture in replay mode -> throw a clear error naming the key.
- `createClientFromEnv()`: KACHERI_LLM=replay|record|live (default: live if NEBIUS_API_KEY set else replay), fixtures dir KACHERI_FIXTURES (default ./fixtures/llm).
- Daemon: `POST /api/cases {title, repoPath, baseRef, headRef}` -> CaseRecord (runs `runCase` from `@kacheri/court`, injected like the engine so tests use a fake), `GET /api/cases`, `GET /api/cases/:id`; broadcast CourtEvents on the existing /api/events SSE as `{type:'court', event: CourtEvent}`.
- Tests with fake fetch: request shape, retry on 429, think-stripping, cost math, replay hit/miss, record writes.

## T8 bench
- Vendor ONE real small MIT/ISC-licensed pure-JS ESM library with a node:test (or easily ported) test suite into `packages/bench/fixtures/<name>/` with its LICENSE (e.g. a semver, date, string-utils, or query-string style lib, 300-1500 LOC). Tests must run with `node --test` and no npm install.
- `src/mutate.ts`: line-level operators: off-by-one (`<`<->`<=`, `>`<->`>=`, `+1`/`-1`), flip comparison (`===`<->`!==`), boolean/logical swap (`&&`<->`||`), drop negation, wrong boundary in slice/substring, swap return of early-exit. Generate candidates, keep SURVIVORS: mutants for which the fixture's own test suite still passes. Each survivor -> BenchItem + a git repo dir (base commit, head commit = mutant, commit message describing a plausible feature change so it looks like a PR).
- `src/run.ts`: `npm -w @kacheri/bench run bench -- --n 25 --systems court,baseline` uses `runCase`/`runBaseline` from `@kacheri/court` and `createClientFromEnv` from `@kacheri/llm`; scores BenchResult per item (hit = convicted/finding in same file within 3 lines); writes `packages/bench/results/<timestamp>.json` and `results/latest.md` with a summary table (hit rate, FP/PR, precision, $ per PR, p50 latency) per system.
- Tests: mutate operators, survivor filter on a tiny inline fixture, scoring function.

## T9 web
- New route/view "Court" alongside the existing board: case list; case view showing the PR diff, then four lanes: Charges (claim, file:line, witness code collapsible), Evidence (base/head run chips pass/fail per run, admissible badge, log), Defense (argument, concedes), Ruling (convicted in red / dismissed in grey with reason). Animate events as they stream in. Header: total cost ($, 4 decimals), tokens per tier, elapsed.
- Benchmark page: renders `latest` bench JSON: court vs baseline bar comparison (hit rate, false positives per PR, cost per PR) and a per-item table.
- Data source: live daemon (/api/cases + SSE, type 'court') OR static demo mode when `VITE_DEMO=1`: loads `public/demo/cases/*.json` (CaseRecord) and `public/demo/bench.json`, and replays case events with timing so it looks live. Must build to static files deployable on GitHub Pages (`base` configurable via VITE_BASE).
- Design: polished, dense, courtroom feel without kitsch: neutral palette, one accent, monospace for code, clear verdict colours, light/dark.
