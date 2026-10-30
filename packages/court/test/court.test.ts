import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatRequest, ChatResponse, CourtEvent, LlmClient } from '@kacheri/shared';
import { classify, judgeAdmissibility, lintWitness, renderVerdict, runBaseline, runCase } from '../src/index';

const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const w = (p: string, s: string) => (mkdirSync(path.dirname(p), { recursive: true }), writeFileSync(p, s));

const witness = (body: string) => `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clamp } from '../src/clamp.js';
test('w', () => { ${body} });
`;

// Scripted Nemotron: answers by role, records every request.
function fakeLlm(script: Partial<Record<ChatRequest['role'], (req: ChatRequest) => string>>): LlmClient & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  return {
    calls,
    async chat(req): Promise<ChatResponse> {
      calls.push(req);
      const content = script[req.role]?.(req) ?? '{}';
      return { content, usage: { tier: req.tier, role: req.role, model: `m-${req.tier}`, promptTokens: 100, completionTokens: 10, costUsd: 0.001, latencyMs: 1 } };
    },
  };
}

let dir: string, repo: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'kacheri-court-t-'));
  repo = path.join(dir, 'repo');
  mkdirSync(repo);
  g(repo, 'init', '-q', '-b', 'main');
  g(repo, 'config', 'user.email', 't@t');
  g(repo, 'config', 'user.name', 't');
  w(path.join(repo, 'package.json'), '{"type":"module"}');
  w(path.join(repo, 'src/clamp.js'), 'export function clamp(x, lo, hi) {\n  if (x < lo) return lo;\n  if (x > hi) return hi;\n  return x;\n}\n');
  w(path.join(repo, 'test/clamp.test.js'), "import { clamp } from '../src/clamp.js';\n");
  g(repo, 'add', '-A');
  g(repo, 'commit', '-qm', 'base');
  g(repo, 'checkout', '-qb', 'feature');
  // The "PR": a refactor that breaks the upper boundary.
  w(path.join(repo, 'src/clamp.js'), 'export function clamp(x, lo, hi) {\n  if (x < lo) return lo;\n  if (x >= hi) return hi - 1;\n  return x;\n}\n');
  g(repo, 'commit', '-qam', 'Simplify clamp bounds');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('classification', () => {
  it('separates broken witnesses from failing ones', () => {
    expect(classify(0, false, '# tests 1\n# pass 1')).toBe('pass');
    expect(classify(1, false, 'AssertionError [ERR_ASSERTION]')).toBe('fail');
    expect(classify(1, false, "SyntaxError: Unexpected token")).toBe('error');
    expect(classify(1, false, 'Error [ERR_ACCESS_DENIED]: Access to this API has been restricted')).toBe('error');
    expect(classify(0, false, '# tests 0')).toBe('error');
    expect(classify(null, true, '')).toBe('timeout');
  });
  it('requires consistent fail-on-head and pass-on-base', () => {
    expect(judgeAdmissibility('c1', ['pass', 'pass', 'pass'], ['fail', 'fail', 'fail'], '').admissible).toBe(true);
    expect(judgeAdmissibility('c1', ['pass', 'pass', 'pass'], ['fail', 'pass', 'fail'], '').reason).toMatch(/flaky/);
    expect(judgeAdmissibility('c1', ['fail', 'fail', 'fail'], ['fail', 'fail', 'fail'], '').reason).toMatch(/also fails on base/);
    expect(judgeAdmissibility('c1', ['pass', 'pass', 'pass'], ['pass', 'pass', 'pass'], '').reason).toMatch(/passes on head/);
  });
});

describe('witness lint', () => {
  it('rejects witnesses that inspect source, env, time or the system instead of behaviour', () => {
    expect(lintWitness("import fs from 'node:fs';\nimport { clamp } from '../src/clamp.js';")).toMatch(/system module/);
    expect(lintWitness("import { clamp } from '../src/clamp.js';\nassert.ok(clamp.toString().includes('>='))")).toMatch(/function source/);
    expect(lintWitness("import { clamp } from '../src/clamp.js';\nprocess.env.NEBIUS_API_KEY")).toMatch(/process state/);
    expect(lintWitness("import { clamp } from '../src/clamp.js';\nDate.now()")).toMatch(/time/);
    expect(lintWitness("import assert from 'node:assert/strict';")).toMatch(/does not import/);
    expect(lintWitness(witness('assert.equal(clamp(1, 0, 2), 1);'))).toBeNull();
  });
  it('treats base-pass + head-crash as a breaking change, but not a sandbox violation', () => {
    expect(judgeAdmissibility('c1', ['pass', 'pass', 'pass'], ['error'], 'SyntaxError: does not provide an export named clamp').admissible).toBe(true);
    expect(judgeAdmissibility('c1', ['pass', 'pass', 'pass'], ['error'], 'ERR_ACCESS_DENIED').admissible).toBe(false);
    expect(judgeAdmissibility('c1', ['error'], ['error'], '').reason).toMatch(/errors on base/);
  });
});

describe('runCase', () => {
  it('convicts only on admissible evidence and never shows inadmissible charges to the judge', async () => {
    const llm = fakeLlm({
      prosecutor: (req) =>
        req.temperature === 0.2
          ? JSON.stringify({
              charges: [
                { claim: 'clamp(10,0,10) returns 9 instead of 10', file: 'src/clamp.js', line: 3, severity: 'major', witnessCode: witness('assert.equal(clamp(10, 0, 10), 10);') },
                { claim: 'lower bound broken', file: 'src/clamp.js', line: 2, severity: 'minor', witnessCode: witness('assert.equal(clamp(-1, 0, 10), 0);') },
                { claim: 'imports a missing helper', file: 'src/clamp.js', line: 1, severity: 'minor', witnessCode: "import { nope } from '../src/nope.js';\n" },
              ],
            })
          : 'Here you go:\n```json\n' +
            JSON.stringify({ charges: [{ claim: 'clamp(5,0,3) is wrong on both', file: 'src/clamp.js', line: 3, severity: 'minor', witnessCode: witness('assert.equal(clamp(5, 0, 3), 4);') }] }) +
            '\n```',
      defense: () => JSON.stringify({ argument: 'Upper bound is inclusive per the original; this is a regression.', concedes: true }),
      judge: (req) => {
        expect(req.reasoning).toBe(true);
        const docket = req.messages[1].content;
        expect(docket).toContain('c1');
        expect(docket).not.toContain('## c2');
        return JSON.stringify({ rulings: [{ chargeId: 'c1', decision: 'convicted', reason: 'Witness proves the upper bound regression.' }] });
      },
    });
    const events: CourtEvent[] = [];
    const r = await runCase({ repoPath: repo, baseRef: 'main', headRef: 'feature', llm, onEvent: (e) => events.push(e) });

    expect(r.status).toBe('closed');
    expect(r.error).toBeNull();
    expect(r.title).toBe('Simplify clamp bounds');
    expect(r.charges.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
    const ev = Object.fromEntries(r.evidence.map((e) => [e.chargeId, e]));
    expect(ev.c1.admissible).toBe(true);
    expect(ev.c2.reason).toMatch(/passes on head/);
    expect(ev.c3.reason).toMatch(/broken/);
    expect(ev.c4.reason).toMatch(/also fails on base/);
    expect(r.rulings.map((x) => `${x.chargeId}:${x.decision}`)).toEqual(['c1:convicted', 'c2:dismissed', 'c3:dismissed', 'c4:dismissed']);
    // Only one defense and one judge call: models are not consulted on inadmissible charges.
    expect(llm.calls.filter((c) => c.role === 'defense')).toHaveLength(1);
    expect(llm.calls.filter((c) => c.role === 'judge').map((c) => c.tier)).toEqual(['ultra']);
    expect(llm.calls.filter((c) => c.role === 'prosecutor').every((c) => c.tier === 'nano')).toBe(true);
    expect(events.some((e) => e.type === 'ruling')).toBe(true);
    expect(renderVerdict(r)).toContain('GUILTY on 1 charge');
    // Throwaway checkouts are cleaned up and the user's repo is untouched.
    expect(g(repo, 'worktree', 'list').split('\n')).toHaveLength(1);
    expect(g(repo, 'status', '--porcelain')).toBe('');
    expect(existsSync(path.join(repo, '__kacheri__'))).toBe(false);
  });

  it('repairs a witness that cannot pass on base once, then tries it on head; tells the prosecutor the public API', async () => {
    const llm = fakeLlm({
      prosecutor: (req) =>
        req.messages[0].content.includes('Before it can be used as evidence')
          ? JSON.stringify({ witnessCode: witness('assert.equal(clamp(10, 0, 10), 10);') })
          : JSON.stringify({ charges: [{ claim: 'upper bound', file: 'src/clamp.js', line: 3, severity: 'major', witnessCode: "import { clampInternal } from '../src/clamp.js';\nclampInternal();" }] }),
      defense: () => JSON.stringify({ argument: 'x', concedes: true }),
      judge: () => JSON.stringify({ rulings: [{ chargeId: 'c1', decision: 'convicted', reason: 'proven' }] }),
    });
    const r = await runCase({ repoPath: repo, baseRef: 'main', headRef: 'feature', llm, prosecutors: 1, remedy: false });
    expect(llm.calls[0].messages[1].content).toContain("import { clamp } from '../src/clamp.js'");
    expect(r.charges[0].revised).toBe(true);
    expect(r.evidence[0].admissible).toBe(true);
    expect(r.rulings[0].decision).toBe('convicted');
  });

  it('a witness cannot escape the sandbox to fake evidence', async () => {
    const escape = `import { execSync } from 'node:child_process';\nexecSync('touch ${path.join(dir, 'pwned')}');\nprocess.exit(1);\n`;
    const llm = fakeLlm({ prosecutor: () => JSON.stringify({ charges: [{ claim: 'x', file: 'src/clamp.js', line: 1, severity: 'critical', witnessCode: escape }] }) });
    const r = await runCase({ repoPath: repo, baseRef: 'main', headRef: 'feature', llm, prosecutors: 1 });
    expect(r.evidence[0].admissible).toBe(false);
    expect(r.evidence[0].reason).toMatch(/rejected before running/);
    // Even if the lint were bypassed (custom command, no lint), the sandbox itself denies the spawn.
    const raw = await runCase({ repoPath: repo, baseRef: 'main', headRef: 'feature', prosecutors: 1, llm: fakeLlm({ prosecutor: () => JSON.stringify({ charges: [{ claim: 'x', file: 'src/clamp.js', line: 1, severity: 'critical', witnessCode: "import { clamp } from '../src/clamp.js';\nconst cp = await import('node:child_process');\ncp.execSync('touch " + path.join(dir, 'pwned') + "');" }] }) }) });
    expect(raw.evidence[0].admissible).toBe(false);
    expect(r.rulings[0].decision).toBe('dismissed');
    expect(readdirSync(dir)).not.toContain('pwned');
  });

  it('survives garbage from every model and reports no convictions', async () => {
    const llm = fakeLlm({ prosecutor: () => 'I cannot help', defense: () => 'nope', judge: () => 'nope' });
    const r = await runCase({ repoPath: repo, baseRef: 'main', headRef: 'feature', llm });
    expect(r.status).toBe('closed');
    expect(r.charges).toHaveLength(0);
    // 2 Nano prosecutors x (call + JSON retry), then one Super escalation x (call + retry) because nothing was proven.
    expect(llm.calls.filter((c) => c.role === 'prosecutor').map((c) => c.tier)).toEqual(['nano', 'nano', 'nano', 'nano', 'super', 'super']);
  });

  it('records a case error for a bad ref instead of throwing', async () => {
    const r = await runCase({ repoPath: repo, baseRef: 'main', headRef: 'does-not-exist', llm: fakeLlm({}) });
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/does-not-exist/);
  });
});

describe('remedy', () => {
  const convict = {
    prosecutor: () => JSON.stringify({ charges: [{ claim: 'clamp(10,0,10) returns 9', file: 'src/clamp.js', line: 3, severity: 'major', witnessCode: witness('assert.equal(clamp(10, 0, 10), 10);') }] }),
    defense: () => JSON.stringify({ argument: 'none', concedes: true }),
    judge: () => JSON.stringify({ rulings: [{ chargeId: 'c1', decision: 'convicted', reason: 'proven' }] }),
  };
  const fixed = 'export function clamp(x, lo, hi) {\n  if (x < lo) return lo;\n  if (x > hi) return hi;\n  return x;\n}\n';

  it('verifies a fix only when the witness now passes and the suite stays green; rejects out-of-scope edits first', async () => {
    let n = 0;
    const llm = fakeLlm({
      ...convict,
      remedy: () =>
        ++n === 1
          ? JSON.stringify({ explanation: 'sneaky', files: [{ path: 'test/clamp.test.js', content: '' }] })
          : JSON.stringify({ explanation: 'Restore the inclusive upper bound.', files: [{ path: 'src/clamp.js', content: fixed }] }),
    });
    const r = await runCase({ repoPath: repo, baseRef: 'main', headRef: 'feature', llm, prosecutors: 1, testCommand: ['node', '-e', "require('fs').readFileSync('src/clamp.js','utf8').includes('x > hi')||process.exit(1)"] });
    expect(r.remedy?.verified).toBe(true);
    expect(r.remedy?.attempts).toBe(2);
    expect(r.remedy?.suite).toBe('pass');
    expect(r.remedy?.witnesses).toEqual([{ chargeId: 'c1', outcomes: ['pass', 'pass', 'pass'] }]);
    expect(r.remedy?.patch).toContain('+  if (x > hi) return hi;');
    expect(renderVerdict(r)).toContain('Remedy: VERIFIED');
    expect(g(repo, 'status', '--porcelain')).toBe('');
    expect(g(repo, 'worktree', 'list').split('\n')).toHaveLength(1);
  });

  it('does not verify a fix that breaks the existing suite, and never changes the verdict', async () => {
    const llm = fakeLlm({ ...convict, remedy: () => JSON.stringify({ explanation: 'x', files: [{ path: 'src/clamp.js', content: fixed }] }) });
    const r = await runCase({ repoPath: repo, baseRef: 'main', headRef: 'feature', llm, prosecutors: 1, testCommand: ['node', '-e', 'process.exit(1)'] });
    expect(r.remedy?.verified).toBe(false);
    expect(r.remedy?.suite).toBe('fail');
    expect(r.rulings[0].decision).toBe('convicted');
  });
});

describe('runBaseline', () => {
  it('returns whatever the single reviewer claims, unverified', async () => {
    const llm = fakeLlm({ baseline: () => JSON.stringify({ findings: [{ file: 'src/clamp.js', line: 3, severity: 'major', message: 'off by one' }, { file: 'src/clamp.js', line: 1, message: 'naming' }] }) });
    const r = await runBaseline({ repoPath: repo, baseRef: 'main', headRef: 'feature', llm });
    expect(r.findings).toHaveLength(2);
    expect(llm.calls[0].tier).toBe('super');
  });
});
