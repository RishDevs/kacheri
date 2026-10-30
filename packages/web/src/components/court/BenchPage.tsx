import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { BenchResult } from '@kacheri/shared';
import {
  SYSTEMS,
  benchRows,
  summarize,
  type BenchData,
  type BenchSystem,
  type SystemSummary,
} from '../../court/bench';
import type { CourtSource } from '../../court/source';
import { formatDuration, formatUsd } from '../../court/summary';

const SYSTEM_LABEL: Record<BenchSystem, string> = { court: 'Court', baseline: 'Baseline' };

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

interface Metric {
  key: 'hitRate' | 'fpPerPr' | 'costPerPr';
  label: string;
  better: 'higher' | 'lower';
  format(n: number): string;
  // fixed scale maximum; otherwise bars are scaled to the larger of the two systems
  max?: number;
}

const METRICS: Metric[] = [
  { key: 'hitRate', label: 'Hit rate', better: 'higher', format: pct, max: 1 },
  { key: 'fpPerPr', label: 'False positives per PR', better: 'lower', format: (n) => n.toFixed(2) },
  { key: 'costPerPr', label: 'Cost per PR', better: 'lower', format: formatUsd },
];

function MetricBars({ metric, summaries }: { metric: Metric; summaries: SystemSummary[] }) {
  const max = metric.max ?? Math.max(0, ...summaries.map((s) => s[metric.key]));
  return (
    <div className="metric" role="group" aria-label={metric.label}>
      <h3 className="metric-title">
        {metric.label} <span className="muted">· {metric.better} is better</span>
      </h3>
      {summaries.map((s) => {
        const value = s[metric.key];
        const width = max > 0 ? Math.min(100, (value / max) * 100) : 0;
        return (
          <div key={s.system} className="bar-row">
            <span className="bar-label">{SYSTEM_LABEL[s.system]}</span>
            <span className="bar-track">
              <span className={`bar bar-${s.system}`} style={{ width: `${width}%` }} />
            </span>
            <span className="bar-value" data-system={s.system}>
              {metric.format(value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SummaryTable({ summaries }: { summaries: SystemSummary[] }) {
  return (
    <table className="data-table" aria-label="Summary">
      <thead>
        <tr>
          <th>System</th>
          <th>PRs</th>
          <th>Hits</th>
          <th>Hit rate</th>
          <th>FP / PR</th>
          <th>Precision</th>
          <th>$ / PR</th>
          <th>p50 latency</th>
        </tr>
      </thead>
      <tbody>
        {summaries.map((s) => (
          <tr key={s.system}>
            <th scope="row">{SYSTEM_LABEL[s.system]}</th>
            <td>{s.items}</td>
            <td>{s.hits}</td>
            <td>{pct(s.hitRate)}</td>
            <td>{s.fpPerPr.toFixed(2)}</td>
            <td>{s.precision === null ? '—' : pct(s.precision)}</td>
            <td>{formatUsd(s.costPerPr)}</td>
            <td>{formatDuration(s.p50LatencyMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ResultCells({ result }: { result: BenchResult | undefined }) {
  if (!result) {
    return (
      <td colSpan={4} className="muted">
        not run
      </td>
    );
  }
  const reported = result.system === 'court' ? `${result.convicted}/${result.findings}` : String(result.findings);
  return (
    <>
      <td className={result.hit ? 'hit' : 'miss'}>{result.hit ? 'hit' : 'miss'}</td>
      <td>
        {reported}
        {result.falsePositives > 0 && <span className="fp"> · {result.falsePositives} FP</span>}
      </td>
      <td>{formatUsd(result.costUsd)}</td>
      <td>{formatDuration(result.latencyMs)}</td>
    </>
  );
}

function ItemTable({ data }: { data: BenchData }) {
  const rows = useMemo(() => benchRows(data), [data]);
  return (
    <table className="data-table item-table" aria-label="Per-item results">
      <thead>
        <tr>
          <th rowSpan={2}>Item</th>
          <th rowSpan={2}>Injected bug</th>
          <th colSpan={4}>Court</th>
          <th colSpan={4}>Baseline</th>
        </tr>
        <tr>
          <th>Result</th>
          <th title="convicted / charges filed">Convicted</th>
          <th>Cost</th>
          <th>Latency</th>
          <th>Result</th>
          <th>Findings</th>
          <th>Cost</th>
          <th>Latency</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.itemId}>
            <td>
              <code>{row.itemId}</code>
            </td>
            <td className="item-desc">
              {row.item ? (
                <>
                  <span className="op">{row.item.operator}</span>{' '}
                  <code>
                    {row.item.file}:{row.item.line}
                  </code>{' '}
                  <span className="muted">{row.item.description}</span>
                </>
              ) : (
                <span className="muted">—</span>
              )}
            </td>
            <ResultCells result={row.court} />
            <ResultCells result={row.baseline} />
          </tr>
        ))}
      </tbody>
    </table>
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

  return (
    <div className="app bench">
      <header className="app-head">
        <h1>Kacheri</h1>
        {nav}
        <span className="conn muted">Benchmark</span>
      </header>
      {data?.sample && (
        <div className="sample-banner" role="note" aria-label="Sample data">
          <strong>Sample data.</strong> These numbers are illustrative placeholders, not real benchmark results.
          {data.label && <span className="sample-label"> {data.label}</span>}
        </div>
      )}
      <main className="bench-main">
        <header className="bench-head">
          <h2>Court vs baseline</h2>
          <p className="muted">
            Injected bugs that survive the target repo&apos;s own test suite. A hit means a reported finding (court:
            a convicted charge) lands in the same file within 3 lines of the injected bug.
            {data?.generatedAt && <> Generated {new Date(data.generatedAt).toLocaleString()}.</>}
          </p>
        </header>
        {load.kind === 'loading' && <p className="muted">Loading results…</p>}
        {load.kind === 'missing' && <p className="muted">No benchmark results published yet.</p>}
        {load.kind === 'error' && (
          <p className="error" role="alert">
            {load.message}
          </p>
        )}
        {data && (
          <>
            <section className="metrics" aria-label="Comparison">
              {METRICS.map((m) => (
                <MetricBars key={m.key} metric={m} summaries={summaries} />
              ))}
            </section>
            <section aria-label="Summary table" className="table-wrap">
              <SummaryTable summaries={summaries} />
            </section>
            <section aria-label="Items" className="table-wrap">
              <h3>Per item</h3>
              <ItemTable data={data} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
