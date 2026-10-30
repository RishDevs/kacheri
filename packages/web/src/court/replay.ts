import type { CaseRecord, CaseStatus, CourtEvent, CourtRole } from '@kacheri/shared';
import { applyToRecord } from './state';

export interface ReplayStep {
  delayMs: number; // wait before emitting, relative to the previous step
  event: CourtEvent;
}

export const REPLAY_DELAYS = {
  usage: 500,
  charge: 450,
  phase: 400,
  evidence: 650,
  rebuttal: 900,
  ruling: 600,
  close: 600,
} as const;

// Rebuilds the order in which the court produced a finished record: filing, trial, defense, ruling.
// Intermediate `case` snapshots restart the clock at `startedAt`; the final step is the original record.
export function caseToReplay(record: CaseRecord, startedAt: string): ReplayStep[] {
  const steps: ReplayStep[] = [];
  let current: CaseRecord = {
    ...record,
    status: 'filing',
    charges: [],
    evidence: [],
    rebuttals: [],
    rulings: [],
    usage: [],
    error: null,
    startedAt,
    endedAt: null,
  };
  steps.push({ delayMs: 0, event: { type: 'case', record: current } });

  const emit = (delayMs: number, event: CourtEvent) => {
    current = applyToRecord(current, event);
    steps.push({ delayMs, event });
  };
  const phase = (status: CaseStatus) => {
    current = { ...current, status };
    steps.push({ delayMs: REPLAY_DELAYS.phase, event: { type: 'case', record: current } });
  };
  const usage = (role: CourtRole) => {
    for (const u of record.usage.filter((x) => x.role === role)) {
      emit(REPLAY_DELAYS.usage, { type: 'usage', caseId: record.id, usage: u });
    }
  };

  usage('prosecutor');
  for (const charge of record.charges) emit(REPLAY_DELAYS.charge, { type: 'charge', caseId: record.id, charge });
  phase('trial');
  for (const evidence of record.evidence) {
    emit(REPLAY_DELAYS.evidence, { type: 'evidence', caseId: record.id, evidence });
  }
  phase('deliberation');
  usage('defense');
  for (const rebuttal of record.rebuttals) {
    emit(REPLAY_DELAYS.rebuttal, { type: 'rebuttal', caseId: record.id, rebuttal });
  }
  usage('judge');
  for (const ruling of record.rulings) emit(REPLAY_DELAYS.ruling, { type: 'ruling', caseId: record.id, ruling });
  steps.push({ delayMs: REPLAY_DELAYS.close, event: { type: 'case', record } });
  return steps;
}
