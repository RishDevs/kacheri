# Decisions
- 2026-10-30 Product: Kacheri = agent orchestrator + cross-agent jury (see research/DECISION.md).
- 2026-10-30 Ownership is enforced at merge time against the diff, not with runtime locks.
- 2026-10-30 TypeScript monorepo, npm workspaces, source-only packages, node:sqlite (no native deps).
- 2026-10-30 Economy mode: Claude owns contracts, git engine, jury parser; other agents own other modules.
- 2026-10-30 Pivot for Nebius x NVIDIA hackathon: Kacheri Court (proof-carrying code review on Nemotron/Token Factory). Orchestrator v1 kept as substrate.
- 2026-10-30 Independent judge critiques (Codex, Gemini, research/round2/critique_*.md): both KEEP. Adopted: (1) benchmark adds clean PRs and real historical bug-fix pairs, equal-budget baseline; (2) lead with CI/GitHub Action + PR comment with repro command, courtroom UI is the explanation; (3) claim precisely: differential evidence proves a behaviour change, defense+judge decide whether it is a regression.
