# Shortlist (merged Claude + Gemini)
Constraints: 4 AI agents build a working MVP in a few days; solo dev user on macOS; no paid API calls (may shell out to locally installed, already-logged-in agent CLIs: codex, cursor-agent, agy).
A. Kacheri Office — local web app + daemon to orchestrate coding-agent CLIs: task board, one git worktree per task/agent, file-ownership locks + conflict warnings, live logs, diff view, merge button.
B. Kacheri Jury — adversarial multi-role review of a git diff (security/logic/perf "judges") using locally installed agent CLIs, verdict + patch suggestions UI. (Could be a module of A.)
C. Kacheri Docs-Office — private local tracker for warranties/IDs/insurance/subscriptions: upload PDF/photo, local OCR (tesseract) extracts dates, user confirms, expiry calendar + ICS/email reminders.
D. Kacheri Relay — local webhook interceptor (Stripe/Clerk etc.) logging to SQLite, payload diff, edit + one-click replay.
E. Kacheri MockHouse — stateful mock API server inferred from JSON/OpenAPI, SQLite-backed CRUD, UI toggles for latency/4xx/5xx faults.
