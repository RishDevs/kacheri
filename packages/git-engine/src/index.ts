import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  FileChange,
  FileChangeKind,
  GitEngine,
  MergeOptions,
  MergeResult,
  OwnershipResult,
  TaskDiff,
  WorktreeInfo,
} from '@kacheri/shared';

export interface GitEngineOptions {
  worktreeRoot?: string; // default: <parent of repo>/<repo name>-kacheri-worktrees
  baseBranch?: string; // default: main
  testTimeoutMs?: number; // default: 10 minutes
}

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

const MAX_BUFFER = 64 * 1024 * 1024;
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function exec(cmd: string, args: string[], cwd: string, timeoutMs = 0): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, maxBuffer: MAX_BUFFER, timeout: timeoutMs }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException).code === 'number' ? Number((err as NodeJS.ErrnoException).code) : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) || (err && code !== 0 ? err.message : '') });
    });
  });
}

export class GitError extends Error {
  constructor(args: string[], public readonly result: ExecResult) {
    super(`git ${args.join(' ')} failed (${result.code}): ${result.stderr.trim()}`);
  }
}

// Glob subset: `**` (any depth, incl. none), `*` and `?` within one segment. A trailing `/` means the whole directory.
export function globToRegExp(glob: string): RegExp {
  let g = glob.replace(/^\.\//, '');
  if (g.endsWith('/')) g += '**';
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

export function checkOwnership(files: FileChange[], ownedPaths: string[]): OwnershipResult {
  const patterns = ownedPaths.map(globToRegExp);
  const owned = (p: string) => patterns.some((re) => re.test(p));
  const violations = new Set<string>();
  for (const f of files) {
    if (!owned(f.path)) violations.add(f.path);
    // Moving a file out of someone else's area is also a change to their area.
    if (f.oldPath && !owned(f.oldPath)) violations.add(f.oldPath);
  }
  return { ok: violations.size === 0, violations: [...violations].sort() };
}

function parseNameStatus(out: string): Omit<FileChange, 'additions' | 'deletions'>[] {
  const parts = out.split('\0').filter((s, i, a) => s !== '' || i < a.length - 1);
  const files: Omit<FileChange, 'additions' | 'deletions'>[] = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i++];
    if (!status) continue;
    const letter = status[0];
    if (letter === 'R' || letter === 'C') {
      const oldPath = parts[i++];
      const newPath = parts[i++];
      files.push(letter === 'R' ? { path: newPath, oldPath, kind: 'renamed' } : { path: newPath, kind: 'added' });
    } else {
      const kind: FileChangeKind = letter === 'A' ? 'added' : letter === 'D' ? 'deleted' : 'modified';
      files.push({ path: parts[i++], kind });
    }
  }
  return files;
}

function parseNumstat(out: string): Map<string, { additions: number; deletions: number }> {
  const counts = new Map<string, { additions: number; deletions: number }>();
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; ) {
    const rec = parts[i++];
    if (!rec) continue;
    const [a, d, p] = rec.split('\t');
    let file = p;
    if (p === '') {
      i++; // rename: old path, then new path
      file = parts[i++];
    }
    // Binary files report "-".
    counts.set(file, { additions: a === '-' ? 0 : Number(a), deletions: d === '-' ? 0 : Number(d) });
  }
  return counts;
}

export function createGitEngine(repoRoot: string, opts: GitEngineOptions = {}): GitEngine {
  const root = path.resolve(repoRoot);
  const worktreeRoot = path.resolve(opts.worktreeRoot ?? path.join(path.dirname(root), `${path.basename(root)}-kacheri-worktrees`));
  const baseBranch = opts.baseBranch ?? 'main';
  const testTimeoutMs = opts.testTimeoutMs ?? 10 * 60 * 1000;

  async function git(args: string[], cwd = root): Promise<string> {
    const r = await exec('git', args, cwd);
    if (r.code !== 0) throw new GitError(args, r);
    return r.stdout;
  }

  function locate(taskId: string): { branch: string; wt: string } {
    if (!TASK_ID.test(taskId)) throw new Error(`invalid task id: ${JSON.stringify(taskId)}`);
    return { branch: `kacheri/${taskId}`, wt: path.join(worktreeRoot, taskId) };
  }

  function requireWorktree(taskId: string): { branch: string; wt: string } {
    const loc = locate(taskId);
    if (!existsSync(loc.wt)) throw new Error(`no worktree for task ${taskId}`);
    return loc;
  }

  async function branchExists(branch: string): Promise<boolean> {
    return (await exec('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], root)).code === 0;
  }

  // Commits with a fallback identity so a fresh machine without user.email still works.
  async function identityArgs(cwd: string): Promise<string[]> {
    const r = await exec('git', ['config', 'user.email'], cwd);
    return r.code === 0 && r.stdout.trim() ? [] : ['-c', 'user.name=Kacheri', '-c', 'user.email=kacheri@localhost'];
  }

  async function mergeBase(wt: string): Promise<string> {
    return (await git(['merge-base', baseBranch, 'HEAD'], wt)).trim();
  }

  const engine: GitEngine = {
    async createWorktree(taskId) {
      const { branch, wt } = locate(taskId);
      if (existsSync(wt)) {
        return { branch, path: wt, baseRef: await mergeBase(wt) } satisfies WorktreeInfo;
      }
      const baseRef = (await git(['rev-parse', '--verify', `${baseBranch}^{commit}`])).trim();
      await mkdir(worktreeRoot, { recursive: true });
      if (await branchExists(branch)) {
        // Branch survived an earlier removeWorktree: reattach instead of losing its commits.
        await git(['worktree', 'add', wt, branch]);
        return { branch, path: wt, baseRef: await mergeBase(wt) };
      }
      await git(['worktree', 'add', '-b', branch, wt, baseRef]);
      return { branch, path: wt, baseRef };
    },

    async commitAll(taskId, message) {
      const { wt } = requireWorktree(taskId);
      await git(['add', '-A'], wt);
      const staged = await exec('git', ['diff', '--cached', '--quiet'], wt);
      if (staged.code === 0) return null;
      await git([...(await identityArgs(wt)), 'commit', '-q', '--no-verify', '-m', message], wt);
      return (await git(['rev-parse', 'HEAD'], wt)).trim();
    },

    async diff(taskId) {
      const { wt } = requireWorktree(taskId);
      // Intent-to-add makes untracked files show up in `git diff <base>` without staging their content.
      await git(['add', '-A', '-N'], wt);
      const baseRef = await mergeBase(wt);
      const headRef = (await git(['rev-parse', 'HEAD'], wt)).trim();
      const [names, nums, patch] = await Promise.all([
        git(['diff', '-M', '--name-status', '-z', baseRef], wt),
        git(['diff', '-M', '--numstat', '-z', baseRef], wt),
        git(['diff', '-M', baseRef], wt),
      ]);
      const counts = parseNumstat(nums);
      const files = parseNameStatus(names).map((f) => ({ ...f, ...(counts.get(f.path) ?? { additions: 0, deletions: 0 }) }));
      return { baseRef, headRef, files, patch } satisfies TaskDiff;
    },

    checkOwnership,

    async merge(taskId, ownedPaths, mopts: MergeOptions = {}): Promise<MergeResult> {
      const { branch, wt } = requireWorktree(taskId);
      const message = mopts.message ?? `kacheri: merge ${taskId}`;
      await engine.commitAll(taskId, `kacheri: ${taskId} (uncommitted changes)`);

      const d = await engine.diff(taskId);
      if (d.files.length === 0) return { ok: false, reason: 'nothing_to_merge', detail: `${branch} has no changes vs ${baseBranch}` };

      const own = checkOwnership(d.files, ownedPaths);
      if (!own.ok) return { ok: false, reason: 'ownership', detail: `outside owned paths: ${own.violations.join(', ')}` };

      if (mopts.testCommand?.length) {
        const [cmd, ...args] = mopts.testCommand;
        const r = await exec(cmd, args, wt, testTimeoutMs);
        if (r.code !== 0) {
          const out = `${r.stdout}\n${r.stderr}`.trim();
          return { ok: false, reason: 'tests_failed', detail: `${mopts.testCommand.join(' ')} exited ${r.code}\n${out.slice(-4000)}` };
        }
      }

      // The merge happens in the main checkout, so it must be on the base branch with no local edits.
      const current = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
      if (current !== baseBranch) return { ok: false, reason: 'dirty_base', detail: `${root} is on ${current}, expected ${baseBranch}` };
      const status = (await git(['status', '--porcelain', '--untracked-files=no'])).trim();
      if (status) return { ok: false, reason: 'dirty_base', detail: `${root} has uncommitted changes:\n${status}` };

      // Dry run first so a conflict never leaves the main checkout half-merged.
      const dry = await exec('git', ['merge-tree', '--write-tree', '--name-only', '--no-messages', baseBranch, branch], root);
      if (dry.code === 1) {
        const conflicted = dry.stdout.split('\n').slice(1).filter(Boolean);
        return { ok: false, reason: 'conflict', detail: `conflicts in: ${conflicted.join(', ')}` };
      }
      if (dry.code !== 0) throw new GitError(['merge-tree'], dry);

      const m = await exec('git', [...(await identityArgs(root)), 'merge', '--no-ff', '--no-edit', '-m', message, branch], root);
      if (m.code !== 0) {
        await exec('git', ['merge', '--abort'], root);
        return { ok: false, reason: 'conflict', detail: (m.stdout + m.stderr).trim() };
      }
      return { ok: true, commit: (await git(['rev-parse', 'HEAD'])).trim() };
    },

    async removeWorktree(taskId, ropts = {}) {
      const { branch, wt } = locate(taskId);
      // No --force: a worktree with uncommitted work is an error, not something to discard.
      if (existsSync(wt)) await git(['worktree', 'remove', wt]);
      // -d (not -D) refuses to delete a branch whose commits are not merged.
      if (ropts.deleteBranch && (await branchExists(branch))) await git(['branch', '-d', branch]);
    },
  };
  return engine;
}
