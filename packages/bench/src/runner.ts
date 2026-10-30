import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BenchItem, BenchResult, CaseRecord, Finding, LlmUsage } from '@kacheri/shared';
import { benchRoot, createItemRepo, type FixtureItem, type Kind } from './mutate.js';
import { existsSync } from 'node:fs';
export type System = 'court' | 'baseline' | 'baseline-ultra';
export interface Result extends Omit<BenchResult, 'system'> { system:System; kind:Kind }
export interface ReviewInput { title: string; repoPath: string; baseRef: string; headRef: string }
export interface BaselineOutput { findings: Finding[]; usage: LlmUsage[] }
export interface Reviewers {
  court(input: ReviewInput): Promise<CaseRecord>;
  baseline(input: ReviewInput): Promise<BaselineOutput>;
  'baseline-ultra'?: (input: ReviewInput) => Promise<BaselineOutput>;
}
const matches = (item: BenchItem, f: {file:string; line:number|null}) => f.file.replace(/^\.\//, '') === item.file && f.line !== null && Math.abs(f.line - item.line) <= 3;
export function score(item: FixtureItem, system: System, output: CaseRecord | BaselineOutput, latencyMs: number): Result {
  const isCourt = 'charges' in output;
  const reported = isCourt ? output.charges.filter(c => output.rulings.some(r => r.chargeId === c.id && r.decision === 'convicted')) : output.findings;
  return {itemId:item.id, system, kind:item.kind, findings:isCourt ? output.charges.length : output.findings.length,
    convicted:isCourt ? reported.length : 0, hit:item.kind !== 'clean' && reported.some(f => matches(item, f)),
    falsePositives:reported.filter(f => item.kind === 'clean' || !matches(item, f)).length,
    costUsd:output.usage.reduce((sum, u) => sum + u.costUsd, 0), latencyMs};
}
export function summarize(results: Result[]): string {
  const rows = ['| System | Kind | PRs | Hit rate | FP/PR | Precision | $/PR | p50 latency (ms) |', '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for (const system of ['court','baseline','baseline-ultra'] as const) {
    for (const kind of ['all','mutant','historical','clean'] as const) {
    const group = results.filter(r => r.system === system && (kind === 'all' || r.kind === kind));

    const sum = (fn: (r: Result) => number) => group.reduce((n, r) => n + fn(r), 0);
    const positive = sum(r => system === 'court' ? r.convicted : r.findings);
    const fp = sum(r => r.falsePositives);
    const latencies = group.map(r => r.latencyMs).sort((a,b) => a-b);
    const middle = Math.floor(latencies.length / 2);
    const median = latencies.length % 2 ? latencies[middle] : (latencies[middle-1] + latencies[middle]) / 2;
    const bugs = group.filter(r => r.kind !== 'clean');
    rows.push(`| ${system} | ${kind} | ${group.length} | ${bugs.length ? (bugs.filter(r=>r.hit).length/bugs.length*100).toFixed(1)+'%' : 'N/A'} | ${group.length ? (fp/group.length).toFixed(2) : 'N/A'} | ${positive ? ((positive-fp)/positive*100).toFixed(1)+'%' : 'N/A'} | ${group.length ? (sum(r=>r.costUsd)/group.length).toFixed(6) : 'N/A'} | ${group.length ? median.toFixed(0) : 'N/A'} |`);
  }
  }
  return rows.join('\n')+'\n\nMatching: same file (leading ./ ignored), non-null line within ±3 of the edited line. Court counts convictions only; baselines count all findings. Every report on a clean PR is a false positive. Hit rate excludes clean PRs. Precision counts matching reports, including duplicates; FP/PR and cost/PR include every PR in the group. p50 is the median wall time of each reviewer call. Mutant survival does not establish a real bug.\n';
}
export async function runBenchmark(items: FixtureItem[], systems: System[], reviewers: Reviewers, options: {root?:string; now?:()=>number; prepare?:(item:FixtureItem)=>string; concurrency?:number} = {}): Promise<Result[]> {
  const root = options.root ?? benchRoot;
  const now = options.now ?? Date.now;
  const results: Result[] = [];
  const concurrency = options.concurrency ?? 2;
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid concurrency');
  // Prepare once before scheduling systems; workers never mutate these repositories.
  const inputs = items.map(item => {
    const repoPath = options.prepare ? options.prepare(item) : join(root, 'fixtures', item.repoDir);
    if (!options.prepare && !existsSync(join(repoPath, '.git'))) createItemRepo(item, repoPath, root);
    return {item, input:{title:item.description, repoPath, baseRef:item.baseRef, headRef:item.headRef}};
  });
  const jobs = inputs.flatMap(entry => systems.map(system => ({...entry, system})));
  let cursor = 0;
  await Promise.all(Array.from({length:Math.min(concurrency,jobs.length)}, async () => {
    while (cursor < jobs.length) {
      const index = cursor++;
      const {item, input, system} = jobs[index];
      const review = reviewers[system];
      if (!review) throw new Error(`Missing reviewer: ${system}`);
      const start = now();
      const output = await review(input);
      if ('status' in output && output.status === 'error') throw new Error(`Court failed for ${item.id}: ${output.error}`);
      results[index] = score(item, system, output, now()-start);
    }
  }));
  return results;
}
export function writeResults(results: Result[], directory = join(benchRoot, 'results')): string {
  mkdirSync(directory, {recursive:true});
  const path = join(directory, `${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
  writeFileSync(path, JSON.stringify(results,null,2)+'\n');
  writeFileSync(join(directory, 'latest.md'), summarize(results));
  return path;
}
export function parseArgs(args: string[]): {n:number; systems:System[]; kinds:Kind[]; concurrency:number} {
  let n = 25; let systems: System[] = ['court','baseline','baseline-ultra']; let kinds:Kind[] = ['clean','historical','mutant']; let concurrency = 2;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--n') { n = Number(args[++i]); if (!Number.isInteger(n) || n < 1) throw new Error('--n must be a positive integer'); }
    else if (args[i] === '--systems') { const values = (args[++i] ?? '').split(','); if (values.some(s=>s!=='court' && s!=='baseline' && s!=='baseline-ultra')) throw new Error('Unknown system'); systems = [...new Set(values)] as System[]; }
    else if (args[i] === '--concurrency') { concurrency = Number(args[++i]); if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid concurrency'); }
    else if (args[i] === '--kinds') { const values = (args[++i] ?? '').split(','); if (values.some(k=>!['clean','historical','mutant'].includes(k))) throw new Error('Unknown kind'); kinds = [...new Set(values)] as Kind[]; }
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  return {n, systems, kinds, concurrency};
}
