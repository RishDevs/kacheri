# Kacheri Court

AI code review that must prove every accusation.

Nebius x NVIDIA Global AI Hackathon · Coding & Agentic Engineering track. Built during the hackathon period, October 30, 2026.

[Live demo]([DEMO_URL]) · [Video]([VIDEO_URL])

## The problem

AI review findings often sound plausible but cannot be verified. Developers must reconstruct the bug themselves. Kacheri requires an executable witness before a finding reaches judgment.

## How it works

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

Base passed 3/3; head failed 3/3, returning `foo.bar:baz`. Super defended the change; Ultra convicted. The remedy restored one line, matching the upstream maintainers' fix byte for byte:

```diff
+            && !protocol.includes('.')
```

(The recorded patch preserves the original tabs.) After two remedy attempts, the witness passed 3/3 and all 25 repository tests passed. Total recorded model cost: **$0.03629**. The hosted demo replays this actual run.

## Benchmark

<!-- BENCH_TABLE -->

Method: 32 mutants surviving the repository suite, 5 real upstream regressions reconstructed by reverting fixes, and 12 behaviour-preserving changes; compare Court with Nemotron Super and Ultra single-pass baselines on detection, false positives, cost and latency.

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

JSON mode worked for structured charges, rulings and edits. Reasoning tokens consume `max_tokens`, so small output budgets could leave no usable JSON. The documentation we consulted did not document the Nemotron thinking toggle; explicitly setting `enable_thinking` made per-role control practical. Super improved runnable witness generation over Nano, while Ultra rejected Super's incorrect defense in the recorded case.

## License

[MIT](LICENSE).
