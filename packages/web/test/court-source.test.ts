import { describe, expect, it, vi } from 'vitest';
import type { CourtEvent } from '@kacheri/shared';
import { createDemoCourtSource, createLiveCourtSource, parseCourtMessage, type Timers } from '../src/court/source';
import { makeCase, makeCharge, makeEvidence, makeRemedy } from './court-fixtures';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((msg: { data: string }) => void) | null = null;
  close = vi.fn();
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
}

describe('parseCourtMessage', () => {
  it('accepts only court-wrapped court events', () => {
    const charge: CourtEvent = { type: 'charge', caseId: 'k', charge: makeCharge('c1') };
    expect(parseCourtMessage(JSON.stringify({ type: 'court', event: charge }))).toEqual(charge);
    expect(parseCourtMessage(JSON.stringify(charge))).toBeNull();
    const remedy: CourtEvent = { type: 'remedy', caseId: 'k', remedy: makeRemedy() };
    expect(parseCourtMessage(JSON.stringify({ type: 'court', event: remedy }))).toEqual(remedy);
    expect(parseCourtMessage(JSON.stringify({ type: 'task', task: {} }))).toBeNull();
    expect(parseCourtMessage(JSON.stringify({ type: 'court', event: { type: 'weird' } }))).toBeNull();
    expect(parseCourtMessage('nope')).toBeNull();
  });
});

describe('createLiveCourtSource', () => {
  it('calls the daemon case endpoints', async () => {
    const fetch = vi.fn(async () => jsonResponse(makeCase()));
    const src = createLiveCourtSource({ fetch });
    await src.getCase('a/b');
    await src.createCase!({ title: 't', repoPath: '/r', baseRef: 'main', headRef: 'feat' });
    await src.listCases();
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      'GET /api/cases/a%2Fb',
      'POST /api/cases',
      'GET /api/cases',
    ]);
    expect(JSON.parse(calls[1][1].body as string)).toEqual({ title: 't', repoPath: '/r', baseRef: 'main', headRef: 'feat' });
  });

  it('surfaces daemon errors', async () => {
    const src = createLiveCourtSource({ fetch: vi.fn(async () => jsonResponse({ error: 'case not found' }, 404)) });
    await expect(src.getCase('x')).rejects.toMatchObject({ message: 'case not found', status: 404 });
  });

  it('forwards only court events from /api/events', () => {
    FakeEventSource.instances = [];
    const src = createLiveCourtSource({ EventSource: FakeEventSource as unknown as typeof EventSource });
    const events: CourtEvent[] = [];
    const onOpen = vi.fn();
    const sub = src.subscribe({ onEvent: (e) => events.push(e), onOpen });
    const es = FakeEventSource.instances[0];
    expect(es.url).toBe('/api/events');
    es.onopen?.();
    es.onmessage?.({ data: JSON.stringify({ type: 'task', task: {} }) });
    es.onmessage?.({ data: JSON.stringify({ type: 'court', event: { type: 'case', record: makeCase() } }) });
    expect(onOpen).toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual(['case']);
    sub.close();
    expect(es.close).toHaveBeenCalled();
  });

  it('loads bench/latest.json and falls back to the flagged demo sample', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith('bench/latest.json')
        ? new Response('<!doctype html>', { status: 200 })
        : jsonResponse({ sample: true, results: [] }),
    );
    const src = createLiveCourtSource({ fetch: fetch as unknown as typeof globalThis.fetch, assetBase: '/kacheri/' });
    const bench = await src.loadBench();
    expect(bench?.sample).toBe(true);
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(['/kacheri/bench/latest.json', '/kacheri/demo/bench.json']);
  });
});

function fakeTimers() {
  const queue: { at: number; fn: () => void; id: number }[] = [];
  let id = 0;
  const timers: Timers = {
    setTimeout(fn, ms) {
      queue.push({ at: ms, fn, id: ++id });
      return id;
    },
    clearTimeout(h) {
      const i = queue.findIndex((q) => q.id === h);
      if (i !== -1) queue.splice(i, 1);
    },
  };
  const runAll = () => {
    queue.sort((a, b) => a.at - b.at);
    while (queue.length) queue.shift()!.fn();
  };
  return { timers, queue, runAll };
}

describe('createDemoCourtSource', () => {
  const record = makeCase({
    id: 'demo-x',
    status: 'closed',
    endedAt: '2026-10-30T07:02:00.000Z',
    charges: [makeCharge('c1')],
    evidence: [makeEvidence('c1', true)],
    rulings: [{ chargeId: 'c1', decision: 'convicted', reason: 'r' }],
  });
  const fetchDemo = () => vi.fn(async (url: string) => (url.endsWith('/demo-x.json') ? jsonResponse(record) : jsonResponse({ error: 'missing' }, 404)));

  it('loads cases from static files under the asset base', async () => {
    const fetch = fetchDemo();
    const src = createDemoCourtSource({ assetBase: '/k/', files: ['demo-x.json'], fetch: fetch as unknown as typeof globalThis.fetch });
    expect(await src.listCases()).toEqual([record]);
    expect((await src.getCase('demo-x')).id).toBe('demo-x');
    await expect(src.getCase('nope')).rejects.toMatchObject({ status: 404 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('/k/demo/cases/demo-x.json');
  });

  it('replays a case as timed events and stop() jumps to the final record', async () => {
    const { timers, queue, runAll } = fakeTimers();
    const src = createDemoCourtSource({
      assetBase: '/',
      files: ['demo-x.json'],
      fetch: fetchDemo() as unknown as typeof globalThis.fetch,
      timers,
      now: () => Date.parse('2026-11-01T00:00:00.000Z'),
    });
    const events: CourtEvent[] = [];
    src.subscribe({ onEvent: (e) => events.push(e) });
    await src.listCases();

    src.replay!('demo-x');
    await vi.waitFor(() => expect(events.length).toBe(1));
    const first = events[0];
    expect(first.type === 'case' && first.record.status).toBe('filing');
    expect(queue.length).toBeGreaterThan(3);
    runAll();
    const last = events[events.length - 1];
    expect(last.type === 'case' && last.record).toEqual(record);

    events.length = 0;
    const stop = src.replay!('demo-x');
    await vi.waitFor(() => expect(events.length).toBe(1));
    stop();
    expect(queue).toHaveLength(0);
    expect(events.map((e) => e.type)).toEqual(['case', 'case']);
    const jumped = events[1];
    expect(jumped.type === 'case' && jumped.record).toEqual(record);
    stop();
    expect(events).toHaveLength(2);
  });

  it('serves the demo bench file', async () => {
    const fetch = vi.fn(async () => jsonResponse({ sample: true, label: 'SAMPLE', results: [] }));
    const src = createDemoCourtSource({ assetBase: '/', files: [], fetch: fetch as unknown as typeof globalThis.fetch });
    expect((await src.loadBench())?.label).toBe('SAMPLE');
    expect(fetch.mock.calls[0]).toEqual(['/demo/bench.json', expect.anything()]);
  });
});
