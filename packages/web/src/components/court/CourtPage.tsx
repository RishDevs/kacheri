import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { CaseRecord } from '@kacheri/shared';
import type { CourtSource, CreateCaseInput } from '../../court/source';
import { courtReducer, initialCourtState, sortCases } from '../../court/state';
import { caseNumber } from '../../court/judgment';
import { caseTally, caseTotals, formatUsd, isActive, isoDate } from '../../court/summary';
import { caseHref, followInApp } from '../links';
import { Masthead } from '../TopNav';
import { CaseView } from './CaseView';

type Connection = 'connecting' | 'live' | 'offline' | 'demo';

const CONNECTION_TEXT: Record<Connection, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  offline: 'Disconnected — retrying',
  demo: 'Demo replay',
};

function DocketJudgment({ record }: { record: CaseRecord }) {
  if (isActive(record.status)) return <span className="verdict">IN SESSION</span>;
  if (record.status === 'error') {
    return (
      <>
        <span className="verdict">MISTRIAL</span>
        <span className="verdict-note">did not finish</span>
      </>
    );
  }
  const { convicted } = caseTally(record);
  if (convicted === 0) return <span className="verdict verdict-not-guilty">NOT GUILTY</span>;
  const total = record.charges.length;
  return (
    <>
      <span className="verdict verdict-guilty">{`GUILTY ${convicted}`}</span>
      <span className="verdict-note">{`of ${total} count${total === 1 ? '' : 's'}`}</span>
    </>
  );
}

function DocketTable({
  cases,
  recordedAt,
  onSelect,
}: {
  cases: CaseRecord[];
  recordedAt: Readonly<Record<string, string>>;
  onSelect(id: string): void;
}) {
  return (
    <div className="table-wrap">
      <table className="record-table docket-table" aria-label="Case docket">
        <thead>
          <tr>
            <th scope="col">Case No.</th>
            <th scope="col">Parties</th>
            <th scope="col">Filed</th>
            <th scope="col">Judgment</th>
            <th scope="col">Costs</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => {
            const filed = recordedAt[c.id] ?? c.startedAt;
            return (
              <tr key={c.id}>
                <td className="n">{caseNumber(c)}</td>
                <td>
                  <a href={caseHref(c.id)} onClick={(e) => followInApp(e, () => onSelect(c.id))}>
                    {c.title}
                  </a>
                </td>
                <td className="n">
                  <time dateTime={filed}>{isoDate(filed)}</time>
                </td>
                <td>
                  <DocketJudgment record={c} />
                </td>
                <td className="n">{formatUsd(caseTotals(c.usage).costUsd)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
    <section className="file-case">
      <h2 className="sec">File a new case</h2>
      <p className="p dim">The court reviews the change from the base ref to the head ref of a local repository.</p>
      <form className="case-form" aria-label="File a case" onSubmit={submit}>
        {FIELDS.map((f) => (
          <label key={f.key} className="field">
            {f.label}
            <input
              value={input[f.key]}
              placeholder={f.placeholder}
              onChange={(e) => setInput({ ...input, [f.key]: e.target.value })}
            />
          </label>
        ))}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-dark" disabled={busy}>
          {busy ? 'Filing…' : 'Open the trial'}
        </button>
      </form>
    </section>
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
  const status = (
    <span className={`conn conn-${connection}`} role="status">
      {CONNECTION_TEXT[connection]}
    </span>
  );

  return (
    <div className="site">
      <Masthead nav={nav} status={status} />
      <main className="sheet-wrap">
        {error && (
          <p className="banner-error" role="alert">
            {error}
          </p>
        )}
        {selected ? (
          <CaseView
            key={selected.id}
            record={selected}
            replay={source.mode === 'demo'}
            recordedAt={recordedAt.current[selected.id] ?? null}
            onBack={() => onSelect(null)}
            onReplay={source.replay ? () => setReplayNonce((n) => n + 1) : undefined}
            onSkip={source.replay ? () => stopReplay.current?.() : undefined}
          />
        ) : caseId ? (
          <p className="page-note">{loaded ? `Case ${caseId} was not found.` : 'Loading the case…'}</p>
        ) : (
          <article className="filing docket" aria-label="Docket">
            <h1 className="court-name">The Kacheri Court of Code Review</h1>
            <p className="court-sitting">Docket of cases</p>
            <p className="lede">
              Each case is a pull request on trial. A charge counts only when it comes with a test that fails after the
              change and passed before it.
            </p>
            {cases.length === 0 ? (
              <p className="p dim docket-empty">{loaded ? 'No cases have been filed yet.' : 'Loading the docket…'}</p>
            ) : (
              <DocketTable cases={cases} recordedAt={recordedAt.current} onSelect={onSelect} />
            )}
            {source.createCase && <FileCaseForm onSubmit={createCase} />}
          </article>
        )}
      </main>
    </div>
  );
}
