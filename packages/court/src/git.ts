import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args.join(' ')}: ${String(stderr).trim() || err.message}`));
      else resolve(String(stdout));
    });
  });
}

export async function resolveRef(repo: string, ref: string): Promise<string> {
  return (await git(['rev-parse', '--verify', `${ref}^{commit}`], repo)).trim();
}

export interface Checkout {
  path: string;
  dispose(): Promise<void>;
}

// A detached, throwaway worktree at an exact commit. Kacheri created it and only witness files are written
// into it, so removing it with --force cannot lose user work.
export async function checkout(repo: string, sha: string): Promise<Checkout> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kacheri-court-'));
  const wt = path.join(dir, 'wt');
  await git(['worktree', 'add', '--detach', '-q', wt, sha], repo);
  return {
    path: wt,
    async dispose() {
      await git(['worktree', 'remove', '--force', wt], repo).catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    },
  };
}
