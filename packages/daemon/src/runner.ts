import { spawn } from 'node:child_process';
import type { AgentCommand, RunStatus } from '@kacheri/shared';
export interface RunResult { status: RunStatus; exitCode: number | null; stdout: string }
export function runCommand(command: AgentCommand, cwd: string, log: (stream: 'stdout' | 'stderr', chunk: string) => void, signal?: AbortSignal): Promise<RunResult> {
  return new Promise(resolve => {
    let stdout = '';
    let status: RunStatus | undefined;
    const child = spawn(command.cmd, command.args, { cwd, env: { ...process.env, ...command.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = (reason: RunStatus) => { status = reason; child.kill('SIGKILL'); };
    const timer = setTimeout(() => stop('timed_out'), command.timeoutMs);
    const cancel = () => stop('cancelled');
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    child.stdout.on('data', data => { const chunk = data.toString(); stdout += chunk; log('stdout', chunk); });
    child.stderr.on('data', data => log('stderr', data.toString()));
    child.on('error', error => { status = 'failed'; log('stderr', error.message); });
    child.on('close', exitCode => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      resolve({ status: status ?? (exitCode === 0 ? 'succeeded' : 'failed'), exitCode, stdout });
    });
  });
}
