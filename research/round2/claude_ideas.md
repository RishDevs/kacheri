# Claude's round-2 candidates

## C1. Kacheri Court: evidence-or-it-didn't-happen code review (Coding & Agentic track)
- Pain: AI review bots post plausible, unverifiable findings, so developers learn to ignore them. Review swarms (review-council etc.) use more reviewers to "verify", which still produces opinions, not proof.
- Idea: a courtroom where a Nemotron **prosecutor** agent must back every accusation with *executable evidence*: a test or repro script, run in an isolated worktree, that fails on the PR branch and passes on the base branch. A Nemotron **defense** agent tries to rebut it, for example by showing the test is wrong or out of scope. **Nemotron Ultra presides** and rules on the evidence log alone. Findings without passing evidence are dismissed automatically.
- Essential Nemotron use: Nano/Super run the many cheap prosecutor/defense iterations; Ultra's reasoning handles the ruling; tool calling runs the tests. Token Factory hosts all three tiers, so it's open and cheap.
- Reuses what's built: git engine (worktrees, pinned SHAs, merge gate), daemon, SSE UI.
- Demo wow: a PR with a subtle off-by-one. Reviewer bots post 6 comments; Kacheri Court convicts on 1 (with a failing test attached), dismisses 5, and the merge is blocked until the fix makes the test pass.

## C2. Kacheri Clerk: private immigration-compliance assistant for international students (Personal AI / Apps)
- Pain: ~1.1M international students in the US (Open Doors 2024) manage hard deadlines with real consequences: OPT 90-day unemployment limit, 10-day SEVP reporting, travel signatures, STEM OPT reports.
- Idea: upload I-20/EAD/I-797 documents. Nemotron vision/parse extracts dates; Tavily pulls current USCIS/SEVP rules with citations; persistent memory builds a personal compliance timeline; questions like "can I travel in December?" get cited answers plus a "talk to your DSO" flag.
- Risk: legal-advice liability, accuracy of document extraction, and the build is mostly greenfield.
