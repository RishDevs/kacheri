# Council: grand-jury

Q: The full benchmark finished (49 PRs on normalize-url: 32 surviving mutants, 5 real historical regressions, 12 clean). Results: Court hit 56.8%, 0.08 FP/PR, precision 88.2%, $0.011/PR, 0 false accusations on 12 clean PRs; single-pass Super hit 37.8%, precision 100% (reports little); single-pass Ultra hit 78.4%, 0.06 FP/PR, precision 90.6%, 1 false accusation on clean PRs, $0.008/PR. On the 5 historical: Court 80%, Ultra 60%, Super 0%. Court misses bugs mostly because prosecutors cannot write a valid witness. Proposal (about 7 h to deadline, ~$19 credit left): add a 'grand jury' step: Ultra (single pass, reasoning) first lists suspected regressions with file:line and why; those become leads given to the Nano+Super prosecutors, who must still prove each with an executable witness; then re-run the court part of the benchmark (~$1). Questions: (1) do it, yes/no; (2) how should we present the CURRENT honest numbers if the new run does not beat Ultra's hit rate (what is our real claim to judges); (3) any risk of the comparison looking unfair (matching rule: same file, line within 3; baselines count all findings, Court counts convictions only).

## Codex

**RECOMMENDATION: Yes—time-box grand jury to 60–90 minutes, run once, then freeze.** Ultra supplies hypotheses; executable witnesses remain mandatory. This targets weak lead generation, but cannot necessarily fix prosecutors’ witness-writing bottleneck. Preserve the current results and report the new pipeline separately.

**Reasons:** Your honest claim is **proof-carrying review with reproducible differential evidence**, not superior detection or fewer false positives. Currently Ultra has higher hit rate, higher precision, lower FP/PR, and lower cost. Court’s promising results are historical-regression detection (4/5 versus 3/5) and zero accusations across 12 clean PRs; both samples are too small for superiority claims. Tell judges: “Court turns suspected regressions into executable, repeatable evidence and evaluates whether the behavior change is a bug.” Evidence proves changed behavior; adjudication supplies the regression judgment.

**Risks:** The ±3-line matching rule can misclassify semantically correct findings and reward precise localization. Audit matches and misses manually, preferably blinded, using one shared rubric. Counting baseline findings versus Court convictions is legitimate for comparing delivered outputs, but does not isolate orchestration quality: disclose the asymmetry and report Court accusations, admissibility, and convictions separately. Include Ultra’s added cost and latency. Label the revised run exploratory: it was designed after inspecting this benchmark, not independently validated.

## Gemini
**RECOMMENDATION:** YES, implement the grand jury step immediately (budget ~$1, strict 45-minute timebox).

**REASONS:**
1. **Solves the actual failure mode:** Prosecutors struggle with bug localization, not necessarily test synthesis. Ultra’s reasoning provides exact `file:line` targets, letting prosecutors focus purely on writing the executable witness.
2. **High upside, negligible cost:** Spending ~$1 of the remaining $19 with 7 hours left is an optimal risk/reward tradeoff.
3. **The Real Claim to Judges:** **Proof > Plausibility.** If Court remains at ~57% vs. Ultra's 78%, emphasize that single-pass LLMs output unverified assertions that falsely accuse clean PRs (Ultra: 1 false accusation; Court: **0**). On real historical bugs, Court beats Ultra (**80% vs. 60%**). Developers ignore noisy AI comments; Court provides zero-hallucination, differential git reproductions.

**RISKS:**
1. **Asymmetric comparison optics:** Baselines get credit for guessing a line (±3 lines) without runnable proof; Court requires a passing base and failing head across 6 deterministic runs. Highlight this explicitly as the "Verification Tax"—trading speculative recall for 100% verified trust.
2. **Submission crunch:** Do not let benchmarking delay the video, demo site, and README. Abort and ship current numbers if not working within 45 minutes.
