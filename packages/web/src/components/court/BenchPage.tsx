import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  SYSTEMS,
  benchRepos,
  caseMix,
  summarize,
  type BenchData,
  type BenchSystem,
  type SystemSummary,
} from '../../court/bench';
import type { CourtSource } from '../../court/source';
import { longDate } from '../../court/judgment';
import { formatDuration, formatUsd } from '../../court/summary';
import { Masthead } from '../TopNav';

const SYSTEM_LABEL: Record<BenchSystem, string> = {
  court: 'Kacheri Court (proof required)',
  baseline: 'Single reviewer, Nemotron Super',
  'baseline-ultra': 'Single reviewer, Nemotron Ultra',
};

const pct = (n: number) => `${Math.round(n * 100)}%`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function hitRate(s: SystemSummary | undefined): string {
  return s && s.guilty > 0 ? pct(s.hitRate) : '—';
}

function Stats({ court, single }: { court: SystemSummary | undefined; single: SystemSummary | undefined }) {
  return (
    <div className="stats" role="group" aria-label="Headline results">
      <div className="stat">
        <p className="stat-label">GUILTY CHANGES CONVICTED</p>
        <p className="stat-value">{hitRate(court)}</p>
        <p className="stat-note">single reviewer: {hitRate(single)}</p>
      </div>
      <div className="stat">
        <p className="stat-label">FALSE ACCUSATIONS PER CASE</p>
        <p className="stat-value">{court ? court.fpPerPr.toFixed(2) : '—'}</p>
        <p className="stat-note">single reviewer: {single ? single.fpPerPr.toFixed(2) : '—'}</p>
      </div>
      <div className="stat">
        <p className="stat-label">COURT COSTS PER CASE</p>
        <p className="stat-value">{court ? formatUsd(court.costPerPr) : '—'}</p>
        <p className="stat-note">Nemotron on Token Factory</p>
      </div>
    </div>
  );
}

function ResultsTable({ summaries }: { summaries: readonly SystemSummary[] }) {
  return (
    <div className="table-wrap">
      <table className="record-table" aria-label="Results by reviewer">
        <thead>
          <tr>
            <th scope="col">Reviewer</th>
            <th scope="col">Convicted</th>
            <th scope="col">False accusations</th>
            <th scope="col">Precision</th>
            <th scope="col">Cost / case</th>
            <th scope="col">Median time</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((s) => (
            <tr key={s.system}>
              <th scope="row" className={s.system === 'court' ? 'row-head row-court' : 'row-head'}>
                {SYSTEM_LABEL[s.system]}
              </th>
              <td className="n">{s.guilty > 0 ? `${s.hits} of ${s.guilty}` : '—'}</td>
              <td className="n">{s.falsePositives}</td>
              <td className="n">{s.precision === null ? '—' : pct(s.precision)}</td>
              <td className="n">{formatUsd(s.costPerPr)}</td>
              <td className="n">{formatDuration(s.p50LatencyMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CaseMix({ data }: { data: BenchData }) {
  const mix = caseMix(data);
  return (
    <ol className="cases-list">
      {mix.mutant > 0 && (
        <li>
          <strong>{`${plural(mix.mutant, 'planted bug', 'planted bugs')}.`}</strong> Small edits, such as a flipped
          comparison, that the library’s own tests do not catch.
        </li>
      )}
      {mix.historical > 0 && (
        <li>
          <strong>{`${plural(mix.historical, 'real regression', 'real regressions')}.`}</strong> Bugs the maintainers
          fixed upstream, re-introduced as innocent-looking refactors.
        </li>
      )}
      {mix.clean > 0 && (
        <li>
          <strong>{`${plural(mix.clean, 'innocent change', 'innocent changes')}.`}</strong> Renames and reorders that
          change nothing. Any conviction here is a false accusation.
        </li>
      )}
    </ol>
  );
}

export interface BenchPageProps {
  source: CourtSource;
  nav?: ReactNode;
}

type LoadState = { kind: 'loading' } | { kind: 'missing' } | { kind: 'error'; message: string } | { kind: 'ready'; data: BenchData };

export function BenchPage({ source, nav }: BenchPageProps) {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    source.loadBench().then(
      (data) => {
        if (!cancelled) setLoad(data ? { kind: 'ready', data } : { kind: 'missing' });
      },
      (err: Error) => {
        if (!cancelled) setLoad({ kind: 'error', message: err.message });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [source]);

  const data = load.kind === 'ready' ? load.data : null;
  const summaries = useMemo(
    () => (data ? SYSTEMS.map((s) => summarize(data.results, s)).filter((s): s is SystemSummary => s !== null) : []),
    [data],
  );
  const court = summaries.find((s) => s.system === 'court');
  const single = summaries.find((s) => s.system === 'baseline');
  const trials = data ? caseMix(data).total : 0;
  const repos = data ? benchRepos(data) : '';
  const generated = data ? longDate(data.generatedAt) : '';

  return (
    <div className="site">
      <Masthead nav={nav} />
      <main className="sheet-wrap">
        <article className="filing record" aria-label="Court record">
          {data?.sample && (
            <p className="sample-note" role="note" aria-label="Sample data">
              <strong>Sample data.</strong> These numbers are illustrative placeholders, not real benchmark results.
              {data.label && <span className="sample-label">{` ${data.label}`}</span>}
            </p>
          )}
          <p className="court-name">The Kacheri Court of Code Review</p>
          <p className="court-sitting">
            {data ? `Record of ${plural(trials, 'trial', 'trials')}${repos ? `, ${repos}` : ''}` : 'Record of trials'}
          </p>
          <h1 className="record-title">Does demanding proof make code review more trustworthy?</h1>
          <p className="lede">
            Each case is a pull request that either hides a bug the library’s own tests miss, or changes nothing. A good
            court convicts the guilty and lets the innocent go.
          </p>

          {load.kind === 'loading' && <p className="p dim record-status">Loading the record…</p>}
          {load.kind === 'missing' && <p className="p dim record-status">No benchmark results published yet.</p>}
          {load.kind === 'error' && (
            <p className="form-error record-status" role="alert">
              {load.message}
            </p>
          )}

          {data && (
            <>
              <Stats court={court} single={single} />
              <h2 className="sec">I. Results by reviewer</h2>
              <ResultsTable summaries={summaries} />
              <h2 className="sec">II. The cases before the court</h2>
              <CaseMix data={data} />
              <h2 className="sec">III. Method</h2>
              <p className="p">
                A conviction counts as correct when it names the planted bug’s file within three lines. The single
                reviewers read the same change and context, without having to prove anything.{' '}
                {data.sample
                  ? 'These sample numbers are placeholders, not recorded runs.'
                  : 'All results come from recorded runs and can be replayed.'}
                {generated && ` Results generated ${generated}.`}
              </p>
            </>
          )}
        </article>
      </main>
    </div>
  );
}
