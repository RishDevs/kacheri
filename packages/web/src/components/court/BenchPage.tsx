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
import { formatDuration, formatUsd, isoDate } from '../../court/summary';

const SYSTEM_LABEL: Record<BenchSystem, string> = { court: 'Court', baseline: 'Baseline' };

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

interface Metric {
  key: string;
  label: string;
  better: 'higher' | 'lower';
  value(s: SystemSummary): number | null;
  format(n: number): string;
  // fixed scale maximum; otherwise bars are scaled to the larger of the two systems
  max?: number;
}

const METRICS: Metric[] = [
  { key: 'hitRate', label: 'Hit rate', better: 'higher', value: (s) => s.hitRate, format: pct, max: 1 },
  {
    key: 'fpPerPr',
    label: 'False positives per PR',
    better: 'lower',
    value: (s) => s.fpPerPr,
    format: (n) => n.toFixed(2),
  },
  { key: 'precision', label: 'Precision', better: 'higher', value: (s) => s.precision, format: pct, max: 1 },
  { key: 'costPerPr', label: 'Cost per PR', better: 'lower', value: (s) => s.costPerPr, format: formatUsd },
  {
    key: 'p50LatencyMs',
    label: 'p50 latency',
    better: 'lower',
    value: (s) => s.p50LatencyMs,
    format: formatDuration,
  },
];

function MetricRules({ metric, summaries }: { metric: Metric; summaries: SystemSummary[] }) {
  const values = summaries.map((s) => metric.value(s));
  const max = metric.max ?? Math.max(0, ...values.map((v) => v ?? 0));
  return (
    <div className="metric" role="group" aria-label={metric.label}>
      <div className="metric-head">
        <span className="metric-title">{metric.label}</span>
        <span className="label">{metric.better} is better</span>
      </div>
      {summaries.map((s, i) => {
        const value = values[i];
        const width = value !== null && max > 0 ? Math.min(100, (value / max) * 100) : 0;
        return (
          <div key={s.system} className="rule-row">
            <span className="rule-system">{SYSTEM_LABEL[s.system]}</span>
            <span className="rule-track">
              <span className={`rule-bar rule-${s.system}`} style={{ width: `${width}%` }} />
            </span>
            <span className="rule-value" data-system={s.system}>
              {value === null ? '—' : metric.format(value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ComparisonTable({ summaries }: { summaries: SystemSummary[] }) {
  return (
    <table className="data-table compare-table" aria-label="Comparison">
      <thead>
        <tr>
          <th scope="col">System</th>
          <th scope="col" className="num">
            Hit rate
          </th>
          <th scope="col" className="num" title="False positives per PR">
            FP / PR
          </th>
          <th scope="col" className="num">
            Precision
          </th>
          <th scope="col" className="num">
            $ / PR
          </th>
          <th scope="col" className="num">
            p50 latency
          </th>
          <th scope="col" className="num">
            n
          </th>
        </tr>
      </thead>
      <tbody>
        {summaries.map((s) => (
          <tr key={s.system}>
            <th scope="row">{SYSTEM_LABEL[s.system]}</th>
            <td className="num" title={`${s.hits}/${s.items} hits`}>
              {pct(s.hitRate)}
            </td>
            <td className="num">{s.fpPerPr.toFixed(2)}</td>
            <td className="num">{s.precision === null ? '—' : pct(s.precision)}</td>
            <td className="num">{formatUsd(s.costPerPr)}</td>
            <td className="num">{formatDuration(s.p50LatencyMs)}</td>
            <td className="num">{s.items}</td>
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
      <td className={`sys-start ${result.hit ? 'hit' : 'miss'}`}>{result.hit ? 'hit' : 'miss'}</td>
      <td className="num">
        {reported}
        {result.falsePositives > 0 && <span className="fp"> · {result.falsePositives} FP</span>}
      </td>
      <td className="num">{formatUsd(result.costUsd)}</td>
      <td className="num">{formatDuration(result.latencyMs)}</td>
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
          <span className="label">Sample data</span> These numbers are illustrative placeholders, not real benchmark
          results.
          {data.label && <code className="sample-label"> {data.label}</code>}
        </div>
      )}
      <main className="bench-main">
        <header className="page-head">
          <h2>Court vs baseline</h2>
          <p className="muted">
            Injected bugs that survive the target repo&apos;s own test suite. A hit means a reported finding (court:
            a convicted charge) lands in the same file within 3 lines of the injected bug.
            {data?.generatedAt && <> Generated {isoDate(data.generatedAt)}.</>}
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
            <section aria-label="Comparison table" className="bench-section table-wrap">
              <h3 className="section-head">Comparison</h3>
              <ComparisonTable summaries={summaries} />
            </section>
            <section aria-label="Metrics" className="bench-section">
              <h3 className="section-head">By metric</h3>
              <div className="metrics">
                {METRICS.map((m) => (
                  <MetricRules key={m.key} metric={m} summaries={summaries} />
                ))}
              </div>
            </section>
            <section aria-label="Items" className="bench-section table-wrap">
              <h3 className="section-head">Per item</h3>
              <ItemTable data={data} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
