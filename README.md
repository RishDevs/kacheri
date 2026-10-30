# Kacheri Court

AI code review that must prove every accusation.

Nebius x NVIDIA Global AI Hackathon · Coding & Agentic Engineering track. Built during the hackathon period, October 30, 2026.

[Live demo](https://rishdevs.github.io/kacheri/) · [Video]([VIDEO_URL])

## The problem

AI reviewers are good at sounding sure. A comment says "this breaks X", and now you have to go figure out whether it's true. When it isn't, you've lost time, and after a few of those you stop reading the comments at all.

Kacheri Court won't let a model accuse your code unless it brings a test that shows the bug. The test has to pass on the old code and fail on the new code, three times each, in a sandbox. If it can't do that, the accusation is thrown out before a judge ever sees it.

## How it works

0. **Suspects (experimental):** Nemotron Ultra reads the change once and names places that might be broken. This was added after benchmark run 1 and only used in the exploratory run 2; the recorded demo case predates it.
1. **Accuse:** Nemotron Nano and Super prosecutors independently write witness tests against the public API.
2. **Prove:** Run each witness in a sandbox three times on base and head. Evidence is admissible only when it passes on base and fails on head; broken, inconsistent and non-differential witnesses are dismissed.
3. **Defend:** Nemotron Super challenges whether the demonstrated change is actually a bug.
4. **Decide:** Nemotron 3 Ultra reasons over the evidence and defense, then convicts or dismisses.
5. **Remedy:** Super proposes minimal search/replace edits. Re-run the witness three times and the repo's own suite on the fix (`--test-cmd` supplies the suite).

## A real recorded case

[KC-2026-0014](packages/web/public/demo/cases/KC-2026-0014.json) reconstructs a historical `sindresorhus/normalize-url` regression by removing the upstream fix, `!protocol.includes('.')`. The witness asserts:

```js
assert.strictEqual(
  normalizeUrl('foo.bar:baz', { defaultProtocol: 'foo' }),
  'foo:foo.bar:baz',
);
```

Base passed 3/3; head failed 3/3, returning `foo.bar:baz`. Super defended the change; Ultra convicted. The remedy restored one line, the same line the upstream maintainers wrote. (We built the case by deleting that line, so this shows the fix is minimal and correct, not that the model invented something new.)

```diff
+            && !protocol.includes('.')
```

(The recorded patch preserves the original tabs.) After two remedy attempts, the witness passed 3/3 and all 25 repository tests passed. Total recorded model cost: **$0.03629**. The hosted demo replays this actual run.

## Benchmark

The test set: 32 surviving mutants (small planted edits, like a flipped comparison, that the library's own 25 tests don't catch; a surviving mutant isn't always a real bug), 5 real bugs the maintainers fixed upstream (we put each one back), and 12 harmless refactors where any accusation is a false one.

We ran all 49 changes against `sindresorhus/normalize-url` live on Token Factory (run 1, October 30 2026). Every number below is from recorded runs; the per-case results are in [`packages/web/public/bench/latest.json`](packages/web/public/bench/latest.json) and on the [Court record page](https://rishdevs.github.io/kacheri/#/bench).

| Reviewer | Bugs caught (of 37) | False accusations | Precision | Clean changes accused | Cost per change | Median time |
|---|---|---|---|---|---|---|
| Kacheri Court (proof required) | 21 (56.8%) | 4 | 84% | 0 of 12 | $0.0114 | 32 s |
| Nemotron Super, single pass | 14 (37.8%) | 0 | 100% | 0 of 12 | $0.0022 | 14 s |
| Nemotron Ultra, single pass | 29 (78.4%) | 3 | 90.6% | 1 of 12 | $0.0078 | 3.9 s |

Precision here is changes caught divided by changes caught plus false accusations. (The raw runner reports in `research/` count duplicate reports and give slightly higher numbers.)

What this does and doesn't show:

- **Ultra on its own finds more bugs than the court does.** We aren't claiming better detection. The bottleneck is writing a test that really reproduces the bug, not spotting it.
- **What the court adds is proof.** Every conviction comes with a test you can run yourself. It filed 34 convictions across the 21 changes it caught; 4 of them pointed somewhere other than the planted bug and count as false accusations. Ultra's hits are comments you'd still have to check by hand.
- **It's slower.** Running tests on both versions takes time: a median of 32 seconds per change, against 4 seconds for Ultra alone.
- **The scoring favours the single reviewers.** Any of their comments within three lines of the bug counts as a hit; the court only gets credit for a conviction.
- On the 5 real upstream regressions the court convicted 4, Ultra 3 and Super 0.
- We tried one improvement afterwards: Ultra reads the change first and names suspects, and the prosecutors still have to prove each one ([run 2](research/bench-run2.md), exploratory). Precision went up from 84% to 91% and false accusations halved to 0.04 per change, but the overall catch rate stayed at 56.8%, real-regression catches dropped from 4 of 5 to 3 of 5, and cost and median time went up (about $0.019 and 67 s per change). One rerun isn't enough to say which way it really cuts, so run 1 is the headline.
- One small library, one language. Planted mutants are a stand-in for real bugs, not the same thing.

## NVIDIA Nemotron and Nebius Token Factory

| Tier | Model ID | Role and reason |
|---|---|---|
| Nano | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | Cheap independent prosecution |
| Super | `nvidia/nemotron-3-super-120b-a12b` | Stronger witness generation, defense and minimal fixes |
| Ultra | `nvidia/Nemotron-3-Ultra-550b-a55b` | Reasoning for final judgment |

The client uses Token Factory's OpenAI-compatible `/v1/chat/completions` API, JSON mode and `chat_template_kwargs.enable_thinking`. Reasoning is enabled for prosecution, judgment and remedy; disabled for defense. Usage is recorded per call and summed per case (3.63 cents above). Live calls use a default $20 spending cap, a persistent ledger and estimated worst-case preflight checks, with in-process reservations for concurrent calls. Separate live processes do not share atomic reservations.

## Safety

Witnesses use Node's permission sandbox: read-only checkout access, no child processes or workers, and no network access intended by the runner. The inherited environment is cleared except PATH and an empty NODE_OPTIONS; API keys are excluded. Witness lint rejects network calls, system imports, source inspection and time-dependent tests. Tagged repository content is explicitly treated as untrusted against prompt injection. Fixes run in disposable worktrees; no force pushes. The repository suite is trusted code and runs outside the witness sandbox.

## Quick start

Use a recent Node version supporting `--permission`, Git and npm:

```sh
npm install
# Replay recorded cases; no key needed:
VITE_DEMO=1 npm -w @kacheri/web run dev
```

For live runs, put `export NEBIUS_API_KEY=...` in `~/.kacheri.env`:

```sh
scripts/live.sh case ef06f10e06ad
# General CLI (load the key first):
source ~/.kacheri.env
npx tsx packages/court/src/cli.ts --repo /path/to/repo \
  --base main --head HEAD --test-cmd "node --test" --out case.json
```

CLI exit codes: 0 no convictions, 1 conviction, 2 case error.

For GitHub Actions, add the `NEBIUS_API_KEY` repository secret and use the included [PR workflow](.github/workflows/kacheri-court.yml). It checks out full history and invokes the composite action with:

```yaml
- uses: ./
  with:
    base: ${{ github.event.pull_request.base.sha }}
    head: ${{ github.event.pull_request.head.sha }}
    nebius-api-key: ${{ secrets.NEBIUS_API_KEY }}
```

It needs `contents: read` and `pull-requests: write`, posts a sticky verdict and gates on the CLI exit code. The included workflow skips fork PRs. The action does not supply a repository suite command.

## Architecture

- `packages/court`: prosecution, evidence execution, defense, judgment, remedy and CLI.
- `packages/llm`: Token Factory client, recording/replay and spending cap.
- `packages/shared`: contracts, case records, events and model pricing.
- `packages/web`: court UI and static recorded-case demo.
- `packages/bench`: mutants, historical regressions, clean changes and baseline runner.
- `packages/ci`: PR verdict comment rendering.
- `packages/daemon`: local API and event streaming.
- `packages/git-engine`: worktree and merge operations from the orchestrator substrate.
- `packages/jury`: cross-agent review prompts and verdict parsing.

## Limitations

JS/Node witnesses only. Differential evidence proves changed behaviour, not wrongness; defense and judgment remain model decisions. Model quality varies: Nano often needed witness repairs, and the recorded Super defense was unpersuasive. pnpm symlinks can resolve outside the read-only checkout and fail sandbox access. Three runs cannot eliminate all flakiness. Node permissions and regex lint are not a hardened isolation boundary.

## Feedback on Token Factory and NVIDIA models

JSON mode worked for structured charges, rulings and edits. Reasoning tokens consume `max_tokens`, so small output budgets could leave no usable JSON. We couldn't find the Nemotron thinking toggle in the docs; setting `enable_thinking` made per-role control practical. Super improved runnable witness generation over Nano, while Ultra rejected Super's incorrect defense in the recorded case.

## License

[MIT](LICENSE).
