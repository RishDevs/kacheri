# Council: next-steps

Q: About 7 hours remain before the deadline. Decide: (1) Prosecutor model: Nemotron 3 Nano (cheap, $0.06/$0.24 per M tokens) vs Super ($0.30/$0.90) as the default witness-test writer, and how many independent prosecutor samples (1-3), given witness tests must actually run and fail on head/pass on base; should we escalate Nano to Super only when Nano yields no admissible witness? (2) Required 'working demo URL': static replay of real recorded cases on GitHub Pages, vs a live instance on a Nebius Serverless Endpoint, vs both; what do judges actually check? (3) Priority order for the remaining 7 hours among: live Nemotron runs + recording fixtures, full benchmark run, courtroom UI polish, GitHub Action, README with benchmark table, demo video. Give an ordered list with rough hours.

## Codex

**RECOMMENDATION:** Use Nano with **two independent prosecutor samples**, escalate to **one Super sample only when neither produces an admissible witness**. Ship a GitHub Pages replay of real recorded cases; make live hosting optional.

**Reasons:** Execution is the quality gate: every witness must fail on head 3/3 and pass on base 3/3. Nano’s lower price permits exploration; Super’s higher price does not establish better witness yield. Validate this policy on early live cases, then freeze it for benchmarking. Record fallback costs and compare against an equal-budget baseline.

The supplied context requires a working demo URL but does **not** establish that judges require live inference or specifically check Serverless hosting. A clearly labeled, interactive replay demonstrates the product; recorded Token Factory requests and reproducible commands establish actual Nemotron use. Serverless is encouraged, not stated as mandatory.

**Seven-hour priority order:**

1. Live Nemotron runs, admissibility checks, recorded fixtures — **1.5h**
2. GitHub Action with verdict/reproduction output — **1h**
3. Full benchmark, including clean PRs and equal-budget baseline — **1.5h**
4. README with measured benchmark table — **0.75h**
5. Minimal courtroom polish and Pages deployment — **0.75h**
6. ≤3-minute demo video — **1h**
7. Submission verification/buffer — **0.5h**

**Risks:** Nano may yield few valid witnesses; replay can disappoint if mislabeled; benchmark runtime can consume the deadline. Avoid unmeasured performance claims.

## Gemini
### RECOMMENDATION

1. **Prosecutor:** Default **Nemotron 3 Nano ($k=2$)**, escalating to **Super ($k=1$)** only if Nano produces zero admissible witness tests.
2. **Demo URL:** **Both, with GitHub Pages static replay submitted as the primary URL.** Judges spend 60–90 seconds; cold starts, rate limits, or broken live runs instantly kill evaluations. A static replay of real recorded executions guarantees zero-downtime, instantaneous exploration. Link the live Nebius Serverless endpoint as an optional playground.
3. **Priority Order (7.0h):**
   - **Live runs + fixtures (1.5h):** Generates real Token Factory traces for replay, benchmark, and video.
   - **Demo video (1.5h):** Hard Devpost gate (≤3 min); the primary factor determining finalists.
   - **README with benchmark table (1.5h):** Anchor for "Technological Implementation" and "Impact" rubric criteria.
   - **GitHub Action (1.0h):** Validates the "proof-carrying CI review" product claim.
   - **Full benchmark run (1.0h):** Supplies real hit/false-positive metrics for the table.
   - **Courtroom UI polish (0.5h):** Functional replay beats visual perfection.

### REASONS
- Nano struggles with strict test-runner semantics; $k=2$ plus Super fallback balances cheap multi-hypothesis filing with guaranteed admissible code.
- Hackathon judges prioritize reliable, clickable demos and polished video narratives over raw backend endpoints.

### RISKS
- Escalation logic could fail if fallback state transitions aren't unit-tested.
- Benchmark runtime overruns could compress video recording time.
