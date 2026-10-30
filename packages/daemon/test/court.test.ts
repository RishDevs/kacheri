import { expect, it, vi } from 'vitest';
import type { CaseRecord, GitEngine, LlmClient } from '@kacheri/shared';
import { createServer, createStore } from '../src/index.js';
import type { CaseRunner } from '../src/server.js';
it('runs injected Court, lists records, validates input and handles missing cases', async () => {
  const store = createStore();
  const record: CaseRecord = { id: 'case1', title: 'Review', repoPath: '/repo', baseRef: 'base', headRef: 'head', status: 'closed', charges: [], evidence: [], rebuttals: [], rulings: [], usage: [], error: null, startedAt: new Date().toISOString(), endedAt: null };
  const llm: LlmClient = { chat: vi.fn() };
  const runCase = vi.fn<CaseRunner>(async (_input, options) => { options.onEvent({ type: 'case', record }); return record; });
  const app = createServer({ store, engine: {} as GitEngine, adapters: {}, repoRoot: '/repo', parseVerdict: () => ({ ok: false, error: '' }), buildReviewPrompt: () => '', llm, runCase });
  try {
    expect((await app.inject('/api/cases')).json()).toEqual([]);
    expect((await app.inject('/api/cases/missing')).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/cases', payload: { title: '' } })).statusCode).toBe(400);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const controller = new AbortController();
    const stream = await fetch(`${address}/api/events`, { signal: controller.signal });
    const reader = stream.body!.getReader();
    await reader.read(); // Initial connection comment.
    const input = { title: 'Review', repoPath: '/repo', baseRef: 'base', headRef: 'head' };
    expect((await app.inject({ method: 'POST', url: '/api/cases', payload: input })).json()).toEqual(record);
    const event = await reader.read();
    expect(new TextDecoder().decode(event.value)).toContain(JSON.stringify({ type: 'court', event: { type: 'case', record } }));
    controller.abort();
    await reader.cancel().catch(() => {});
    expect(runCase).toHaveBeenCalledWith(input, { llm, onEvent: expect.any(Function) });
    expect((await app.inject('/api/cases')).json()).toEqual([record]);
    expect((await app.inject('/api/cases/case1')).json()).toEqual(record);
  } finally { await app.close(); store.close(); }
});
