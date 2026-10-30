# Idea selection

## Scores
| Idea | Gemini | Codex feasibility | Cursor UX | Daily use | Verdict |
|---|---|---|---|---|---|
| A Office (orchestrator) | top-2 | 3 (7–10 d) | 4 | 5 | Best product, too much scope as specified |
| B Jury (adversarial review) | top-1 | 4 (3–4 d) | 3 | 3 | Strong as a module, weak standalone |
| C Docs-Office | — | 4 | 3 | 2 | Rarely used; OCR risk |
| D Relay (webhooks) | — | 5 (2–4 d) | 3 | 3 | Easy, but Stripe CLI/ngrok/Hookdeck cover it |
| E MockHouse | — | 4 | 4 | 3 | Crowded (Mockoon, MSW) |

Codex's fatal risk for A ("agent CLIs can't run unattended") is already disproved: codex, cursor-agent and agy all ran headlessly on 2026-10-30. Its other risk ("advisory locks can't stop writes") goes away if ownership is checked at **merge time** against the diff, not by runtime locks.

## Synthesis: **Kacheri — a local "court" for coding agents** (A + B, A's scope cut down)
Task in → assigned agent works in its own worktree → **a different agent reviews the diff** → ownership and test checks → human clicks Merge.

MVP (5–6 days with 4 agents):
1. **Daemon** (TS, Fastify, SQLite, SSE): tasks, runs, adapters that start `codex` / `cursor-agent` / `agy` as subprocesses (stdin closed, timeout, log capture).
2. **Git engine**: create/remove a worktree and branch per task; diff vs. base; ownership check (changed paths vs. the task's owned globs); merge with tests required to pass, never forced.
3. **Jury**: send the diff to 1–2 non-author agents with a fixed verdict schema (PASS/FAIL + findings with file:line); parse it, retry once on malformed output.
4. **UI** (React/Vite): task board, live log pane, diff viewer with jury findings inline, Merge/Reject buttons.

Out of MVP: auto-conflict resolution, runtime locks, cloud, paid APIs, multiple users.

Why it wins: highest daily use, the most visual demo, B adds a quality gate no competitor has, and four modules map cleanly onto four agents. We dogfood it on itself right away.

Proposed ownership: Claude takes the git engine plus the integration contracts (the critical part); Codex the daemon and adapters; Cursor the UI; Gemini writes the jury prompts and adversarial tests.
