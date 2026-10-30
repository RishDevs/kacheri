## Project name
Kacheri Court

## Tagline
AI code review that has to prove every accusation.

## Track
Coding and Agentic Engineering

## Inspiration
AI code reviewers write confident comments. "This will break when the input has a dot in it." Maybe it will, maybe it won't, and now it's your job to find out. After a few wrong ones you start skimming past all of them, including the ones that were right.

In a courtroom, sounding sure isn't enough to convict anyone. You need evidence. We wanted a reviewer that works the same way. No evidence, no finding.

("Kacheri" is the word for a courthouse or government office in several Indian languages.)

## What it does
You give Kacheri Court a code change. It runs a small trial:

1. **Prosecution.** Nemotron Nano and Super each try to write a test, which we call a witness, that proves a bug. The witness can only use the library's public API.
2. **Evidence.** We run every witness in a sandbox, three times on the old code and three times on the new code. It only counts if it passes on the old code every time and fails on the new code every time. Tests that crash, flicker, or fail on both versions are thrown out automatically. If a witness is broken, the prosecutor gets up to two tries to fix it.
3. **Defense.** Super argues the other side: maybe the behaviour change was intentional.
4. **Judgment.** Ultra weighs the evidence against the defense and convicts or dismisses.
5. **Remedy.** For a conviction, Super proposes the smallest fix it can. The fix has to make the witness pass three times and, when you give it the repository's test command, keep that suite green, or it isn't ordered.

We've also been trying an optional first step where Ultra reads the change and names suspects for the prosecutors. It's experimental; more on that below.

You can follow a case in a courtroom-style web UI, run it from the command line, or drop it into a pull request with the included GitHub Action, which posts the verdict and a one-line command to reproduce the evidence.

A failing test proves the behaviour changed. It doesn't prove the change is wrong, which is why the defense and the judge are separate steps.

## How we built it
It's a TypeScript monorepo. Every model call goes through Nebius Token Factory's OpenAI-compatible chat completions API, using three NVIDIA Nemotron 3 models:

- **Nano** (`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`): cheap, so it gets to be a second independent prosecutor.
- **Super** (`nvidia/nemotron-3-super-120b-a12b`): writes better witnesses, argues the defense, and writes the fix.
- **Ultra** (`nvidia/Nemotron-3-Ultra-550b-a55b`): the grand jury and the judge, where careful reasoning matters most.

We use JSON mode for every structured reply and switch Nemotron's thinking on or off per role with `chat_template_kwargs.enable_thinking`. It's on for prosecution, judgment and the fix, and off for the defense.

Old code, new code and the proposed fix each get their own throwaway git worktree. Witnesses run under Node's permission model: read-only access to the checkout, no child processes, no workers, no network, and an environment with the API key stripped out. A lint pass also rejects witnesses that reach for the network, the clock or the source files. Everything a model reads from the repository is wrapped in tags and treated as untrusted, which makes it harder for a comment planted in the code to steer the judge. It's a mitigation, not a guarantee; we haven't red-teamed it.

Every call is metered. A persistent spending ledger with a worst-case check before each call kept us inside a $20 cap, and record/replay mode means the hosted demo replays a real run without needing a key.

## Challenges we ran into
Our first live runs failed in ways we hadn't predicted:

- **Nano tested a function that wasn't exported.** The idea was right, but the test couldn't run. We now load each changed file in the sandbox, list what it actually exports, and hand that to the prosecutors.
- **Witnesses had typos.** Instead of throwing the charge away, the prosecutor now sees the error and gets two repair rounds.
- **The first fix rewrote the whole file.** It got the bug right but reformatted everything and broke the test suite. We switched to exact search-and-replace edits. The next run restored a single line.
- **Super's defense was wrong.** It argued the regression was a valid refactor. Ultra read the evidence and rejected the argument. Splitting the roles meant the disagreement showed up in the record where we could see it. It doesn't mean the judge is always right.

## Accomplishments that we're proud of
**A real case, end to end.** We took a bug the `normalize-url` maintainers had fixed upstream and put it back, disguised as a refactor. Kacheri Court wrote this witness:

```js
assert.strictEqual(normalizeUrl('foo.bar:baz', { defaultProtocol: 'foo' }), 'foo:foo.bar:baz');
```

It passed 3/3 on the old code and failed 3/3 on the new code, which returned `foo.bar:baz`. Super defended the change, and Ultra convicted. The ordered fix was one line, `&& !protocol.includes('.')`, the same line the maintainers wrote. To be fair, we built the case by deleting that line, so this shows the fix was minimal and correct, not that the model came up with something new. The witness passed and all 25 of the library's tests passed. The whole case cost **$0.036**. The hosted demo replays this exact run.

**The benchmark.** We built 49 test changes on `normalize-url`: 32 surviving mutants (small planted edits the library's own tests miss, which aren't always real bugs), 5 real upstream regressions put back, and 12 harmless refactors. We compared the court with Nemotron Super and Ultra each reviewing the change in a single pass:

| Reviewer | Bugs caught (of 37) | Precision | Clean changes falsely accused | Cost per change | Median time |
|---|---|---|---|---|---|
| Kacheri Court | 21 (56.8%) | 88.2% | 0 of 12 | $0.011 | 32 s |
| Super, single pass | 14 (37.8%) | 100% | 0 of 12 | $0.002 | 14 s |
| Ultra, single pass | 29 (78.4%) | 90.6% | 1 of 12 | $0.008 | 3.9 s |

Ultra on its own catches more bugs, and we're not going to pretend otherwise. What the court gives you is different: every conviction comes with a test you can run, and it never accused a clean change. It isn't perfect either. It filed 34 convictions across the 21 changes it caught, and 4 of them pointed away from the planted bug, so we count those as false accusations. It's also slower, because it actually runs tests on both versions. The scoring also leans toward the single reviewers, since any comment within three lines of the bug counts for them, while the court only gets credit for a proven conviction. On the five real regressions the court convicted four, Ultra three, Super none.

In a second, exploratory run we added the Ultra suspect step. Precision rose to 93.5% and false accusations halved, but the overall catch rate didn't move, real-regression catches dropped from four to three, and it cost more and took about twice as long. It's one rerun, so we're treating it as a lead, not a result. What it did tell us is that the prosecutors were rarely missing the right spot. They were failing to write a test that proved it.

## What we learned
Writing a convincing accusation is easy. Writing a test that proves it against a public API is much harder, and that gap is exactly the noise developers have learned to ignore in AI review.

Running the test on both versions turns a lot of model mistakes into something visible: a crash, a test that fails on both, a flaky result. Those get repaired or thrown out instead of landing in your PR.

And a correct diagnosis doesn't guarantee a safe fix. Our first fix was right about the bug and still broke the build.

## What's next
- Close the gap with single-pass Ultra by getting better at turning a suspect into a working witness.
- Run the benchmark on more repositories and real pull requests, not just one library.
- Support languages beyond JavaScript, and stronger isolation than Node's permission model, such as containers.
- Make the repository test command a first-class setting in the GitHub Action.

## Built with
TypeScript, Node.js, React, Vite, Git worktrees, GitHub Actions, GitHub Pages, Nebius Token Factory, NVIDIA Nemotron 3 Nano, NVIDIA Nemotron 3 Super, NVIDIA Nemotron 3 Ultra

## Links
- Demo: https://rishdevs.github.io/kacheri/
- Code: https://github.com/RishDevs/kacheri
- Video: [VIDEO_URL]
- The recorded case: https://github.com/RishDevs/kacheri/blob/main/packages/web/public/demo/cases/KC-2026-0014.json
- The upstream fix it matches: https://github.com/sindresorhus/normalize-url/commit/dec5dc6b40e664194db97cd74ea5cb977f23d219

## Feedback on Token Factory and the Nemotron models
Having one OpenAI-compatible endpoint for all three Nemotron sizes made it easy to give each role its own model. JSON mode held up well for charges, rulings and edits. Per-call usage numbers let us see what retries actually cost.

The main thing that tripped us up: reasoning tokens count against `max_tokens`. With a small budget, the model could spend it all thinking and return no JSON at all. A note in the docs on budgeting for reasoning plus structured output would save people time. We also couldn't find `chat_template_kwargs.enable_thinking` documented for Nemotron, and it was the setting that made per-role control work.

From our runs: Nano is cheap enough to use as an extra prosecutor but often needed a repair round. Super wrote more runnable tests but lost the argument in our headline case. Ultra was the most careful judge. These are notes from one project, not a ranking.

## What was built during the hackathon
All of it, on October 30, 2026: the trial pipeline, the Token Factory client with metering and replay, the sandbox and worktree handling, the web UI and hosted demo, the CLI, local API and GitHub Action, the benchmark and its fixtures, and the tests and docs. One person directed several AI coding agents through the build. The `normalize-url` library and its historical fixes are third-party material used for evaluation.
