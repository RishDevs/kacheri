import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { CaseRecord } from '@kacheri/shared';
import type { CourtSource, CreateCaseInput } from '../../court/source';
import { courtReducer, initialCourtState, sortCases } from '../../court/state';
import { admissibleCount, caseTally, caseTotals, formatUsd, isoDate, shortSha } from '../../court/summary';
import { CaseStatusBadge, CaseView } from './CaseView';

type Connection = 'connecting' | 'live' | 'offline' | 'demo';

const CONNECTION_TEXT: Record<Connection, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  offline: 'Disconnected — retrying',
  demo: 'Demo replay',
};

function CaseDocket({
  cases,
  recordedAt,
  onSelect,
}: {
  cases: CaseRecord[];
  recordedAt: Readonly<Record<string, string>>;
  onSelect(id: string): void;
}) {
  return (
    <section className="case-docket" aria-label="Cases">
      <h2 className="section-head">
        Cases <span className="count">{cases.length}</span>
      </h2>
      {cases.length === 0 ? (
        <p className="muted">No cases yet.</p>
      ) : (
        <table className="data-table docket-table" aria-label="Case docket">
          <thead>
            <tr>
              <th scope="col">Case</th>
              <th scope="col">Status</th>
              <th scope="col">Base..head</th>
              <th scope="col" className="num">
                Filed
              </th>
              <th scope="col" className="num">
                Admissible
              </th>
              <th scope="col" className="num">
                Convicted
              </th>
              <th scope="col" className="num">
                Cost
              </th>
              <th scope="col">Date</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => {
              const convicted = caseTally(c).convicted;
              const date = recordedAt[c.id] ?? c.startedAt;
              return (
                <tr key={c.id}>
                  <td className="docket-title">
                    <button type="button" className="row-link" onClick={() => onSelect(c.id)}>
                      {c.title}
                    </button>
                    <code className="muted docket-id">{c.id}</code>
                  </td>
                  <td>
                    <CaseStatusBadge status={c.status} />
                  </td>
                  <td>
                    <code title={`${c.baseRef}..${c.headRef}`}>
                      {shortSha(c.baseRef)}..{shortSha(c.headRef)}
                    </code>
                  </td>
                  <td className="num">{c.charges.length}</td>
                  <td className="num">{admissibleCount(c)}</td>
                  <td className={`num${convicted > 0 ? ' tally-convicted' : ''}`}>{convicted}</td>
                  <td className="num">{formatUsd(caseTotals(c.usage).costUsd)}</td>
                  <td>
                    <time dateTime={date}>{isoDate(date)}</time>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

const EMPTY_INPUT: CreateCaseInput = { title: '', repoPath: '', baseRef: '', headRef: '' };
const FIELDS: { key: keyof CreateCaseInput; label: string; placeholder: string }[] = [
  { key: 'title', label: 'Title', placeholder: 'feat: add range support' },
  { key: 'repoPath', label: 'Repository path', placeholder: '/path/to/repo' },
  { key: 'baseRef', label: 'Base ref', placeholder: 'main' },
  { key: 'headRef', label: 'Head ref', placeholder: 'feature-branch' },
];

export function validateCaseInput(input: CreateCaseInput): string | null {
  const missing = FIELDS.filter((f) => !input[f.key].trim()).map((f) => f.label);
  return missing.length ? `Required: ${missing.join(', ')}` : null;
}

function FileCaseForm({ onSubmit }: { onSubmit(input: CreateCaseInput): Promise<unknown> }) {
  const [input, setInput] = useState<CreateCaseInput>(EMPTY_INPUT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = Object.fromEntries(FIELDS.map((f) => [f.key, input[f.key].trim()])) as unknown as CreateCaseInput;
    const invalid = validateCaseInput(trimmed);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      setInput(EMPTY_INPUT);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="create-form" aria-label="File a case" onSubmit={submit}>
      <h2>File a case</h2>
      {FIELDS.map((f) => (
        <label key={f.key}>
          {f.label}
          <input
            value={input[f.key]}
            placeholder={f.placeholder}
            onChange={(e) => setInput({ ...input, [f.key]: e.target.value })}
          />
        </label>
      ))}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="primary" disabled={busy}>
        {busy ? 'Filing…' : 'Open trial'}
      </button>
    </form>
  );
}

export interface CourtPageProps {
  source: CourtSource;
  caseId: string | null;
  onSelect(id: string | null): void;
  nav?: ReactNode;
}

export function CourtPage({ source, caseId, onSelect, nav }: CourtPageProps) {
  const [state, dispatch] = useReducer(courtReducer, initialCourtState);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>(source.mode === 'demo' ? 'demo' : 'connecting');
  const [replayNonce, setReplayNonce] = useState(0);
  const stopReplay = useRef<(() => void) | null>(null);
  // Original run dates; demo replays restart the clock on the records themselves.
  const recordedAt = useRef<Record<string, string>>({});
  const remember = useCallback((records: CaseRecord[]) => {
    for (const r of records) {
      if (!(r.id in recordedAt.current)) recordedAt.current[r.id] = r.endedAt ?? r.startedAt;
    }
  }, []);

  const load = useCallback(() => {
    source.listCases().then(
      (cases) => {
        remember(cases);
        dispatch({ type: 'cases/loaded', cases });
        setLoaded(true);
        setError(null);
      },
      (err: Error) => setError(err.message),
    );
  }, [source, remember]);

  useEffect(() => {
    load();
    let dropped = false;
    const sub = source.subscribe({
      onEvent: (event) => dispatch({ type: 'event', event }),
      onOpen: () => {
        if (source.mode === 'live') setConnection('live');
        if (dropped) load();
        dropped = false;
      },
      onError: () => {
        setConnection('offline');
        dropped = true;
      },
    });
    return () => sub.close();
  }, [source, load]);

  useEffect(() => {
    if (!caseId || source.replay) return;
    let cancelled = false;
    source.getCase(caseId).then(
      (record) => {
        if (cancelled) return;
        remember([record]);
        dispatch({ type: 'case/loaded', record });
      },
      (err: Error) => {
        if (!cancelled) setError(err.message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [source, caseId, remember]);

  useEffect(() => {
    if (!caseId || !loaded || !source.replay) return;
    const stop = source.replay(caseId);
    stopReplay.current = stop;
    return () => {
      stop();
      stopReplay.current = null;
    };
  }, [source, caseId, loaded, replayNonce]);

  const createCase = useCallback(
    async (input: CreateCaseInput) => {
      if (!source.createCase) return;
      const record = await source.createCase(input);
      dispatch({ type: 'case/loaded', record });
      onSelect(record.id);
    },
    [source, onSelect],
  );

  const cases = useMemo(() => sortCases(state.cases), [state.cases]);
  const selected = caseId ? state.cases[caseId] : undefined;

  return (
    <div className="app court">
      <header className="app-head">
        <h1>Kacheri</h1>
        {nav}
        <span className={`conn conn-${connection}`} role="status">
          {CONNECTION_TEXT[connection]}
        </span>
      </header>
      {error && (
        <p className="error banner" role="alert">
          {error}
        </p>
      )}
      {selected ? (
        <main className="court-case">
          <button type="button" className="link back-link" onClick={() => onSelect(null)}>
            All cases
          </button>
          <CaseView
            key={selected.id}
            record={selected}
            replay={source.mode === 'demo'}
            recordedAt={recordedAt.current[selected.id] ?? null}
            onReplay={source.replay ? () => setReplayNonce((n) => n + 1) : undefined}
            onSkip={source.replay ? () => stopReplay.current?.() : undefined}
          />
        </main>
      ) : caseId ? (
        <main className="court-index">
          <p className="muted">{loaded ? `Case ${caseId} not found.` : 'Loading case…'}</p>
        </main>
      ) : (
        <main className="court-index">
          <section className="court-intro" aria-label="About the court">
            <h2>No evidence, no finding.</h2>
            <p className="muted">
              Every charge filed against a pull request must come with a witness test that fails on the head and passes
              on the base, three runs each. Admissible charges face a defense and a judge; everything else is
              dismissed.
            </p>
          </section>
          <div className={source.createCase ? 'court-index-grid' : undefined}>
            <CaseDocket cases={cases} recordedAt={recordedAt.current} onSelect={onSelect} />
            {source.createCase && <FileCaseForm onSubmit={createCase} />}
          </div>
        </main>
      )}
    </div>
  );
}
