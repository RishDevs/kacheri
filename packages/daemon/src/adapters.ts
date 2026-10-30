import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentAdapter, AgentId } from '@kacheri/shared';
export function createAdapters(): Record<AgentId, AgentAdapter> {
  return Object.fromEntries((['codex', 'cursor', 'gemini', 'claude'] as const).map(id => [id, {
    id,
    buildCommand(prompt, _cwd, kind) {
      const review = kind === 'review';
      const timeoutMs = review ? 10 * 60_000 : 20 * 60_000;
      switch (id) {
        case 'codex': return { cmd: 'codex', args: ['exec', '--skip-git-repo-check', '--sandbox', review ? 'read-only' : 'workspace-write', prompt], timeoutMs };
        case 'cursor': return { cmd: 'cursor-agent', args: ['-p', '--trust', '--output-format', 'text', review ? `Do not edit files.\n${prompt}` : prompt], timeoutMs };
        case 'gemini': return { cmd: join(homedir(), '.local/bin/agy'), args: ['-p', review ? `Do not edit files.\n${prompt}` : prompt, '--print-timeout', '600s'], timeoutMs };
        case 'claude': return { cmd: 'claude', args: ['-p', prompt, ...(review ? ['--permission-mode', 'plan'] : [])], timeoutMs };
      }
    },
  } satisfies AgentAdapter])) as Record<AgentId, AgentAdapter>;
}
