import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { AGENT_IDS } from '@kacheri/shared';
import type { AgentAdapter, AgentId, CreateTaskInput, GitEngine, ParseVerdictResult, Run, RunKind, ServerEvent, Task, TaskDiff } from '@kacheri/shared';
import type { Store } from './store.js';
import { runCommand } from './runner.js';

export interface ServerOptions {
  engine: GitEngine;
  store: Store;
  adapters: Partial<Record<AgentId, AgentAdapter>>;
  repoRoot: string;
  parseVerdict: (raw: string, reviewer: AgentId) => ParseVerdictResult;
  buildReviewPrompt: (task: Task, diff: TaskDiff) => string;
}
export function createServer({ engine, store, adapters, parseVerdict, buildReviewPrompt }: ServerOptions) {
  const app = Fastify();
  const clients = new Set<ServerResponse>();
  const active = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  const emit = (event: ServerEvent) => { for (const client of clients) client.write(`data: ${JSON.stringify(event)}\n\n`); };
  const saveTask = (task: Task) => { task.updatedAt = new Date().toISOString(); store.saveTask(task); emit({ type: 'task', task }); return task; };
  const saveRun = (run: Run) => { store.saveRun(run); emit({ type: 'run', run }); };
  const get = (id: string) => { const task = store.getTask(id); if (!task) throw Object.assign(new Error('Task not found'), { statusCode: 404 }); return task; };
  const requireState = (task: Task, states: Task['status'][]) => {
    if (active.has(task.id) || !states.includes(task.status)) throw Object.assign(new Error('Task cannot perform this action in its current state'), { statusCode: 409 });
  };
  async function run(task: Task, agent: AgentId, kind: RunKind, prompt: string, signal: AbortSignal) {
    const adapter = adapters[agent];
    if (!adapter) throw new Error(`No adapter for ${agent}`);
    const command = adapter.buildCommand(prompt, task.worktreePath!, kind);
    const record: Run = { id: `r_${randomUUID()}`, taskId: task.id, agent, kind, status: 'running', exitCode: null, startedAt: new Date().toISOString(), endedAt: null };
    saveRun(record);
    const result = await runCommand(command, task.worktreePath!, (stream, chunk) => emit({ type: 'log', taskId: task.id, runId: record.id, stream, chunk }), signal);
    Object.assign(record, { status: result.status, exitCode: result.exitCode, endedAt: new Date().toISOString() });
    saveRun(record);
    if (signal.aborted) throw new Error('Cancelled');
    if (result.status !== 'succeeded') throw new Error(`${kind} ${result.status}`);
    return result.stdout;
  }
  async function review(task: Task, signal: AbortSignal) {
    task.status = 'reviewing'; task.error = null; saveTask(task); store.clearVerdicts(task.id);
    const prompt = buildReviewPrompt(task, await engine.diff(task.id));
    for (const reviewer of task.reviewers) {
      let result: ParseVerdictResult = { ok: false, error: 'No review' };
      for (let attempt = 0; attempt < 2; attempt++) {
        result = parseVerdict(await run(task, reviewer, 'review', prompt, signal), reviewer);
        if (result.ok) break;
      }
      const verdict = result.ok ? result.verdict : { reviewer, status: 'FAIL' as const, summary: 'unparseable review', findings: [] };
      store.saveVerdict(task.id, verdict); emit({ type: 'verdict', taskId: task.id, verdict });
    }
    task.status = store.getVerdicts(task.id).every(v => v.status === 'PASS') ? 'ready' : 'changes_requested'; saveTask(task);
  }
  function launch(task: Task, work: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController();
    const promise = Promise.resolve().then(() => work(controller.signal)).catch(error => {
      if (!controller.signal.aborted) { task.status = 'failed'; task.error = String(error instanceof Error ? error.message : error); saveTask(task); }
    }).finally(() => active.delete(task.id));
    active.set(task.id, { controller, promise });
  }
  app.setErrorHandler((error, _request, reply) => {
    const failure = error as { statusCode?: number; message?: string };
    reply.code(failure.statusCode ?? 500).send({ error: failure.message ?? 'Internal server error' });
  });
  app.get('/api/tasks', async () => store.listTasks());
  app.post<{ Body: CreateTaskInput }>('/api/tasks', async (request, reply) => {
    const body = request.body;
    const isAgent = (value: unknown): value is AgentId => AGENT_IDS.includes(value as AgentId);
    if (!body || typeof body.title !== 'string' || !body.title.trim() || typeof body.prompt !== 'string' || !body.prompt.trim() || !isAgent(body.agent) || !Array.isArray(body.ownedPaths) || !body.ownedPaths.length || !body.ownedPaths.every(p => typeof p === 'string' && p.trim()) || (body.reviewers !== undefined && (!Array.isArray(body.reviewers) || !body.reviewers.length || !body.reviewers.every(r => isAgent(r) && r !== body.agent)))) {
      return reply.code(400).send({ error: 'Invalid task input' });
    }
    const now = new Date().toISOString();
    return saveTask({ id: `t_${randomUUID().slice(0, 8)}`, title: body.title, prompt: body.prompt, agent: body.agent, reviewers: [...new Set(body.reviewers ?? [AGENT_IDS.find(a => a !== body.agent)!])], ownedPaths: body.ownedPaths, status: 'queued', branch: null, worktreePath: null, error: null, createdAt: now, updatedAt: now });
  });
  app.get<{ Params: { id: string } }>('/api/tasks/:id', async ({ params }) => ({ task: get(params.id), runs: store.getRuns(params.id), verdicts: store.getVerdicts(params.id) }));
  app.get<{ Params: { id: string } }>('/api/tasks/:id/diff', async ({ params }) => { const task = get(params.id); if (!task.worktreePath) throw Object.assign(new Error('Task has no worktree'), { statusCode: 409 }); return engine.diff(task.id); });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/start', async ({ params }) => {
    const task = get(params.id); requireState(task, ['queued']);
    task.status = 'running'; saveTask(task);
    launch(task, async signal => {
      const tree = await engine.createWorktree(task.id);
      task.branch = tree.branch; task.worktreePath = tree.path;
      if (signal.aborted) return;
      saveTask(task);
      await run(task, task.agent, 'build', task.prompt, signal);
      await engine.commitAll(task.id, `kacheri: ${task.title}`);
      if (!signal.aborted) await review(task, signal);
    });
    return task;
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/review', async ({ params }) => {
    const task = get(params.id); requireState(task, ['ready', 'changes_requested', 'failed']);
    if (!task.worktreePath) throw Object.assign(new Error('Task has no worktree'), { statusCode: 409 });
    task.status = 'reviewing'; saveTask(task); launch(task, signal => review(task, signal)); return task;
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/merge', async ({ params }) => {
    const task = get(params.id); requireState(task, ['ready']);
    // Reserve the task for the entire async merge, preventing duplicate merges/rejection.
    let result: Awaited<ReturnType<GitEngine['merge']>> | undefined;
    launch(task, async () => {
      const testCommand = process.env.KACHERI_TEST_CMD?.trim().split(/\s+/).filter(Boolean);
      result = await engine.merge(task.id, task.ownedPaths, testCommand?.length ? { testCommand } : {});
      if (result.ok) { task.status = 'merged'; saveTask(task); }
    });
    await active.get(task.id)!.promise;
    if (!result) throw new Error(task.error ?? 'Merge failed');
    return result;
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/reject', async ({ params }) => {
    const task = get(params.id);
    if (task.status === 'merged' || task.status === 'rejected') throw Object.assign(new Error('Task already finalized'), { statusCode: 409 });
    const job = active.get(task.id);
    if (job && task.status === 'ready') throw Object.assign(new Error('Merge in progress'), { statusCode: 409 });
    job?.controller.abort(); await job?.promise;
    task.status = 'rejected'; task.error = null; return saveTask(task);
  });
  app.get('/api/events', (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    reply.raw.write(': connected\n\n'); clients.add(reply.raw);
    request.raw.on('close', () => clients.delete(reply.raw));
  });
  app.addHook('onClose', async () => {
    for (const client of clients) client.end();
    for (const job of active.values()) job.controller.abort();
    await Promise.all([...active.values()].map(job => job.promise));
  });
  return app;
}
