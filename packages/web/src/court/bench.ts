import type { BenchItem, BenchResult } from '@kacheri/shared';

// The bench runner (packages/bench) also records a Nemotron Ultra single reviewer and the kind of each item.
export type BenchSystem = BenchResult['system'] | 'baseline-ultra';
export const SYSTEMS: readonly BenchSystem[] = ['court', 'baseline', 'baseline-ultra'];

export type BenchKind = 'mutant' | 'historical' | 'clean';
const KINDS: readonly BenchKind[] = ['mutant', 'historical', 'clean'];

export interface BenchRecord extends Omit<BenchResult, 'system'> {
  system: BenchSystem;
  kind?: BenchKind;
}

export interface BenchItemInfo extends Omit<BenchItem, 'patch'> {
  patch?: string;
}

export interface BenchData {
  // true when the file is flagged as sample data; the UI must never present it as real results
  sample: boolean;
  label: string | null;
  generatedAt: string | null;
  results: BenchRecord[];
  items: BenchItemInfo[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function checkResult(v: unknown, i: number): BenchRecord {
  if (
    !isObject(v) ||
    typeof v.itemId !== 'string' ||
    !SYSTEMS.includes(v.system as BenchSystem) ||
    typeof v.hit !== 'boolean' ||
    !isNum(v.findings) ||
    !isNum(v.falsePositives) ||
    !isNum(v.costUsd) ||
    !isNum(v.latencyMs)
  ) {
    throw new Error(`bench result #${i} is not a valid BenchResult`);
  }
  const record: BenchRecord = { ...(v as unknown as BenchRecord), convicted: isNum(v.convicted) ? v.convicted : 0 };
  if (!KINDS.includes(v.kind as BenchKind)) delete record.kind;
  return record;
}

function checkItem(v: unknown): BenchItemInfo | null {
  if (!isObject(v) || typeof v.id !== 'string') return null;
  return {
    id: v.id,
    repo: typeof v.repo === 'string' ? v.repo : '',
    file: typeof v.file === 'string' ? v.file : '',
    line: isNum(v.line) ? v.line : 0,
    operator: typeof v.operator === 'string' ? v.operator : '',
    description: typeof v.description === 'string' ? v.description : '',
    patch: typeof v.patch === 'string' ? v.patch : undefined,
  };
}

// Accepts a bare BenchResult[] or an object `{ sample?, label?, generatedAt?, items?, results }`.
export function parseBench(json: unknown): BenchData {
  if (Array.isArray(json)) {
    return { sample: false, label: null, generatedAt: null, results: json.map(checkResult), items: [] };
  }
  if (!isObject(json) || !Array.isArray(json.results)) {
    throw new Error('bench JSON must be an array of BenchResult or an object with a "results" array');
  }
  const items = Array.isArray(json.items) ? json.items.map(checkItem).filter((x): x is BenchItemInfo => x !== null) : [];
  return {
    sample: json.sample === true,
    label: typeof json.label === 'string' ? json.label : null,
    generatedAt: typeof json.generatedAt === 'string' ? json.generatedAt : null,
    results: json.results.map(checkResult),
    items,
  };
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface SystemSummary {
  system: BenchSystem;
  items: number;
  // items that carry a bug (every item except innocent ones)
  guilty: number;
  hits: number;
  hitRate: number;
  falsePositives: number;
  fpPerPr: number;
  // hits / (hits + false positives); null when the system reported nothing
  precision: number | null;
  costPerPr: number;
  totalCostUsd: number;
  p50LatencyMs: number;
}

export function summarize(results: readonly BenchRecord[], system: BenchSystem): SystemSummary | null {
  const rs = results.filter((r) => r.system === system);
  if (rs.length === 0) return null;
  const guilty = rs.filter((r) => r.kind !== 'clean').length;
  const hits = rs.filter((r) => r.hit).length;
  const falsePositives = rs.reduce((n, r) => n + r.falsePositives, 0);
  const totalCostUsd = rs.reduce((n, r) => n + r.costUsd, 0);
  return {
    system,
    items: rs.length,
    guilty,
    hits,
    hitRate: guilty === 0 ? 0 : hits / guilty,
    falsePositives,
    fpPerPr: falsePositives / rs.length,
    precision: hits + falsePositives === 0 ? null : hits / (hits + falsePositives),
    costPerPr: totalCostUsd / rs.length,
    totalCostUsd,
    p50LatencyMs: median(rs.map((r) => r.latencyMs)),
  };
}

export interface BenchMix extends Record<BenchKind, number> {
  total: number;
}

// Distinct items by kind; items without a recorded kind count as planted bugs.
export function caseMix(data: Pick<BenchData, 'items' | 'results'>): BenchMix {
  const kinds = new Map<string, BenchKind>();
  for (const item of data.items) kinds.set(item.id, 'mutant');
  for (const r of data.results) {
    if (r.kind || !kinds.has(r.itemId)) kinds.set(r.itemId, r.kind ?? 'mutant');
  }
  const mix: BenchMix = { mutant: 0, historical: 0, clean: 0, total: kinds.size };
  for (const k of kinds.values()) mix[k]++;
  return mix;
}

export function benchRepos(data: Pick<BenchData, 'items'>): string {
  return [...new Set(data.items.map((i) => i.repo).filter(Boolean))].join(', ');
}

export interface BenchRow {
  itemId: string;
  item: BenchItemInfo | undefined;
  court: BenchRecord | undefined;
  baseline: BenchRecord | undefined;
}

export function benchRows(data: BenchData): BenchRow[] {
  const items = new Map(data.items.map((i) => [i.id, i]));
  const order: string[] = data.items.map((i) => i.id);
  for (const r of data.results) if (!order.includes(r.itemId)) order.push(r.itemId);
  return order.map((itemId) => ({
    itemId,
    item: items.get(itemId),
    court: data.results.find((r) => r.itemId === itemId && r.system === 'court'),
    baseline: data.results.find((r) => r.itemId === itemId && r.system === 'baseline'),
  }));
}
