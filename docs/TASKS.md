# Tasks and ownership

Contracts: `packages/shared/src/index.ts` (owner claude). Do NOT edit it; if you need a change, write it under ISSUES in your report.
Only edit files inside your owned paths. Root config (package.json, tsconfig.json, vitest.config.ts) is claude's; add your package's deps in YOUR package.json.

| ID | Owner | Paths | Deliverable | Reviewer |
|---|---|---|---|---|
| T1 | claude | packages/shared/**, packages/git-engine/** | `createGitEngine(repoRoot, {worktreeRoot?}) : GitEngine` + tests on temp repos | codex |
| T2 | claude | packages/jury/src/** | `buildReviewPrompt(task, diff): string`, `parseVerdict(raw, reviewer): ParseVerdictResult` | gemini |
| T3 | codex | packages/daemon/** | Fastify server on :4317 implementing the API in shared/index.ts; node:sqlite store; adapters; runner; orchestration flow | cursor |
| T4 | cursor | packages/web/** | Vite+React UI: task board by status, create-task form, task view with live logs (SSE), diff viewer with verdict findings inline, Start/Merge/Reject | codex |
| T5 | gemini | packages/jury/prompts/**, packages/jury/test/** | `prompts/review.md` template; adversarial vitest suite for parseVerdict | claude |

## T3 details (daemon)
- `src/server.ts` exports `createServer({ engine: GitEngine, store, adapters, repoRoot })` so tests can inject a fake GitEngine; `src/main.ts` wires the real one from `@kacheri/git-engine` and listens on 127.0.0.1:4317.
- Adapters (build kind / review kind):
  - codex: `codex exec --skip-git-repo-check --sandbox workspace-write <prompt>` / `--sandbox read-only`
  - cursor: `cursor-agent -p --trust --output-format text <prompt>` (review: prefix prompt with "Do not edit files.")
  - gemini: `~/.local/bin/agy -p <prompt> --print-timeout 600s`
  - claude: `claude -p <prompt>` (review: `--permission-mode plan`)
  - spawn with `stdio: ['ignore','pipe','pipe']` (stdin closed — codex hangs otherwise), cwd = worktree, kill on timeout (build 20 min, review 10 min).
- After a build run succeeds: `engine.commitAll(id, "kacheri: <title>")`, then review runs. Review stdout -> `parseVerdict` from `@kacheri/jury`; parse failure = one retry, then a FAIL verdict with summary "unparseable review".
- Merge endpoint calls `engine.merge(id, task.ownedPaths, { testCommand })`; testCommand from env `KACHERI_TEST_CMD` (space-split), default none.
- SSE: broadcast every task/run change and log chunks.
- Tests: vitest + fastify.inject with a fake engine and a fake adapter (e.g. `node -e`), no real agent CLIs.

## T4 details (web)
- Dev proxy `/api` -> http://127.0.0.1:4317. Import types from `@kacheri/shared` only.
- No UI framework beyond React; plain CSS modules or one stylesheet. Light/dark via prefers-color-scheme.
- Tests: vitest + @testing-library/react with jsdom for at least the board and diff viewer (use `// @vitest-environment jsdom`).

## T5 details (jury tests)
- `parseVerdict(raw: string, reviewer: AgentId): ParseVerdictResult` from `../src/parse` (claude writes it in parallel; write tests against the contract).
- Expected reviewer output: a single fenced ```json block `{ "status": "PASS"|"FAIL", "summary": string, "findings": [{ "severity": "critical"|"major"|"minor", "file": string, "line": number|null, "message": string, "suggestion": string|null }] }`. Prose may surround it; if several json blocks, the LAST valid one wins. Bare JSON with no fence is accepted. Unknown severity -> error. Missing optional fields (line, suggestion) -> null. FAIL with zero findings is allowed; PASS with critical findings -> coerce to FAIL.
- `prompts/review.md`: template with `{{title}}`, `{{prompt}}`, `{{ownedPaths}}`, `{{diff}}` placeholders that tells the reviewer to check correctness, security and scope, and to end with exactly that json block.
