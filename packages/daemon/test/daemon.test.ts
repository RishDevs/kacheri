import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentAdapter, GitEngine, ParseVerdictResult, Task, TaskDetail } from '@kacheri/shared';
import { createServer, createStore, createAdapters, runCommand } from '../src/index.js';

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); delete process.env.KACHERI_TEST_CMD; });
function setup(options: { output?: string; code?: number; parse?: () => ParseVerdictResult } = {}) {
  const store = createStore();
  cleanup.push(() => store.close());
  const engine: GitEngine = {
    createWorktree: vi.fn(async id => ({ branch: `kacheri/${id}`, path: tmpdir(), baseRef: 'base' })),
    commitAll: vi.fn(async () => 'head'),
    diff: vi.fn(async () => ({ baseRef: 'base', headRef: 'head', files: [], patch: 'diff' })),
    checkOwnership: vi.fn(() => ({ ok: true, violations: [] })),
    merge: vi.fn(async () => ({ ok: true as const, commit: 'merged' })),
    removeWorktree: vi.fn(async () => {}),
  };
  const adapter: AgentAdapter = { id: 'codex', buildCommand: (_prompt, _cwd, kind) => ({ cmd: process.execPath, args: ['-e', `process.stdout.write(${JSON.stringify(kind === 'review' ? options.output ?? 'review' : 'build')}); process.exit(${options.code ?? 0})`], timeoutMs: 5000 }) };
  const parse = vi.fn(options.parse ?? (() => ({ ok: true as const, verdict: { reviewer: 'claude' as const, status: 'PASS' as const, summary: 'ok', findings: [] } })));
  const app = createServer({ engine, store, adapters: { codex: adapter, claude: { ...adapter, id: 'claude' } }, repoRoot: tmpdir(), parseVerdict: parse, buildReviewPrompt: () => 'review prompt' });
  cleanup.push(() => app.close());
  async function create() { const response = await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: 'Test', prompt: 'Build', agent: 'codex', ownedPaths: ['src/**'] } }); expect(response.statusCode).toBe(200); return response.json<Task>(); }
  async function settled(id: string) {
    for (let i = 0; i < 200; i++) {
      const detail = (await app.inject(`/api/tasks/${id}`)).json<TaskDetail>();
      if (!['queued', 'running', 'reviewing'].includes(detail.task.status)) return detail;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Task did not settle');
  }
  return { app, store, engine, parse, create, settled };
}
describe('daemon API', () => {
  it('builds, commits, reviews, then merges with the configured tests', async () => {
    const { app, create, settled, engine } = setup();
    const task = await create();
    expect(task.reviewers).toEqual(['claude']);
    expect((await app.inject('/api/tasks')).json()).toHaveLength(1);
    expect((await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/merge` })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/start` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/start` })).statusCode).toBe(409);
    const detail = await settled(task.id);
    expect(detail.task.status).toBe('ready');
    expect(detail.runs.map(run => [run.kind, run.status])).toEqual([['build', 'succeeded'], ['review', 'succeeded']]);
    expect(engine.commitAll).toHaveBeenCalledWith(task.id, 'kacheri: Test');
    expect(detail.verdicts[0].status).toBe('PASS');
    expect((await app.inject(`/api/tasks/${task.id}/diff`)).json()).toMatchObject({ patch: 'diff' });
    process.env.KACHERI_TEST_CMD = 'npm   test';
    expect((await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/merge` })).json()).toEqual({ ok: true, commit: 'merged' });
    expect(engine.merge).toHaveBeenCalledWith(task.id, ['src/**'], { testCommand: ['npm', 'test'] });
    expect((await app.inject(`/api/tasks/${task.id}`)).json().task.status).toBe('merged');
  });
  it('retries malformed reviews once, then requests changes', async () => {
    const { app, create, settled, parse } = setup({ parse: () => ({ ok: false, error: 'bad JSON' }) });
    const task = await create(); await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/start` });
    const detail = await settled(task.id);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(detail.task.status).toBe('changes_requested');
    expect(detail.verdicts[0]).toMatchObject({ status: 'FAIL', summary: 'unparseable review' });
    expect(detail.runs).toHaveLength(3);
  });
  it('marks process errors failed without committing or reviewing', async () => {
    const { app, create, settled, engine } = setup({ code: 7 });
    const task = await create(); await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/start` });
    const detail = await settled(task.id);
    expect(detail.task.status).toBe('failed'); expect(detail.runs[0].exitCode).toBe(7);
    expect(engine.commitAll).not.toHaveBeenCalled();
  });
  it('rejects invalid input and preserves worktrees on rejection', async () => {
    const { app, create, engine } = setup();
    expect((await app.inject('/api/tasks/missing')).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: 'x', prompt: 'x', agent: 'codex', reviewers: ['codex'], ownedPaths: ['**'] } })).statusCode).toBe(400);
    const task = await create();
    expect((await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/reject` })).json().status).toBe('rejected');
    expect(engine.removeWorktree).not.toHaveBeenCalled();
  });
  it('broadcasts task, run, log and verdict events over SSE', async () => {
    const { app, create, settled } = setup();
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const controller = new AbortController();
    const response = await fetch(`${address}/api/events`, { signal: controller.signal });
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const reader = response.body!.getReader();
    let text = '';
    const reading = (async () => {
      try { while (true) { const chunk = await reader.read(); if (chunk.done) break; text += new TextDecoder().decode(chunk.value); } } catch { /* Aborted after assertions. */ }
    })();
    try {
      const task = await create(); await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/start` }); await settled(task.id);
      await vi.waitFor(() => { for (const type of ['task', 'run', 'log', 'verdict']) expect(text).toContain(`"type":"${type}"`); });
    } finally { controller.abort(); await reading; }
  });
  it('cancels an active build on rejection without deleting work', async () => {
    const { app, create, store, engine } = setup();
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(engine.createWorktree).mockImplementation(async id => { await wait; return { branch: `kacheri/${id}`, path: tmpdir(), baseRef: 'base' }; });
    const task = await create(); await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/start` });
    const rejecting = app.inject({ method: 'POST', url: `/api/tasks/${task.id}/reject` });
    release(); await rejecting;
    expect(store.getTask(task.id)?.status).toBe('rejected');
    expect(engine.commitAll).not.toHaveBeenCalled(); expect(engine.removeWorktree).not.toHaveBeenCalled();
  });
  it('returns merge gate failures without marking the task merged', async () => {
    const { app, create, settled, engine } = setup();
    vi.mocked(engine.merge).mockResolvedValue({ ok: false, reason: 'ownership', detail: 'outside scope' });
    const task = await create(); await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/start` }); await settled(task.id);
    const response = await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/merge` });
    expect(response.statusCode).toBe(200); expect(response.json().reason).toBe('ownership');
    expect((await app.inject(`/api/tasks/${task.id}`)).json().task.status).toBe('ready');
  });
});
describe('runner and adapters', () => {
  it('closes stdin and captures output', async () => {
    const log = vi.fn();
    const result = await runCommand({ cmd: process.execPath, args: ['-e', "process.stdin.on('end',()=>{console.log('closed');console.error('err')});process.stdin.resume()"], timeoutMs: 3000 }, tmpdir(), log);
    expect(result.status).toBe('succeeded'); expect(result.stdout).toContain('closed'); expect(log).toHaveBeenCalledWith('stderr', expect.stringContaining('err'));
  });
  it('times out and handles missing executables', async () => {
    expect((await runCommand({ cmd: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 50 }, tmpdir(), () => {})).status).toBe('timed_out');
    expect((await runCommand({ cmd: '/nonexistent/kacheri-agent', args: [], timeoutMs: 1000 }, tmpdir(), () => {})).status).toBe('failed');
  });
  it('cancels a running child', async () => {
    const controller = new AbortController();
    const result = runCommand({ cmd: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 5000 }, tmpdir(), () => {}, controller.signal);
    controller.abort(); expect((await result).status).toBe('cancelled');
  });
  it('constructs the documented CLI commands', () => {
    const adapters = createAdapters();
    expect(adapters.codex.buildCommand('p', '.', 'review').args).toEqual(['exec', '--skip-git-repo-check', '--sandbox', 'read-only', 'p']);
    expect(adapters.cursor.buildCommand('p', '.', 'review').args.at(-1)).toBe('Do not edit files.\np');
    expect(adapters.claude.buildCommand('p', '.', 'review').args).toContain('plan');
    expect(adapters.gemini.buildCommand('p', '.', 'build').args).toEqual(['-p', 'p', '--print-timeout', '600s']);
    expect(adapters.codex.buildCommand('p', '.', 'build').timeoutMs).toBe(1200000);
  });
});
it('persists tasks, runs and verdicts across store reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kacheri-store-')); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'db.sqlite'); let store = createStore(path);
  const task: Task = { id: 't_test', title: 'test', prompt: 'p', agent: 'codex', reviewers: ['claude'], ownedPaths: ['**'], status: 'queued', branch: null, worktreePath: null, error: null, createdAt: 'now', updatedAt: 'now' };
  store.saveTask(task); store.saveVerdict(task.id, { reviewer: 'claude', status: 'PASS', summary: 'ok', findings: [] }); store.close();
  store = createStore(path); expect(store.getTask(task.id)).toEqual(task); expect(store.getVerdicts(task.id)).toHaveLength(1); store.clearVerdicts(task.id); expect(store.getVerdicts(task.id)).toEqual([]); store.close();
});
