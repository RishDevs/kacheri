# @kacheri/bench

`npm -w @kacheri/bench run gen` regenerates the portable item manifest and counts.
Repositories are reconstructed lazily under ignored `fixtures/repos/`, with deterministic
base/head commits in those isolated repositories. The workspace branch is untouched.

`npm -w @kacheri/bench run bench -- --n 25 --kinds clean,historical,mutant --systems court,baseline,baseline-ultra --concurrency 2`

`--n` caps total selected PRs after filtering; kinds are selected in the supplied order
(default clean,historical,mutant), so the default 25 includes every clean and historical
item. All three systems run by default. Concurrency defaults to two reviewer calls.
Court uses `runCase`; baseline uses `runBaseline` with Super; baseline-ultra uses Ultra.
The runner uses `createClientFromEnv` and the LLM package's existing credit cap.
Each run writes timestamped JSON and replaces `results/latest.md`. An unmeasured
report shows N/A rather than invented model scores. Reviewer errors abort reporting.

Reports group by system and by kind, plus all kinds. Hit rate excludes clean PRs.
Only Court convictions count as positive reports; all baseline findings count.
Every report on a clean PR is a false positive, even at the edit location.
For bug items, matching requires the same file (ignoring leading ./), a non-null
line, and distance at most three from the edited line. Unmatched reports are false
positives. Precision is matching reports / all positive reports; duplicate matching
reports count separately. FP/PR and cost/PR include every PR in each group. p50
is median reviewer wall time, excluding repository preparation. Location matching
is a proxy, not semantic verification. Equivalent surviving mutants may remain.

## Fixture and historical provenance

Vendored normalize-url **8.0.1**, MIT, Sindre Sorhus:
- https://registry.npmjs.org/normalize-url/-/normalize-url-8.0.1.tgz
- https://github.com/sindresorhus/normalize-url/blob/v8.0.1/test.js

The upstream source stays unchanged. The complete upstream suite uses a node:test
adapter in place of AVA. Mutants must survive this full suite. Twelve clean items
rename locals, reorder independent assignments, or add JSDoc; each passes it too.

`fixtures/history.json` records five actual upstream fix SHAs, URLs, commit messages,
source/test diffs, and the exact fixed and buggy source snippets. History was fetched
using `curl https://api.github.com/repos/sindresorhus/normalize-url/commits?per_page=100`
and individual commit API diffs. Fixes cover protocol-less ports, sorted query encoding,
unwanted single slashes, malformed URI path escapes, and www stripping. Older
`urlObj` identifiers and redundant regex grouping are adapted to the vendored source.

For each historical PR, the base source equals vendored fixed source; head reverts
only that fix and presents it as a refactor. Generation runs the full suite against
the buggy head, identifies every failing named test block, and removes those blocks
from **both** base and head for that item only. `omittedTests` records their names;
the PR diff contains source changes only. Removing whole blocks can also remove
unrelated assertions in those blocks. The original suite is untouched. Tests verify
that both reduced suites pass and restoring the full suite catches each regression.
No historical item uses the ReDoS fix, avoiding timing-dependent ground truth.
