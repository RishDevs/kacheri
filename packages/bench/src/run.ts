import { runCase, runBaseline } from '@kacheri/court';
import { createClientFromEnv } from '@kacheri/llm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { benchRoot, type FixtureItem } from './mutate.js';
import { parseArgs, runBenchmark, writeResults } from './runner.js';

async function main() {
  const {n, systems} = parseArgs(process.argv.slice(2));
  const items = JSON.parse(readFileSync(join(benchRoot, 'fixtures/survivors.json'), 'utf8')) as FixtureItem[];
  const llm = createClientFromEnv();
  const results = await runBenchmark(items.slice(0,n), systems, {
    court: input => runCase({ ...input, llm }),
    baseline: async input => {
      const r = await runBaseline({ ...input, llm });
      return { usage: r.usage, findings: r.findings.map(f => ({ ...f, suggestion: null })) };
    },
  });
  console.log(writeResults(results));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
