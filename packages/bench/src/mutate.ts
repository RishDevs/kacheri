import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BenchItem } from '@kacheri/shared';

export const benchRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export interface Mutation { operator: string; line: number; before: string; after: string; source: string }
export function mutations(source: string): Mutation[] {
  const result: Mutation[] = [];
  const seen = new Set<string>();
  const lines = source.split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;
    const add = (operator: string, start: number, length: number, replacement: string) => {
      const after = line.slice(0, start) + replacement + line.slice(start + length);
      const changed = [...lines]; changed[i] = after;
      const output = changed.join('\n');
      if (seen.has(output) || output === source) return;
      seen.add(output);
      result.push({operator, line: i + 1, before: line, after, source: output});
    };
    for (const m of line.matchAll(/===|!==|&&|\|\||(?<![=<>])<=?|(?<![=<>])>=?|(?<![=!])!(?!=)/g)) {
      const swaps: Record<string, string> = {'===':'!==', '!==':'===', '&&':'||', '||':'&&', '<':'<=', '<=':'<', '>':'>=', '>=':'>', '!':''};
      add(m[0] === '!' ? 'drop-negation' : /[<>]/.test(m[0]) ? 'off-by-one' : m[0].includes('=') ? 'flip-comparison' : 'logical-swap', m.index!, m[0].length, swaps[m[0]]);
    }
    for (const m of line.matchAll(/(?<![\w])\d+(?![\w])/g)) {
      for (const delta of [-1, 1]) add('off-by-one', m.index!, m[0].length, String(Number(m[0]) + delta));
    }
    for (const m of line.matchAll(/\b[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*\.length\b/g)) {
      for (const delta of [-1, 1]) add('off-by-one', m.index!, m[0].length, `(${m[0]} ${delta < 0 ? '-' : '+'} 1)`);
    }
    for (const m of line.matchAll(/([+-])\s*1\b/g)) add('off-by-one', m.index!, m[0].length, m[1] === '+' ? '- 1' : '+ 1');
    for (const m of line.matchAll(/\{(\d+),(\d+)\}/g)) {
      for (const delta of [-1, 1]) add('off-by-one', m.index!, m[0].length, `{${Math.max(0, Number(m[1])+delta)},${Number(m[2])+delta}}`);
    }
    for (const m of line.matchAll(/\b(slice|substring)\(([^()]*)\)/g)) {
      const originalArgs = m[2].split(',');
      originalArgs.forEach((arg, index) => {
        for (const boundary of [`(${arg}) - 1`, `(${arg}) + 1`, '0', '1', '-1']) {
          const args = [...originalArgs]; args[index] = boundary;
          add('slice-boundary', m.index!, m[0].length, `${m[1]}(${args.join(',')})`);
        }
      });
    }
    for (const m of line.matchAll(/\breturn (false|true|''|urlString);/g)) {
      const replacement = m[1] === 'false' ? 'true' : m[1] === 'true' ? 'false' : m[1] === "''" ? 'undefined' : "''";
      add('early-exit', m.index!, m[0].length, `return ${replacement};`);
    }
  });
  return result;
}
export function suitePasses(repo: string, timeout = 5000): boolean {
  const run = spawnSync(process.execPath, ['--test', 'test.js'], {cwd: repo, timeout, stdio: 'pipe'});
  return !run.error && run.status === 0;
}
export function filterSurvivors(repo: string, file: string, candidates: Mutation[], timeout = 5000): Mutation[] {
  const path = join(repo, file); const original = readFileSync(path, 'utf8');
  if (!suitePasses(repo, timeout)) throw new Error('Fixture baseline suite fails');
  try {
    return candidates.filter(candidate => { writeFileSync(path, candidate.source); return suitePasses(repo, timeout); });
  } finally { writeFileSync(path, original); }
}
export type Kind = 'mutant' | 'clean' | 'historical';
export interface FixtureItem extends BenchItem { kind: Kind; omittedTests?: string[]; upstreamCommit?: string; baseRef: string; headRef: string; repoDir: string }
function git(repo: string, args: string[]): string {
  const run = spawnSync('git', ['-c', 'user.name=Bench Fixture', '-c', 'user.email=bench@example.invalid', ...args], {
    cwd: repo, encoding: 'utf8', env: {...process.env, GIT_AUTHOR_DATE:'2026-01-01T00:00:00Z', GIT_COMMITTER_DATE:'2026-01-01T00:00:00Z'},
  });
  if (run.status !== 0) throw new Error(run.stderr || `git ${args[0]} failed`);
  return args[0] === 'diff' ? run.stdout : run.stdout.trim();
}
export function createItemRepo(item: FixtureItem, destination: string, root = benchRoot): string {
  cpSync(join(root, 'fixtures', item.repo), destination, {recursive: true});
  git(destination, ['init', '--quiet']); git(destination, ['add', '.']);
  git(destination, ['commit', '--quiet', '-m', 'Import upstream fixture']);
  if (item.omittedTests?.length) {
    writeFileSync(join(destination, 'test.js'), omitTests(readFileSync(join(destination, 'test.js'), 'utf8'), item.omittedTests));
    git(destination, ['add', '.']); git(destination, ['commit', '--quiet', '-m', 'Prepare review suite']);
  }
  if (git(destination, ['rev-parse', 'HEAD']) !== item.baseRef) throw new Error('Fixture base hash mismatch; run gen');
  const apply = spawnSync('git', ['apply', '-'], {cwd: destination, input: item.patch, encoding: 'utf8'});
  if (apply.status !== 0) throw new Error(apply.stderr);
  git(destination, ['add', '.']); git(destination, ['commit', '--quiet', '-m', item.description]);
  if (git(destination, ['rev-parse', 'HEAD']) !== item.headRef) throw new Error('Fixture head hash mismatch; run gen');
  return destination;
}
export function generate(): FixtureItem[] {
  const temp = mkdtempSync(join(tmpdir(), 'kacheri-gen-'));
  try {
    const repo = join(temp, 'repo');
    cpSync(join(benchRoot, 'fixtures/normalize-url'), repo, {recursive: true});
    const source = readFileSync(join(repo, 'index.js'), 'utf8');
    const candidates = mutations(source);
    const survivors = filterSurvivors(repo, 'index.js', candidates);
    git(repo, ['init', '--quiet']); git(repo, ['add', '.']); git(repo, ['commit', '--quiet', '-m', 'Import upstream fixture']);
    const pristineRef = git(repo, ['rev-parse', 'HEAD']);
    const testSource = readFileSync(join(repo, 'test.js'), 'utf8');
    const variants: Variant[] = [...survivors.map(m => ({...m, kind:'mutant' as const})), ...cleanVariants(source), ...historicalVariants(source)];
    const items = variants.map(m => {
      git(repo, ['checkout', '--quiet', '--detach', pristineRef]);
      let omittedTests: string[] = [];
      if (m.kind === 'historical') {
        writeFileSync(join(repo, 'index.js'), m.source);
        const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'test.js'], {cwd:repo, encoding:'utf8', timeout:5000});
        if (run.error) throw run.error;
        omittedTests = [...run.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1]);
        if (!omittedTests.length) throw new Error('Full suite does not catch historical regression: '+m.upstreamCommit);
        writeFileSync(join(repo, 'test.js'), omitTests(testSource, omittedTests));
        if (!suitePasses(repo)) throw new Error('Historical suite still fails: '+m.upstreamCommit);
        writeFileSync(join(repo, 'index.js'), source);
        if (!suitePasses(repo)) throw new Error('Historical base fails');
        if (omittedTests.length) {
          git(repo, ['add', '.']); git(repo, ['commit', '--quiet', '-m', 'Prepare review suite']);
        }
      }
      const baseRef = git(repo, ['rev-parse', 'HEAD']);
      writeFileSync(join(repo, 'index.js'), m.source);
      if (!suitePasses(repo)) throw new Error('Variant suite fails');
      const patch = git(repo, ['diff', '--', 'index.js']) + '\n';
      const id = createHash('sha256').update(m.source).digest('hex').slice(0, 12);
      const description = m.kind === 'clean' ? 'Clarify URL normalization implementation' : 'Refactor URL normalization edge handling';
      git(repo, ['add', '.']); git(repo, ['commit', '--quiet', '-m', description]);
      return {id, kind:m.kind, ...(m.upstreamCommit ? {upstreamCommit:m.upstreamCommit, omittedTests} : {}), repo:'normalize-url', file:'index.js', line:m.line, operator:m.operator, description, patch, baseRef, headRef:git(repo, ['rev-parse', 'HEAD']), repoDir:`repos/${id}`} satisfies FixtureItem;
    });
    mkdirSync(join(benchRoot, 'fixtures'), {recursive:true});
    writeFileSync(join(benchRoot, 'fixtures/survivors.json'), JSON.stringify(items, null, 2) + '\n');
    writeFileSync(join(benchRoot, 'fixtures/generation.json'), JSON.stringify({candidates:candidates.length, survivors:survivors.length, clean:items.filter(i=>i.kind==='clean').length, historical:items.filter(i=>i.kind==='historical').length, suite:'node --test test.js'}, null, 2) + '\n');
    console.log(`Generated ${items.length} items (${survivors.length} surviving mutants)`);
    return items;
  } finally { rmSync(temp, {recursive:true, force:true}); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) generate();

interface Variant { source:string; line:number; operator:string; kind:Kind; upstreamCommit?:string }
export function omitTests(source:string, names:string[]):string {
  return source.split(/(?=^test\()/m).filter(block => !names.some(name => block.startsWith(`test('${name}',`))).join('');
}
export function cleanVariants(source:string):Variant[] {
  const names = ['testParameter','supportedProtocols','hasCustomProtocol','normalizeDataURL','mediaType','normalizedMediaType','isBase64','pathComponents','lastComponent','oldUrlString'];
  const variants = names.map(name => ({source:source.replace(new RegExp('\\b'+name+'\\b','g'), name+'Value'), line:source.slice(0,source.indexOf(name)).split('\n').length, operator:'rename-local', kind:'clean' as const}));
  variants.push({source:'/** Normalize a URL using the supplied options. */\n'+source, line:1,operator:'jsdoc',kind:'clean'});
  variants.push({source:source.replace("\t\turlObject.username = '';\n\t\turlObject.password = '';", "\t\turlObject.password = '';\n\t\turlObject.username = '';"),line:150,operator:'reorder-independent',kind:'clean'});
  return variants;
}
export function historicalVariants(source:string):Variant[] {
  const specs = JSON.parse(readFileSync(join(benchRoot,'fixtures/history.json'),'utf8')) as {sha:string; before:string; after:string}[];
  return specs.map(spec => {
    if (!source.includes(spec.after)) throw new Error('Historical fix does not apply: '+spec.sha);
    return {source:source.replace(spec.after,spec.before),line:source.slice(0,source.indexOf(spec.after)).split('\n').length,operator:'revert-upstream-fix',kind:'historical',upstreamCommit:spec.sha};
  });
}
