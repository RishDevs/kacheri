| Idea | Core user flow (≤3 steps) | Wow moment in demo | Daily-use likelihood 1-5 | UX risk | UX score 1-5 |
|---|---|---|---|---|---|
| A. Office | Create tasks → assign agents (auto worktrees) → review diff + merge | 3 agents coding in parallel with live logs and a conflict warning before it breaks anything | 5 | Complex dashboard; slow or flaky agent CLIs make the app feel broken | 4 |
| B. Jury | Pick branch or diff → run judges → read verdict + apply patch | Judges disagree, then reach a verdict with a one-click fix | 3 | Slow runs; noisy or false-positive findings erode trust | 3 |
| C. Docs-Office | Upload scan → confirm extracted dates → get calendar/ICS | Photo of a warranty turns into a dated reminder in seconds | 2 | Tesseract misreads; tedious confirmation; used rarely | 3 |
| D. Relay | Point webhook at Relay → inspect/diff payload → edit + replay | Edit a failed Stripe event and replay it so the handler passes | 3 | Tunnel/setup friction; competes with the Stripe CLI and ngrok | 3 |
| E. MockHouse | Drop JSON/OpenAPI → get a live CRUD API → toggle faults | Flip a 500/latency toggle and watch the frontend's error state appear live | 3 | Schema inference gaps; unclear how state resets | 4 |

**Pick: A.** It's the only idea a solo agent-heavy dev would open every day, it gives the most visual demo, and B can ship inside it later as a review step.
