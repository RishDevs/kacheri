# Claude's proposals

| # | Name | Problem | User | MVP scope | Risk |
|---|---|---|---|---|---|
| C1 | Kacheri (agent office) | Running several coding-agent CLIs in parallel is manual: worktrees, prompts, logs, reviews scattered across terminals | Devs using Codex/Cursor/Claude/Gemini CLIs | Local web app + daemon: task board, spawn agent CLI per task in its own git worktree, live logs, diff view, "send to reviewer agent", merge button | Agent CLI flags change often; must avoid paid API calls (shells out to installed CLIs only) |
| C2 | Kacheri (paperwork office) | Warranties, IDs, insurance, subscriptions expire silently; docs scattered | Households, freelancers | Upload PDF/photo, local OCR (tesseract) extracts dates/amounts, user confirms, calendar of expiries + email/ICS reminders, all local/private | OCR accuracy on photos; reminder delivery without paid services |
| C3 | Kacheri (concert practice) | Carnatic/Hindustani students lack a tala-aware practice tool (metronomes are Western-meter) | Indian classical music students/teachers | Web app: tala-cycle metronome (adi, rupaka, misra chapu…) with angas visualised, practice log, record + playback per session, teacher-shared assignments | Niche market; audio timing precision in browser |

Lean: C1 (direct pain we are living right now, strong backend/frontend split, name fits "office").
