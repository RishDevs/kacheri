# Kacheri Court: demo video script

Target: about 2:50, never over 3:00. Screen recording with your voice over it. The narration column is everything you say, about 400 words, so read it at a relaxed pace. It's written to be spoken, so contractions are fine. If a line feels stiff in your mouth, change it to how you'd actually say it.

Optional: if you make a /brag teaser clip, put it before 0:00 and trim the cold open to its first two sentences.

| Time | On screen | Say |
|---|---|---|
| 0:00–0:15 | `https://rishdevs.github.io/kacheri/#/court/KC-2026-0014`, scrolled to the judgment box. | AI code reviewers are confident. They'll tell you your change breaks something, and then it's on you to figure out if that's true. Kacheri Court doesn't let a model accuse your code unless it can prove it. |
| 0:15–0:30 | Click **Replay from the start**. Let the status update. | This is a real recorded case. We took a bug the normalize-url maintainers fixed upstream, put it back, and disguised it as a refactor. Everything you're about to see is the actual model output and the actual test runs. |
| 0:30–0:50 | Scroll to the charge, then **Exhibit 1**, the run table. Point at the three PASS and three FAIL. | Two Nemotron prosecutors, Nano and Super, read the change, and each one has to write a test that proves a bug. Here's the rule: the test has to pass on the old code three times and fail on the new code three times. If it crashes, flickers, or fails on both, it's thrown out before the judge ever sees it. |
| 0:50–1:05 | Scroll to **Exhibit 2**, the witness code. Highlight the `normalizeUrl` call. | This is the proof. It calls the library's public API with foo dot bar colon baz. The old code returns what it should. The new code hands the input back unchanged. |
| 1:05–1:20 | Scroll through **Defense** and **Findings**. | But a changed behaviour isn't always a bug, so there's a defense. Super argues this was an intentional refactor. Ultra, as the judge, weighs that against the evidence and convicts. |
| 1:20–1:40 | Show **Order** with the one-line diff. Switch to the upstream commit tab and point at `&& !protocol.includes('.')`. | Then the court orders a fix. Super writes the smallest edit it can. It only counts if the proof test now passes and the library's own twenty-five tests still pass. And this is what the real maintainers wrote. It's the same line. |
| 1:40–2:10 | `https://rishdevs.github.io/kacheri/#/bench`. Point at the headline stats, then the three rows. | We ran forty-nine changes this way: planted bugs, real regressions, and harmless refactors. I want to be straight about the result. Ultra on its own flagged more bugs, about seventy-eight percent, against the court's fifty-seven. But every conviction the court makes comes with a test you can run, and it never accused a single clean change. Ultra did. The court is slower and catches less, but when it says something's broken, you can check it in seconds. |
| 2:10–2:30 | README section "NVIDIA Nemotron and Nebius Token Factory", showing the model table. | All three Nemotron models run on Nebius Token Factory. Nano is cheap enough to be a second prosecutor, Super writes the tests, the defense and the fix, and Ultra judges. This whole case cost under four cents. |
| 2:30–2:45 | Terminal with the captured CLI output (see checklist), then the `kacheri-court.yml` workflow tab. | You can run it from the command line, or add it to GitHub. It reviews pull requests from your own repo and posts the verdict with a one-line command to reproduce the evidence yourself. |
| 2:45–2:55 | Back on the case page, Order visible. Links on screen: `rishdevs.github.io/kacheri` and `github.com/RishDevs/kacheri`. | Kacheri Court: code review that has to prove it. The demo and the code are linked below. |

## Before you hit record

- Record at 1920×1080, browser zoom around 110–125%. Check that the witness code and run table are readable.
- Hide bookmarks, notifications and other tabs. Do a ten-second mic test and listen back.
- Pre-open these tabs in order: the case page, the upstream commit (https://github.com/sindresorhus/normalize-url/commit/dec5dc6b40e664194db97cd74ea5cb977f23d219), the Court record page, the README model section (https://github.com/RishDevs/kacheri#nvidia-nemotron-and-nebius-token-factory), and the workflow file (https://github.com/RishDevs/kacheri/blob/main/.github/workflows/kacheri-court.yml).
- Terminal: open `docs/submission/terminal-capture.txt` with `cat` in a terminal, or just show the file. It's real output from a live run of the CLI on this case, captured ahead of time because a live case takes a couple of minutes. Don't call it a fresh run. Keep `~/.kacheri.env` off screen.
- Click **Replay from the start** once before recording so you know when each section appears.
- Make sure the final cut is under 3:00. Upload to YouTube as public or unlisted, then put the link in place of `[VIDEO_URL]` in the README and the Devpost form.

## If you run long

- Drop the terminal shot and just show the workflow file.
- Cut the defense line down to: "Super defends it, Ultra convicts."
- Keep the run table, the proof test, the one-line fix next to upstream, and the honest benchmark line. Those four are the pitch.
