import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BenchItem, BenchResult, CaseRecord, Finding, LlmUsage } from '@kacheri/shared';
import { benchRoot, createItemRepo, type FixtureItem } from './mutate.js';
import { existsSync } from 'node:fs';
export type System = BenchResult['system'];
export interface ReviewInput { title: string; repoPath: string; baseRef: string; headRef: string }
export interface BaselineOutput { findings: Finding[]; usage: LlmUsage[] }
export interface Reviewers {
  court(input: ReviewInput): Promise<CaseRecord>;
  baseline(input: ReviewInput): Promise<BaselineOutput>;
}
const matches = (item: BenchItem, f: {file:string; line:number|null}) => f.file.replace(/^\.\//, '') === item.file && f.line !== null && Math.abs(f.line - item.line) <= 3;
export function score(item: BenchItem, system: System, output: CaseRecord | BaselineOutput, latencyMs: number): BenchResult {
  const isCourt = 'charges' in output;
  const reported = isCourt ? output.charges.filter(c => output.rulings.some(r => r.chargeId === c.id && r.decision === 'convicted')) : output.findings;
  return {itemId:item.id, system, findings:isCourt ? output.charges.length : output.findings.length,
    convicted:isCourt ? reported.length : 0, hit:reported.some(f => matches(item, f)),
    falsePositives:reported.filter(f => !matches(item, f)).length,
    costUsd:output.usage.reduce((sum, u) => sum + u.costUsd, 0), latencyMs};
}
export function summarize(results: BenchResult[]): string {
  const rows = ['| System | PRs | Hit rate | FP/PR | Precision | $/PR | p50 latency (ms) |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for (const system of ['court','baseline'] as const) {
    const group = results.filter(r => r.system === system);
    if (!group.length) continue;
    const sum = (fn: (r: BenchResult) => number) => group.reduce((n, r) => n + fn(r), 0);
    const positive = sum(r => system === 'court' ? r.convicted : r.findings);
    const fp = sum(r => r.falsePositives);
    const latencies = group.map(r => r.latencyMs).sort((a,b) => a-b);
    const middle = Math.floor(latencies.length / 2);
    const median = latencies.length % 2 ? latencies[middle] : (latencies[middle-1] + latencies[middle]) / 2;
    rows.push(`| ${system} | ${group.length} | ${(sum(r => +r.hit)/group.length*100).toFixed(1)}% | ${(fp/group.length).toFixed(2)} | ${positive ? ((positive-fp)/positive*100).toFixed(1)+'%' : 'N/A'} | ${(sum(r=>r.costUsd)/group.length).toFixed(6)} | ${median.toFixed(0)} |`);
  }
  return rows.join('\n')+'\n';
}
export async function runBenchmark(items: FixtureItem[], systems: System[], reviewers: Reviewers, options: {root?:string; now?:()=>number; prepare?:(item:FixtureItem)=>string} = {}): Promise<BenchResult[]> {
  const root = options.root ?? benchRoot;
  const now = options.now ?? Date.now;
  const results: BenchResult[] = [];
  for (const item of items) {
    const repoPath = options.prepare ? options.prepare(item) : join(root, 'fixtures', item.repoDir);
    if (!options.prepare && !existsSync(join(repoPath, '.git'))) createItemRepo(item, repoPath, root);
    const input = {title:item.description, repoPath, baseRef:item.baseRef, headRef:item.headRef};
    for (const system of systems) {
      const start = now();
      const output = await reviewers[system](input);
      if ('status' in output && output.status === 'error') throw new Error(`Court failed for ${item.id}: ${output.error}`);
      results.push(score(item, system, output, now()-start));
    }
  }
  return results;
}
export function writeResults(results: BenchResult[], directory = join(benchRoot, 'results')): string {
  mkdirSync(directory, {recursive:true});
  const path = join(directory, `${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
  writeFileSync(path, JSON.stringify(results,null,2)+'\n');
  writeFileSync(join(directory, 'latest.md'), summarize(results));
  return path;
}
export function parseArgs(args: string[]): {n:number; systems:System[]} {
  let n = 25; let systems: System[] = ['court','baseline'];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--n') { n = Number(args[++i]); if (!Number.isInteger(n) || n < 1) throw new Error('--n must be a positive integer'); }
    else if (args[i] === '--systems') { const values = (args[++i] ?? '').split(','); if (values.some(s=>s!=='court' && s!=='baseline')) throw new Error('Unknown system'); systems = [...new Set(values)] as System[]; }
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  return {n, systems};
}
