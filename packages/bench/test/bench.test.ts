import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mutations, filterSurvivors, benchRoot, createItemRepo, suitePasses, type FixtureItem } from '../src/mutate.js';
import { score, summarize, runBenchmark, parseArgs, writeResults } from '../src/runner.js';
import type { CaseRecord, Finding } from '@kacheri/shared';
const item: FixtureItem = {kind:'mutant',id:'one',repo:'tiny',file:'index.js',line:10,operator:'off-by-one',description:'Adjust boundary',patch:'',baseRef:'base',headRef:'head',repoDir:'repos/one'};
const finding = (line: number|null, file = 'index.js'): Finding => ({file,line,severity:'minor',message:'bug',suggestion:null});
const record = {charges:[{...finding(13),id:'hit'},{...finding(14),id:'fp'},{...finding(10),id:'dismissed'}],rulings:[{chargeId:'hit',decision:'convicted'},{chargeId:'fp',decision:'convicted'},{chargeId:'dismissed',decision:'dismissed'}],usage:[],status:'closed'} as unknown as CaseRecord;
describe('mutation operators', () => {
  it('emits every required operator and single-line edits', () => {
    const source = 'if (x < 4 && y === 2) return false;\nif (!x) return s.slice(0, -1);\nconst z = x + 1;';
    const candidates = mutations(source);
    for (const operator of ['off-by-one','logical-swap','flip-comparison','drop-negation','slice-boundary','early-exit']) expect(candidates.some(m=>m.operator===operator)).toBe(true);
    for (const m of candidates) expect(m.source.split('\n').filter((line,i)=>line!==source.split('\n')[i])).toHaveLength(1);
    expect(new Set(candidates.map(m=>m.source)).size).toBe(candidates.length);
  });
  it('retains survivors, rejects killed and invalid mutants, restores source', () => {
    const dir = mkdtempSync(join(tmpdir(),'bench-test-'));
    const source = 'export const f = x => x < 4;\n';
    try {
      writeFileSync(join(dir,'package.json'),'{"type":"module"}');
      writeFileSync(join(dir,'index.js'),source);
      writeFileSync(join(dir,'test.js'),"import {test} from 'node:test'; import assert from 'node:assert/strict'; import {f} from './index.js'; test('small',()=>assert.equal(f(1),true));");
      const candidates = mutations(source);
      candidates.push({operator:'invalid',line:1,before:source,after:'syntax!',source:'syntax!'});
      candidates.push({operator:'killed',line:1,before:source,after:'',source:'export const f = x => x < 0;'});
      const survivors = filterSurvivors(dir,'index.js',candidates);
      expect(survivors.some(m=>m.source.includes('<= 4'))).toBe(true);
      expect(survivors.some(m=>m.operator==='invalid' || m.operator==='killed')).toBe(false);
      expect(readFileSync(join(dir,'index.js'),'utf8')).toBe(source);
      writeFileSync(join(dir,'test.js'),"throw Error('baseline failed')");
      expect(()=>filterSurvivors(dir,'index.js',candidates)).toThrow('baseline');
    } finally { rmSync(dir,{recursive:true,force:true}); }
  });
});
describe('scoring and runner', () => {
  it('scores convictions only, inclusive tolerance, wrong file and null lines', () => {
    expect(score(item,'court',record,20)).toMatchObject({findings:3,convicted:2,hit:true,falsePositives:1,latencyMs:20});
    expect(score(item,'baseline',{findings:[finding(7),finding(null),finding(10,'other.js')],usage:[]},10)).toMatchObject({hit:true,falsePositives:2,findings:3,convicted:0});
    expect(score(item,'baseline',{findings:[finding(14)],usage:[]},1).hit).toBe(false);
  });
  it('runs both injected systems without importing Court or LLM and writes summaries', async () => {
    let time = 0;
    const results = await runBenchmark([item],['court','baseline'],{court:async input=>{expect(input.baseRef).toBe('base');return record;},baseline:async()=>({findings:[finding(10)],usage:[]})},{prepare:()=>'/fake',now:()=>time+=10,concurrency:1});
    expect(results).toHaveLength(2);
    expect(results.every(r=>r.hit && r.latencyMs===10)).toBe(true);
    const text = summarize(results);
    expect(text).toContain('100.0%'); expect(text).toContain('| court |');
    const dir = mkdtempSync(join(tmpdir(),'bench-results-'));
    try { expect(JSON.parse(readFileSync(writeResults(results,dir),'utf8'))).toEqual(results); expect(readFileSync(join(dir,'latest.md'),'utf8')).toBe(text); }
    finally {rmSync(dir,{recursive:true,force:true});}
  });
  it('validates CLI options',()=>{
    expect(parseArgs(['--n','2','--systems','baseline'])).toEqual({n:2,systems:['baseline'],kinds:['clean','historical','mutant'],concurrency:2});
    expect(()=>parseArgs(['--n','NaN'])).toThrow(); expect(()=>parseArgs(['--systems','typo'])).toThrow();
  });
});
it('checked-in survivors rebuild as real git repositories with passing suites',()=>{
  const items = JSON.parse(readFileSync(join(benchRoot,'fixtures/survivors.json'),'utf8')) as FixtureItem[];
  expect(items.length).toBeGreaterThanOrEqual(30);
  const dir = mkdtempSync(join(tmpdir(),'bench-rebuild-'));
  try {const repo = createItemRepo(items[0],join(dir,'repo')); expect(suitePasses(repo)).toBe(true);}
  finally {rmSync(dir,{recursive:true,force:true});}
});

it('clean reports are always false positives, including exact-location findings', () => {
  for (const system of ['court','baseline','baseline-ultra'] as const) {
    const output = system === 'court' ? record : {findings:[finding(10)],usage:[]};
    const result = score({...item,kind:'clean'},system,output,1);
    expect(result.hit).toBe(false);
    expect(result.falsePositives).toBe(system === 'court' ? 2 : 1);
    expect(summarize([result])).toContain('N/A');
  }
});
it('CLI selects all systems and kinds and rejects invalid concurrency', () => {
  expect(parseArgs(['--kinds','historical,clean','--systems','baseline-ultra','--concurrency','3'])).toMatchObject({kinds:['historical','clean'],systems:['baseline-ultra'],concurrency:3});
  for (const args of [['--concurrency','0'],['--concurrency','1.5'],['--kinds','typo']]) expect(()=>parseArgs(args)).toThrow();
});
it('limits active reviews and preserves result order', async () => {
  let active = 0; let peak = 0;
  const review = async () => {
    active++; peak = Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,5));
    active--; return {findings:[],usage:[]};
  };
  const results = await runBenchmark([item,{...item,id:'two'}],['baseline','baseline-ultra'],{court:async()=>record,baseline:review,'baseline-ultra':review},{prepare:()=>'/fake',concurrency:2});
  expect(peak).toBe(2);
  expect(results.map(r=>r.itemId)).toEqual(['one','one','two','two']);
});
it('clean and historical repositories have passing base/head suites; full tests catch historical regressions', () => {
  const items = JSON.parse(readFileSync(join(benchRoot,'fixtures/survivors.json'),'utf8')) as FixtureItem[];
  expect(items.filter(i=>i.kind==='clean').length).toBeGreaterThanOrEqual(10);
  expect(items.filter(i=>i.kind==='historical')).toHaveLength(5);
  const temp = mkdtempSync(join(tmpdir(),'bench-controls-'));
  try {
    for (const item of items.filter(i=>i.kind !== 'mutant')) {
      const repo = createItemRepo(item,join(temp,item.id));
      expect(suitePasses(repo),item.id+' head').toBe(true);
      const headSource = readFileSync(join(repo,'index.js'),'utf8');
      const base = spawnSync('git',['show',item.baseRef+':index.js'],{cwd:repo,encoding:'utf8'});
      expect(base.status).toBe(0);
      expect(base.stdout).toBe(readFileSync(join(benchRoot,'fixtures/normalize-url/index.js'),'utf8'));
      writeFileSync(join(repo,'index.js'),base.stdout);
      expect(suitePasses(repo),item.id+' base').toBe(true);
      if (item.kind === 'historical') {
        expect(item.omittedTests!.length).toBeGreaterThan(0);
        writeFileSync(join(repo,'index.js'),headSource);
        writeFileSync(join(repo,'test.js'),readFileSync(join(benchRoot,'fixtures/normalize-url/test.js'),'utf8'));
        expect(suitePasses(repo),item.upstreamCommit).toBe(false);
      }
    }
  } finally {rmSync(temp,{recursive:true,force:true});}
}, 30000);
