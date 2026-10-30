# Architecture

Kacheri is a local app that runs coding-agent CLIs on tasks, each in its own git worktree, has a different agent review the diff, checks file ownership and tests, then merges on a human click.

```
web (React/Vite :5173) --REST+SSE /api--> daemon (Fastify :4317, node:sqlite)
                                            |-- adapters -> spawn codex / cursor-agent / agy / claude (stdin closed, timeout)
                                            |-- @kacheri/git-engine  (worktrees, diff, ownership, merge)
                                            '-- @kacheri/jury        (review prompt, verdict parser)
all packages share types from @kacheri/shared
```

Flow: create task -> start (worktree `kacheri/<id>` + build run) -> build succeeds -> engine.commitAll -> review runs (non-author agents, read-only) -> verdicts parsed -> all PASS = `ready`, any FAIL = `changes_requested` -> human Merge (ownership + tests gate) or Reject.

Stack: TypeScript everywhere, npm workspaces, vitest, tsx. Node >= 22 (uses built-in `node:sqlite`; no native deps). Packages export `src/index.ts` directly (no build step).

Rules: no paid API calls; agents run only through locally installed, logged-in CLIs. Never force-push, never `git reset --hard` on user branches, never delete unmerged work automatically.
