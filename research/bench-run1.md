| System | Kind | PRs | Hit rate | FP/PR | Precision | $/PR | p50 latency (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| court | all | 49 | 56.8% | 0.08 | 88.2% | 0.011391 | 32368 |
| court | mutant | 32 | 53.1% | 0.09 | 88.5% | 0.013403 | 51663 |
| court | historical | 5 | 80.0% | 0.20 | 87.5% | 0.018253 | 65570 |
| court | clean | 12 | N/A | 0.00 | N/A | 0.003166 | 7938 |
| baseline | all | 49 | 37.8% | 0.00 | 100.0% | 0.002185 | 13581 |
| baseline | mutant | 32 | 43.8% | 0.00 | 100.0% | 0.002164 | 14388 |
| baseline | historical | 5 | 0.0% | 0.00 | N/A | 0.001598 | 27618 |
| baseline | clean | 12 | N/A | 0.00 | N/A | 0.002484 | 9830 |
| baseline-ultra | all | 49 | 78.4% | 0.06 | 90.6% | 0.007785 | 3891 |
| baseline-ultra | mutant | 32 | 81.3% | 0.03 | 96.3% | 0.008228 | 3900 |
| baseline-ultra | historical | 5 | 60.0% | 0.20 | 75.0% | 0.011485 | 5881 |
| baseline-ultra | clean | 12 | N/A | 0.08 | 0.0% | 0.005060 | 2911 |

Matching: same file (leading ./ ignored), non-null line within ±3 of the edited line. Court counts convictions only; baselines count all findings. Every report on a clean PR is a false positive. Hit rate excludes clean PRs. Precision counts matching reports, including duplicates; FP/PR and cost/PR include every PR in the group. p50 is the median wall time of each reviewer call. Mutant survival does not establish a real bug.
