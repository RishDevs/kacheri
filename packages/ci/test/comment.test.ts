import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CaseRecord } from '@kacheri/shared';
import { COMMENT_MARKER, renderComment } from '../src/comment';

function record(): CaseRecord {
  return {
    id: 'case_test', title: 'Regression review', repoPath: '.', baseRef: 'a'.repeat(40), headRef: 'b'.repeat(40),
    status: 'closed', error: null, startedAt: '', endedAt: '', rebuttals: [], evidence: [],
    charges: [
      { id: 'c1', claim: 'Breaks values', severity: 'major', file: 'value.cjs', line: 1, witnessPath: '__kacheri__/c1.test.mjs', witnessCode: "import assert from 'node:assert/strict';\nimport value from '../value.cjs';\nassert.equal(value, 1);" },
      { id: 'c2', claim: 'Unproven', severity: 'minor', file: 'other.js', line: null, witnessPath: '__kacheri__/c2.test.mjs', witnessCode: 'throw new Error("dismissed");' },
    ],
    rulings: [ { chargeId: 'c1', decision: 'convicted', reason: 'Proven regression' }, { chargeId: 'c2', decision: 'dismissed', reason: 'Flaky witness' } ],
    usage: [
      { tier: 'nano', model: 'nano', role: 'prosecutor', promptTokens: 10, completionTokens: 20, costUsd: 0.01, latencyMs: 1 },
      { tier: 'super', model: 'super', role: 'defense', promptTokens: 10, completionTokens: 20, costUsd: 0.02, latencyMs: 1 },
      { tier: 'ultra', model: 'ultra', role: 'judge', promptTokens: 10, completionTokens: 20, costUsd: 0.03, latencyMs: 1 },
    ],
  };
}

describe('PR comment', () => {
  it('renders verdict, all charges, dismissed count, witnesses and aggregate cost', () => {
    const r = record();
    const md = renderComment(r);
    expect(md).toContain(COMMENT_MARKER);
    expect(md).toContain('## Kacheri Court: CONVICTED');
    expect(md).toContain('| c1 | major | value.cjs:1 | Breaks values | CONVICTED | Proven regression |');
    expect(md).toContain('| c2 | minor | other.js | Unproven | DISMISSED | Flaky witness |');
    expect(md).toContain('Dismissed charges: 1 (c2).');
    expect(md).toContain('<details>');
    expect(md).toContain(r.charges[0].witnessCode);
    expect(md).not.toContain(r.charges[1].witnessCode);
    expect(md).toContain('Nemotron tiers used: Nano, Super, Ultra. Total cost: $0.060000 USD.');
  });

  it('handles no charges, dismissals, case errors and incomplete cases', () => {
    const r = record();
    r.rulings[0].decision = 'dismissed';
    expect(renderComment(r)).toContain('## Kacheri Court: DISMISSED');
    expect(renderComment(r)).not.toContain('<details>');
    r.charges = []; r.rulings = []; r.usage = [];
    expect(renderComment(r)).toContain('No charges filed');
    expect(renderComment(r)).toContain('tiers used: none. Total cost: $0.000000');
    r.status = 'error'; r.error = 'git failed';
    expect(renderComment(r)).toContain('## Kacheri Court: ERROR');
    expect(renderComment(r)).toContain('Case error: git failed');
    r.status = 'trial';
    expect(renderComment(r)).toContain('## Kacheri Court: INCOMPLETE');
  });

  it('escapes table cells and keeps embedded fences inside witness blocks', () => {
    const r = record();
    r.charges[0].claim = '<details> | bad\n`code`';
    r.charges[0].witnessCode = '// ```\n// KACHERI_WITNESS\nconsole.log("$HOME");';
    const md = renderComment(r);
    expect(md).toContain('&lt;details&gt; &#124; bad &#96;code&#96;');
    expect(md).toContain('````javascript\n' + r.charges[0].witnessCode + '\n````');
    r.charges[0].id = '../../escape'; r.rulings[0].chargeId = '../../escape';
    expect(() => renderComment(r)).toThrow('Unsafe charge id');
  });

  it('produces runnable repro commands that preserve bytes and fail on head, pass on base', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kacheri-ci-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    try {
      git('init', '-q'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test');
      writeFileSync(join(dir, 'value.cjs'), 'module.exports = 1;');
      git('add', '.'); git('commit', '-qm', 'base');
      const r = record(); r.baseRef = git('rev-parse', 'HEAD');
      writeFileSync(join(dir, 'value.cjs'), 'module.exports = 2;');
      git('commit', '-qam', 'head'); r.headRef = git('rev-parse', 'HEAD');
      const script = renderComment(r).match(/```sh\n([\s\S]*?)\n```/)![1].replaceAll('node --test ', 'node --test --test-reporter=tap ');
      const result = spawnSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('not ok');
      expect(result.stdout).toContain('# pass 1');
      expect(readFileSync(join(dir, '__kacheri__/c1.test.mjs'), 'utf8')).toBe(r.charges[0].witnessCode);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('CLI reads a CaseRecord file and writes markdown', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kacheri-comment-'));
    try {
      const input = join(dir, 'case.json'); const output = join(dir, 'comment.md');
      const r = record(); writeFileSync(input, JSON.stringify(r));
      execFileSync(process.execPath, ['--import', 'tsx', 'packages/ci/src/comment.ts', input, output]);
      expect(readFileSync(output, 'utf8')).toBe(renderComment(r));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
