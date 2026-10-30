# @kacheri/bench

`npm -w @kacheri/bench run gen` regenerates `fixtures/survivors.json`, generation counts, and isolated git repositories in `fixtures/repos/`. Each repository has an upstream base commit and one mutated head commit. Generated repository internals are ignored; the portable, reviewable fixture data is the manifest with complete patches and deterministic commit IDs. The benchmark recreates missing repositories automatically. No parent repository commits are made.

`npm -w @kacheri/bench run bench -- --n 25 --systems court,baseline` uses `createClientFromEnv()` and writes a timestamped BenchResult array plus `results/latest.md`. Configure live/replay mode through @kacheri/llm. Court and LLM must be present in the workspace to run the CLI. Tests inject reviewers and need neither package. The current integration expects `runCase(input, {llm})` and `runBaseline(input, {llm})`, with baseline returning `{findings, usage}`.

Scores count only convictions for Court and all findings for baseline. A hit requires the same file and a non-null line within three lines of the mutated line. Precision counts matching reports, including multiple reports at the injected location. Error cases stop the benchmark instead of being counted as misses. Latency includes the complete reviewer call and p50 uses the median.

## Vendored source

normalize-url **8.0.1**, MIT, Sindre Sorhus; source and license fetched from:

- https://registry.npmjs.org/normalize-url/-/normalize-url-8.0.1.tgz
- https://github.com/sindresorhus/normalize-url/blob/v8.0.1/test.js

`fixtures/normalize-url/index.js` is unmodified upstream source. `license`, package metadata, declarations and readme are retained. The complete upstream test.js is ported by replacing its AVA import with a small node:test/assert adapter; no assertions or tests are removed. Run with `node --test packages/bench/fixtures/normalize-url/test.js`; no npm install required.

Mutation operators change one source line at a time. Numeric offsets include regex range endpoints and collection lengths; slice/substring boundaries are perturbed independently; comparisons, logical operators, negations and early returns are also mutated. Every candidate runs in a separate Node process with a five-second timeout. The pristine suite must pass first, and its source is restored even after failures. The original upstream suite is the only survivor filter. Survival does not prove a semantic defect: equivalent mutants can remain, and the manifest should be audited before interpreting scores as real-bug recall. No live model scores are fabricated or checked in.
