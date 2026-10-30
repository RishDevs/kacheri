import { describe, expect, it, vi } from 'vitest';
import type { ServerEvent } from '@kacheri/shared';
import { ApiRequestError, createApi, parseServerEvent } from '../src/api';
import { makeTask } from './fixtures';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('createApi', () => {
  it('calls the documented endpoints', async () => {
    const task = makeTask();
    const fetch = vi.fn(async () => jsonResponse(task));
    const api = createApi({ fetch });
    await api.createTask({ title: 't', prompt: 'p', agent: 'cursor', ownedPaths: ['x/**'] });
    await api.startTask('t/1');
    await api.mergeTask('a');
    await api.getDiff('a');
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      'POST /api/tasks',
      'POST /api/tasks/t%2F1/start',
      'POST /api/tasks/a/merge',
      'GET /api/tasks/a/diff',
    ]);
    expect(JSON.parse(calls[0][1].body as string)).toMatchObject({ title: 't', ownedPaths: ['x/**'] });
  });

  it('surfaces ApiError bodies and network failures', async () => {
    const api = createApi({ fetch: vi.fn(async () => jsonResponse({ error: 'task not found' }, 404)) });
    await expect(api.getTask('zz')).rejects.toMatchObject({ message: 'task not found', status: 404 });
    const down = createApi({
      fetch: vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    });
    const err = await down.listTasks().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).status).toBe(0);
  });

  it('returns merge results with ok:false as data', async () => {
    const result = { ok: false, reason: 'conflict', detail: 'CONFLICT in a.ts' };
    const api = createApi({ fetch: vi.fn(async () => jsonResponse(result)) });
    expect(await api.mergeTask('a')).toEqual(result);
  });

  it('subscribes to /api/events and forwards parsed events', () => {
    const instances: FakeEventSource[] = [];
    class FakeEventSource {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: ((msg: { data: string }) => void) | null = null;
      close = vi.fn();
      constructor(readonly url: string) {
        instances.push(this);
      }
    }
    const api = createApi({ EventSource: FakeEventSource as unknown as typeof EventSource });
    const events: ServerEvent[] = [];
    const sub = api.subscribe({ onEvent: (e) => events.push(e) });
    const es = instances[0];
    expect(es.url).toBe('/api/events');
    es.onmessage?.({ data: JSON.stringify({ type: 'task', task: makeTask() }) });
    es.onmessage?.({ data: 'not json' });
    es.onmessage?.({ data: JSON.stringify({ type: 'nope' }) });
    expect(events).toHaveLength(1);
    sub.close();
    expect(es.close).toHaveBeenCalled();
  });
});

describe('parseServerEvent', () => {
  it('rejects non-events', () => {
    expect(parseServerEvent('null')).toBeNull();
    expect(parseServerEvent('{"type":"log","runId":"r","taskId":"t","stream":"stdout","chunk":"x"}')?.type).toBe('log');
  });
});
