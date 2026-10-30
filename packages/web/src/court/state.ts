import type { CaseRecord, CourtEvent } from '@kacheri/shared';

export interface CourtState {
  cases: Record<string, CaseRecord>;
}

export const initialCourtState: CourtState = { cases: {} };

export type CourtAction =
  | { type: 'cases/loaded'; cases: CaseRecord[] }
  | { type: 'case/loaded'; record: CaseRecord }
  | { type: 'event'; event: CourtEvent };

function upsert<T>(list: T[], item: T, key: (x: T) => string): T[] {
  const k = key(item);
  const idx = list.findIndex((x) => key(x) === k);
  if (idx === -1) return [...list, item];
  const next = list.slice();
  next[idx] = item;
  return next;
}

// A `case` event carries the authoritative record and replaces whatever was accumulated.
export function applyToRecord(record: CaseRecord, event: CourtEvent): CaseRecord {
  switch (event.type) {
    case 'case':
      return event.record;
    case 'charge':
      return { ...record, charges: upsert(record.charges, event.charge, (c) => c.id) };
    case 'evidence':
      return { ...record, evidence: upsert(record.evidence, event.evidence, (e) => e.chargeId) };
    case 'rebuttal':
      return { ...record, rebuttals: upsert(record.rebuttals, event.rebuttal, (r) => r.chargeId) };
    case 'ruling':
      return { ...record, rulings: upsert(record.rulings, event.ruling, (r) => r.chargeId) };
    case 'usage':
      return { ...record, usage: [...record.usage, event.usage] };
    case 'remedy':
      return { ...record, remedy: event.remedy };
  }
}

export function courtReducer(state: CourtState, action: CourtAction): CourtState {
  switch (action.type) {
    case 'cases/loaded': {
      const cases: Record<string, CaseRecord> = {};
      for (const c of action.cases) cases[c.id] = c;
      return { cases };
    }
    case 'case/loaded':
      return { cases: { ...state.cases, [action.record.id]: action.record } };
    case 'event': {
      const { event } = action;
      if (event.type === 'case') return { cases: { ...state.cases, [event.record.id]: event.record } };
      const current = state.cases[event.caseId];
      if (!current) return state;
      return { cases: { ...state.cases, [event.caseId]: applyToRecord(current, event) } };
    }
  }
}

export function sortCases(cases: Record<string, CaseRecord>): CaseRecord[] {
  return Object.values(cases).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
