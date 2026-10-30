import type { CaseRecord, CaseStatus, LlmUsage, ModelTier } from '@kacheri/shared';

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

export const STATUS_TEXT: Record<CaseStatus, string> = {
  filing: 'Filing',
  trial: 'Trial',
  deliberation: 'Deliberation',
  closed: 'Closed',
  error: 'Error',
};
