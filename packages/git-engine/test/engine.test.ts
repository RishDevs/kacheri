import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGitEngine, globToRegExp, checkOwnership } from '../src/index';
import type { GitEngine } from '@kacheri/shared';

const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const write = (p: string, s: string) => {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, s);
};

let dir: string, repo: string, wtRoot: string, engine: GitEngine;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'kacheri-ge-'));
  repo = path.join(dir, 'repo');
  wtRoot = path.join(dir, 'wt');
  mkdirSync(repo);
  g(repo, 'init', '-q', '-b', 'main');
  g(repo, 'config', 'user.email', 't@t');
  g(repo, 'config', 'user.name', 't');
  write(path.join(repo, 'web/a.ts'), 'a\n');
  write(path.join(repo, 'api/b.ts'), 'b\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-qm', 'init');
  engine = createGitEngine(repo, { worktreeRoot: wtRoot });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('globs and ownership', () => {
  it('matches the glob subset', () => {
    expect(globToRegExp('web/**').test('web/x/y.ts')).toBe(true);
    expect(globToRegExp('web/**').test('webx/y.ts')).toBe(false);
    expect(globToRegExp('web/').test('web/y.ts')).toBe(true);
    expect(globToRegExp('**/*.md').test('README.md')).toBe(true);
    expect(globToRegExp('**/*.md').test('a/b/c.md')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false);
    expect(globToRegExp('a.ts').test('aXts')).toBe(false);
  });
  it('flags both ends of a rename', () => {
    const r = checkOwnership([{ path: 'web/x.ts', oldPath: 'api/b.ts', kind: 'renamed', additions: 0, deletions: 0 }], ['web/**']);
    expect(r).toEqual({ ok: false, violations: ['api/b.ts'] });
  });
});

describe('worktrees', () => {
  it('creates idempotently and rejects bad ids', async () => {
    const a = await engine.createWorktree('t1');
    expect(a.branch).toBe('kacheri/t1');
    expect(existsSync(path.join(a.path, 'web/a.ts'))).toBe(true);
    const b = await engine.createWorktree('t1');
    expect(b).toEqual(a);
    await expect(engine.createWorktree('../evil')).rejects.toThrow(/invalid task id/);
  });

  it('commitAll returns null when clean and a sha otherwise', async () => {
    const { path: wt } = await engine.createWorktree('t1');
    expect(await engine.commitAll('t1', 'noop')).toBeNull();
    write(path.join(wt, 'web/new.ts'), 'n\n');
    expect(await engine.commitAll('t1', 'add')).toMatch(/^[0-9a-f]{40}$/);
  });

  it('diff covers committed, uncommitted, untracked, deleted and renamed files', async () => {
    const { path: wt } = await engine.createWorktree('t1');
    write(path.join(wt, 'web/a.ts'), 'a\nmore\n');
    await engine.commitAll('t1', 'edit');
    write(path.join(wt, 'web/untracked.ts'), 'u\n');
    unlinkSync(path.join(wt, 'api/b.ts'));
    const d = await engine.diff('t1');
    const byPath = Object.fromEntries(d.files.map((f) => [f.path, f]));
    expect(byPath['web/a.ts']).toMatchObject({ kind: 'modified', additions: 1, deletions: 0 });
    expect(byPath['web/untracked.ts']).toMatchObject({ kind: 'added', additions: 1 });
    expect(byPath['api/b.ts']).toMatchObject({ kind: 'deleted', deletions: 1 });
    expect(d.patch).toContain('+more');

    const { path: wt2 } = await engine.createWorktree('t2');
    write(path.join(wt2, 'web/long.ts'), 'line\n'.repeat(20));
    await engine.commitAll('t2', 'long');
    g(repo, 'merge', '-q', 'kacheri/t2');
    const { path: wt3 } = await engine.createWorktree('t3');
    renameSync(path.join(wt3, 'web/long.ts'), path.join(wt3, 'web/moved.ts'));
    await engine.commitAll('t3', 'mv');
    const d3 = await engine.diff('t3');
    expect(d3.files).toEqual([{ path: 'web/moved.ts', oldPath: 'web/long.ts', kind: 'renamed', additions: 0, deletions: 0 }]);
  });

  it('removeWorktree keeps dirty worktrees and unmerged branches', async () => {
    const { path: wt } = await engine.createWorktree('t1');
    write(path.join(wt, 'web/a.ts'), 'dirty\n');
    await expect(engine.removeWorktree('t1')).rejects.toThrow();
    await engine.commitAll('t1', 'c');
    await expect(engine.removeWorktree('t1', { deleteBranch: true })).rejects.toThrow(/not fully merged/);
    expect(existsSync(wt)).toBe(false);
    expect(g(repo, 'branch', '--list', 'kacheri/t1')).toContain('kacheri/t1');
    // Recreating reattaches the surviving branch with its commit.
    const again = await engine.createWorktree('t1');
    expect(g(again.path, 'log', '-1', '--format=%s')).toBe('c');
  });
});

describe('merge', () => {
  it('merges owned changes with a merge commit, committing leftovers first', async () => {
    const { path: wt } = await engine.createWorktree('t1');
    write(path.join(wt, 'web/a.ts'), 'merged\n');
    const r = await engine.merge('t1', ['web/**'], { message: 'merge t1' });
    expect(r.ok).toBe(true);
    expect(g(repo, 'log', '-1', '--format=%P').split(' ')).toHaveLength(2);
    expect(g(repo, 'log', '-1', '--format=%s')).toBe('merge t1');
    expect(g(repo, 'show', 'HEAD:web/a.ts')).toBe('merged');
  });

  it('refuses changes outside owned paths', async () => {
    const { path: wt } = await engine.createWorktree('t1');
    write(path.join(wt, 'api/b.ts'), 'sneaky\n');
    const r = await engine.merge('t1', ['web/**']);
    expect(r).toMatchObject({ ok: false, reason: 'ownership' });
    expect(g(repo, 'show', 'HEAD:api/b.ts')).toBe('b');
  });

  it('runs the test command in the worktree and blocks on failure', async () => {
    const { path: wt } = await engine.createWorktree('t1');
    write(path.join(wt, 'web/a.ts'), 'x\n');
    const fail = await engine.merge('t1', ['web/**'], { testCommand: ['node', '-e', 'console.log("boom");process.exit(3)'] });
    expect(fail).toMatchObject({ ok: false, reason: 'tests_failed' });
    if (!fail.ok) expect(fail.detail).toContain('boom');
    const pass = await engine.merge('t1', ['web/**'], { testCommand: ['node', '-e', 'process.exit(require("fs").existsSync("web/a.ts")?0:1)'] });
    expect(pass.ok).toBe(true);
  });

  it('reports conflicts without touching the main checkout', async () => {
    const { path: wt } = await engine.createWorktree('t1');
    write(path.join(wt, 'web/a.ts'), 'theirs\n');
    write(path.join(repo, 'web/a.ts'), 'ours\n');
    g(repo, 'commit', '-qam', 'main edit');
    const before = g(repo, 'rev-parse', 'HEAD');
    const r = await engine.merge('t1', ['web/**']);
    expect(r).toMatchObject({ ok: false, reason: 'conflict' });
    if (!r.ok) expect(r.detail).toContain('web/a.ts');
    expect(g(repo, 'rev-parse', 'HEAD')).toBe(before);
    expect(g(repo, 'status', '--porcelain')).toBe('');
  });

  it('refuses a dirty or wrong-branch base, and empty branches', async () => {
    await engine.createWorktree('t0');
    expect(await engine.merge('t0', ['**'])).toMatchObject({ ok: false, reason: 'nothing_to_merge' });
    const { path: wt } = await engine.createWorktree('t1');
    write(path.join(wt, 'web/a.ts'), 'x\n');
    write(path.join(repo, 'api/b.ts'), 'local edit\n');
    expect(await engine.merge('t1', ['web/**'])).toMatchObject({ ok: false, reason: 'dirty_base' });
    g(repo, 'checkout', '-q', '--', 'api/b.ts');
    g(repo, 'checkout', '-q', '-b', 'other');
    expect(await engine.merge('t1', ['web/**'])).toMatchObject({ ok: false, reason: 'dirty_base' });
  });
});
