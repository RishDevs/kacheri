import type { CaseRecord, CourtEvent } from '@kacheri/shared';
import { ApiRequestError, defaultFetch, requestJson, type EventSubscription } from '../api';
import { parseBench, type BenchData } from './bench';
import { caseToReplay } from './replay';

export interface CreateCaseInput {
  title: string;
  repoPath: string;
  baseRef: string;
  headRef: string;
}

export interface CourtHandlers {
  onEvent(event: CourtEvent): void;
  onOpen?(): void;
  onError?(): void;
}

export interface CourtSource {
  readonly mode: 'live' | 'demo';
  listCases(): Promise<CaseRecord[]>;
  getCase(id: string): Promise<CaseRecord>;
  createCase?(input: CreateCaseInput): Promise<CaseRecord>;
  subscribe(handlers: CourtHandlers): EventSubscription;
  // demo only: re-stream a stored case as live events; the returned stop() jumps to the final record
  replay?(caseId: string): () => void;
  loadBench(): Promise<BenchData | null>;
}

const COURT_EVENT_TYPES = new Set<CourtEvent['type']>([
  'case',
  'charge',
  'evidence',
  'rebuttal',
  'ruling',
  'usage',
  'remedy',
]);

// The daemon wraps court events on the shared /api/events stream as `{ type: 'court', event }`.
export function parseCourtMessage(data: string): CourtEvent | null {
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const msg = parsed as { type?: unknown; event?: unknown };
    if (msg.type !== 'court' || typeof msg.event !== 'object' || msg.event === null) return null;
    const event = msg.event as { type?: unknown };
    return COURT_EVENT_TYPES.has(event.type as CourtEvent['type']) ? (msg.event as CourtEvent) : null;
  } catch {
    return null;
  }
}

async function fetchJsonAsset(doFetch: typeof fetch, url: string): Promise<unknown | undefined> {
  try {
    const res = await doFetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return undefined;
    return JSON.parse(await res.text()) as unknown;
  } catch {
    return undefined;
  }
}

// Real runner output is published as bench/latest.json; the flagged sample is only the fallback.
function benchUrls(assetBase: string): string[] {
  return [`${assetBase}bench/latest.json`, `${assetBase}demo/bench.json`];
}

async function loadBenchFrom(doFetch: typeof fetch, urls: string[]): Promise<BenchData | null> {
  for (const url of urls) {
    const json = await fetchJsonAsset(doFetch, url);
    if (json !== undefined) return parseBench(json);
  }
  return null;
}

export interface LiveSourceOptions {
  baseUrl?: string; // daemon origin, default same origin
  assetBase?: string; // where static assets are served, ends with "/"
  fetch?: typeof fetch;
  EventSource?: typeof EventSource;
}

export function createLiveCourtSource(opts: LiveSourceOptions = {}): CourtSource {
  const api = `${opts.baseUrl ?? ''}/api`;
  const assets = opts.assetBase ?? '/';
  const doFetch = opts.fetch ?? defaultFetch();
  const enc = encodeURIComponent;
  return {
    mode: 'live',
    listCases: () => requestJson<CaseRecord[]>(doFetch, 'GET', `${api}/cases`),
    getCase: (id) => requestJson<CaseRecord>(doFetch, 'GET', `${api}/cases/${enc(id)}`),
    createCase: (input) => requestJson<CaseRecord>(doFetch, 'POST', `${api}/cases`, input),
    subscribe(handlers) {
      const ES = opts.EventSource ?? globalThis.EventSource;
      if (!ES) {
        handlers.onError?.();
        return { close() {} };
      }
      const source = new ES(`${api}/events`);
      source.onopen = () => handlers.onOpen?.();
      source.onerror = () => handlers.onError?.();
      source.onmessage = (msg: MessageEvent<string>) => {
        const event = parseCourtMessage(msg.data);
        if (event) handlers.onEvent(event);
      };
      return { close: () => source.close() };
    },
    loadBench: () => loadBenchFrom(doFetch, benchUrls(assets)),
  };
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface DemoSourceOptions {
  assetBase: string; // ends with "/"
  files: string[]; // case file names under demo/cases/
  fetch?: typeof fetch;
  timers?: Timers;
  speed?: number; // >1 replays faster
  now?: () => number;
}

const realTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function createDemoCourtSource(opts: DemoSourceOptions): CourtSource {
  const doFetch = opts.fetch ?? defaultFetch();
  const timers = opts.timers ?? realTimers;
  const speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
  const now = opts.now ?? Date.now;
  const handlers = new Set<CourtHandlers>();
  let cache: Promise<CaseRecord[]> | null = null;

  const emit = (event: CourtEvent) => {
    for (const h of handlers) h.onEvent(event);
  };

  function cases(): Promise<CaseRecord[]> {
    if (!cache) {
      cache = Promise.all(
        opts.files.map((f) =>
          requestJson<CaseRecord>(doFetch, 'GET', `${opts.assetBase}demo/cases/${encodeURIComponent(f)}`),
        ),
      );
      cache.catch(() => {
        cache = null;
      });
    }
    return cache;
  }

  return {
    mode: 'demo',
    listCases: cases,
    async getCase(id) {
      const found = (await cases()).find((c) => c.id === id);
      if (!found) throw new ApiRequestError(`case not found: ${id}`, 404);
      return found;
    },
    subscribe(h) {
      handlers.add(h);
      h.onOpen?.();
      return { close: () => void handlers.delete(h) };
    },
    replay(caseId) {
      let stopped = false;
      let finished = false;
      let record: CaseRecord | null = null;
      const pending: unknown[] = [];
      void cases().then(
        (all) => {
          const found = all.find((c) => c.id === caseId);
          if (stopped || !found) return;
          record = found;
          const steps = caseToReplay(found, new Date(now()).toISOString());
          let at = 0;
          steps.forEach((step, i) => {
            at += step.delayMs / speed;
            const fire = () => {
              if (stopped) return;
              emit(step.event);
              if (i === steps.length - 1) finished = true;
            };
            if (i === 0) fire();
            else pending.push(timers.setTimeout(fire, at));
          });
        },
        () => undefined,
      );
      return () => {
        if (stopped) return;
        stopped = true;
        for (const p of pending) timers.clearTimeout(p);
        if (record && !finished) emit({ type: 'case', record });
      };
    },
    loadBench: () => loadBenchFrom(doFetch, benchUrls(opts.assetBase)),
  };
}
