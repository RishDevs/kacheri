| System | Kind | PRs | Hit rate | FP/PR | Precision | $/PR | p50 latency (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| court | all | 49 | 56.8% | 0.04 | 93.5% | 0.018753 | 67211 |
| court | mutant | 32 | 56.3% | 0.06 | 92.6% | 0.020440 | 80243 |
| court | historical | 5 | 60.0% | 0.00 | 100.0% | 0.029706 | 92100 |
| court | clean | 12 | N/A | 0.00 | N/A | 0.009690 | 12015 |
| baseline | all | 0 | N/A | N/A | N/A | N/A | N/A |
| baseline | mutant | 0 | N/A | N/A | N/A | N/A | N/A |
| baseline | historical | 0 | N/A | N/A | N/A | N/A | N/A |
| baseline | clean | 0 | N/A | N/A | N/A | N/A | N/A |
| baseline-ultra | all | 0 | N/A | N/A | N/A | N/A | N/A |
| baseline-ultra | mutant | 0 | N/A | N/A | N/A | N/A | N/A |
| baseline-ultra | historical | 0 | N/A | N/A | N/A | N/A | N/A |
| baseline-ultra | clean | 0 | N/A | N/A | N/A | N/A | N/A |

Matching: same file (leading ./ ignored), non-null line within ±3 of the edited line. Court counts convictions only; baselines count all findings. Every report on a clean PR is a false positive. Hit rate excludes clean PRs. Precision counts matching reports, including duplicates; FP/PR and cost/PR include every PR in the group. p50 is the median wall time of each reviewer call. Mutant survival does not establish a real bug.
