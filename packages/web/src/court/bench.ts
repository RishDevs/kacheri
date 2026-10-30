import type { BenchItem, BenchResult } from '@kacheri/shared';

export type BenchSystem = BenchResult['system'];
export const SYSTEMS: readonly BenchSystem[] = ['court', 'baseline'];

export interface BenchItemInfo extends Omit<BenchItem, 'patch'> {
  patch?: string;
}

export interface BenchData {
  // true when the file is flagged as sample data; the UI must never present it as real results
  sample: boolean;
  label: string | null;
  generatedAt: string | null;
  results: BenchResult[];
  items: BenchItemInfo[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function checkResult(v: unknown, i: number): BenchResult {
  if (
    !isObject(v) ||
    typeof v.itemId !== 'string' ||
    (v.system !== 'court' && v.system !== 'baseline') ||
    typeof v.hit !== 'boolean' ||
    !isNum(v.findings) ||
    !isNum(v.falsePositives) ||
    !isNum(v.costUsd) ||
    !isNum(v.latencyMs)
  ) {
    throw new Error(`bench result #${i} is not a valid BenchResult`);
  }
  return { ...(v as unknown as BenchResult), convicted: isNum(v.convicted) ? v.convicted : 0 };
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

export function summarize(results: BenchResult[], system: BenchSystem): SystemSummary | null {
  const rs = results.filter((r) => r.system === system);
  if (rs.length === 0) return null;
  const hits = rs.filter((r) => r.hit).length;
  const falsePositives = rs.reduce((n, r) => n + r.falsePositives, 0);
  const totalCostUsd = rs.reduce((n, r) => n + r.costUsd, 0);
  return {
    system,
    items: rs.length,
    hits,
    hitRate: hits / rs.length,
    falsePositives,
    fpPerPr: falsePositives / rs.length,
    precision: hits + falsePositives === 0 ? null : hits / (hits + falsePositives),
    costPerPr: totalCostUsd / rs.length,
    totalCostUsd,
    p50LatencyMs: median(rs.map((r) => r.latencyMs)),
  };
}

export interface BenchRow {
  itemId: string;
  item: BenchItemInfo | undefined;
  court: BenchResult | undefined;
  baseline: BenchResult | undefined;
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
