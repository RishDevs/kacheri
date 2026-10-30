# Council: submission as judges

## Codex
1. Claims I would challenge

- **“Every one of its 21 convictions”** (README/Devpost): `latest.json` records **34 convictions across 21 changes caught**, including **4 false positives**. You’ve confused changes with findings. The 88.2% precision is 30/34, with duplicate matching reports counted.
- **“32 small planted bugs”**: stronger than the evidence. Both research reports explicitly say, **“Mutant survival does not establish a real bug.”** Call them surviving mutants unless independently validated.
- **“so a comment in the code can't talk the judge into anything”** (Devpost): unsupported security guarantee. Tagging untrusted content is a mitigation; no adversarial evaluation is supplied.
- **“It reviews every pull request”** (video): contradicts README’s disclosure that the workflow skips fork PRs.
- **“The fix has to … keep the repository's own test suite green”** (Devpost): qualify this with “when configured.” README says the included Action supplies no suite command.
- **“Precision rose … false accusations halved”**: numerically supported, but selectively presented. Run 2 also increased average cost **65%**, doubled median latency, and reduced historical-regression hits from **4/5 to 3/5**. One exploratory rerun doesn’t establish causation.
- **“Half the time it isn't”** (README): an unsupported industry-wide error-rate claim.

2. Text that sounds scripted

“Courts solved this problem a long time ago,” “An honest benchmark,” and “Finding the suspect wasn't the hard part. Proving it was.” feel polished and self-congratulatory. Prefer concrete observations. This is a style judgment, not evidence of AI authorship.

3. Highest-value changes in two hours

1. **Correct the claims above**, distinguish findings from changes, and disclose duplicate-sensitive scoring and run-2 tradeoffs.
2. **Finish the video and replace `[VIDEO_URL]`.** Show runnable evidence, the upstream fix, and actual Token Factory usage; label replay clearly.
3. **Reproduce one additional independently validated upstream regression**, preferably from another repository, with witness, suite result, cost, and latency. This strengthens impact and technical credibility.

## Gemini
### 1. False, Inflated, or Unbacked Claims
* **"Half the time it isn't [true]"**: Unbacked strawman. In your own benchmark, single-pass Ultra achieved 90.6% precision and Super hit 100%. 
* **"The remedy restored one line, matching the upstream maintainers' fix byte for byte"**: Inflated. You constructed the test case by deleting that exact upstream fix line (`!protocol.includes('.')`); the model simply reverted an artificial single-line deletion.
* **"the catch rate stayed at 56.8%"** (Run 2): Material omission. While aggregate rate held, historical real-bug catch rate fell from 80% (4/5) to 60% (3/5), and p50 latency doubled (32s to 67s, peaking at 92s).
* **Step 0 ("Grand jury / Suspects") presented as core pipeline**: Inflated architecture. The headline Run 1 benchmark and recorded demo both ran *without* this step.

### 2. AI-Written or Stiff Text
* **Rhetorical clichés**: *"Finding the suspect isn't the hard part. Proving it is."* is copy-pasted verbatim across the README, Devpost, and video script.
* **Stiff, LLM-generated phrasing**: *"Having several roles brings disagreement into the open, but it doesn't make any single model infallible"* (Devpost) and *"The documentation we consulted did not document the Nemotron thinking toggle"* (README).

### 3. Top 3 High-Impact Changes (Next 2 Hours)
1. **Disclose latency in the benchmark tables**: Add the p50 latency column (32s–67s vs Ultra’s 3.9s). Judges will notice you hid a 10x–17x latency penalty; disclosing it frames differential testing as an intentional, thorough verification trade-off.
2. **Harmonize pipeline and benchmark reality**: Explicitly label Step 0 (Grand Jury) as an exploratory Run 2 feature in the diagrams/docs so the architecture matches the headline benchmark and demo case.
3. **Deepen Nemotron/Token Factory technical evidence**: Show concrete prompt excerpts and explain how you budgeted `max_tokens` between reasoning tokens and JSON output. This scores heavily on track criteria.
