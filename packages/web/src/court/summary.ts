import type { CaseRecord, CaseStatus, LlmUsage, ModelTier, WitnessOutcome } from '@kacheri/shared';

// Optional fields a case record may carry beyond the shared contract (demo JSON includes them).
export interface CaseExtras {
  patch?: string;
  description?: string;
}

export function caseExtras(record: CaseRecord): CaseExtras {
  const r = record as CaseRecord & Partial<Record<keyof CaseExtras, unknown>>;
  return {
    patch: typeof r.patch === 'string' ? r.patch : undefined,
    description: typeof r.description === 'string' ? r.description : undefined,
  };
}

export const TIERS: readonly ModelTier[] = ['nano', 'super', 'ultra'];

export interface TierTokens {
  prompt: number;
  completion: number;
  calls: number;
}

export interface CaseTotals {
  costUsd: number;
  calls: number;
  tokens: Record<ModelTier, TierTokens>;
}

export function caseTotals(usage: LlmUsage[]): CaseTotals {
  const tokens = Object.fromEntries(TIERS.map((t) => [t, { prompt: 0, completion: 0, calls: 0 }])) as Record<
    ModelTier,
    TierTokens
  >;
  let costUsd = 0;
  for (const u of usage) {
    costUsd += u.costUsd;
    const t = tokens[u.tier];
    if (!t) continue;
    t.prompt += u.promptTokens;
    t.completion += u.completionTokens;
    t.calls += 1;
  }
  return { costUsd, calls: usage.length, tokens };
}

export function formatUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m ${s}s` : `${m}m ${s}s`;
}

export function elapsedMs(record: CaseRecord, now: number): number {
  const start = Date.parse(record.startedAt);
  const end = record.endedAt ? Date.parse(record.endedAt) : now;
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, end - start);
}

export function isActive(status: CaseStatus): boolean {
  return status === 'filing' || status === 'trial' || status === 'deliberation';
}

export type ChargeOutcome =
  | { state: 'pending' }
  | { state: 'convicted' | 'dismissed'; reason: string; inadmissible: boolean };

export function chargeOutcome(record: CaseRecord, chargeId: string): ChargeOutcome {
  const evidence = record.evidence.find((e) => e.chargeId === chargeId);
  const inadmissible = evidence !== undefined && !evidence.admissible;
  const ruling = record.rulings.find((r) => r.chargeId === chargeId);
  if (ruling) return { state: ruling.decision, reason: ruling.reason, inadmissible };
  if (record.status !== 'closed') return { state: 'pending' };
  if (evidence && !evidence.admissible) {
    return { state: 'dismissed', reason: `Inadmissible: ${evidence.reason}`, inadmissible };
  }
  return { state: 'dismissed', reason: 'No ruling recorded.', inadmissible };
}

export interface CaseTally {
  convicted: number;
  dismissed: number;
  inadmissible: number;
  pending: number;
}

export function caseTally(record: CaseRecord): CaseTally {
  const tally: CaseTally = { convicted: 0, dismissed: 0, inadmissible: 0, pending: 0 };
  for (const c of record.charges) {
    const o = chargeOutcome(record, c.id);
    if (o.state === 'pending') tally.pending++;
    else tally[o.state]++;
    if (record.evidence.some((e) => e.chargeId === c.id && !e.admissible)) tally.inadmissible++;
  }
  return tally;
}

export const TIER_LABEL: Record<ModelTier, string> = { nano: 'Nano', super: 'Super', ultra: 'Ultra' };

// Pipeline label fixed by docs/DESIGN.md: parallel Nano prosecutors, Super defense, Ultra judge.
export const MODEL_LINEAGE: readonly { tier: ModelTier; label: string }[] = [
  { tier: 'nano', label: 'Nano ×2' },
  { tier: 'super', label: 'Super' },
  { tier: 'ultra', label: 'Ultra' },
];

export const OUTCOME_LABEL: Record<WitnessOutcome, string> = {
  pass: 'PASS',
  fail: 'FAIL',
  error: 'ERROR',
  timeout: 'TIMEOUT',
};

const OUTCOME_ORDER: readonly WitnessOutcome[] = ['pass', 'fail', 'error', 'timeout'];

// "3/3 pass", or "2/3 fail, 1/3 pass" for mixed runs (most frequent first).
export function runSummary(outcomes: readonly WitnessOutcome[]): string {
  if (outcomes.length === 0) return 'no runs';
  const counts = OUTCOME_ORDER.map((o) => ({ o, n: outcomes.filter((x) => x === o).length })).filter((c) => c.n > 0);
  counts.sort((a, b) => b.n - a.n);
  return counts.map((c) => `${c.n}/${outcomes.length} ${c.o}`).join(', ');
}

export function hasRunFault(outcomes: readonly WitnessOutcome[]): boolean {
  return outcomes.some((o) => o === 'error' || o === 'timeout');
}

export function shortSha(ref: string): string {
  return /^[0-9a-f]{8,40}$/i.test(ref) ? ref.slice(0, 7) : ref;
}

// UTC calendar date, YYYY-MM-DD; empty for unparseable input.
export function isoDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10);
}

export function admissibleCount(record: CaseRecord): number {
  return record.evidence.filter((e) => e.admissible).length;
}

export const STATUS_TEXT: Record<CaseStatus, string> = {
  filing: 'Filing',
  trial: 'Trial',
  deliberation: 'Deliberation',
  closed: 'Closed',
  error: 'Error',
};
