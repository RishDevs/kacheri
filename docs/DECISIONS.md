# Decisions
- 2026-10-30 Product: Kacheri = agent orchestrator + cross-agent jury (see research/DECISION.md).
- 2026-10-30 Ownership is enforced at merge time against the diff, not with runtime locks.
- 2026-10-30 TypeScript monorepo, npm workspaces, source-only packages, node:sqlite (no native deps).
- 2026-10-30 Economy mode: Claude owns contracts, git engine, jury parser; other agents own other modules.
- 2026-10-30 Pivot for Nebius x NVIDIA hackathon: Kacheri Court (proof-carrying code review on Nemotron/Token Factory). Orchestrator v1 kept as substrate.
- 2026-10-30 Independent judge critiques (Codex, Gemini, research/round2/critique_*.md): both KEEP. Adopted: (1) benchmark adds clean PRs and real historical bug-fix pairs, equal-budget baseline; (2) lead with CI/GitHub Action + PR comment with repro command, courtroom UI is the explanation; (3) claim precisely: differential evidence proves a behaviour change, defense+judge decide whether it is a regression.
- 2026-10-30 Council next-steps (research/council/*-next-steps.md, Codex+Gemini agree): prosecutor = Nano x2, escalate to one Super sample only if no admissible witness; demo URL = GitHub Pages replay of real recorded cases (primary); order: live runs+fixtures, Action, benchmark, README, UI polish+Pages, video, buffer.
- 2026-10-30 User rule: never spend beyond the free hackathon credits. Hard cap enforced in packages/llm (persistent ledger, worst-case pre-check).
