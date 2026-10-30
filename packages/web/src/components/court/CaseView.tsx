import { useEffect, useMemo, useState } from 'react';
import type { CaseRecord, CaseStatus, Charge, Evidence, Rebuttal, WitnessOutcome } from '@kacheri/shared';
import { patchToDiff } from '../../diff';
import {
  STATUS_TEXT,
  TIERS,
  caseExtras,
  caseTally,
  caseTotals,
  chargeOutcome,
  elapsedMs,
  formatDuration,
  formatTokens,
  formatUsd,
  isActive,
  type ChargeOutcome,
} from '../../court/summary';
import { DiffViewer } from '../DiffViewer';

export function useNow(ticking: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [ticking, intervalMs]);
  return now;
}

export function CaseStatusBadge({ status }: { status: CaseStatus }) {
  return <span className={`case-status case-status-${status}`}>{STATUS_TEXT[status]}</span>;
}

const PHASES: readonly CaseStatus[] = ['filing', 'trial', 'deliberation', 'closed'];

function PhaseTrack({ status }: { status: CaseStatus }) {
  const at = PHASES.indexOf(status);
  return (
    <ol className="phases" aria-label="Phase">
      {PHASES.map((p, i) => (
        <li
          key={p}
          className={`phase${i < at ? ' phase-done' : ''}${i === at ? ' phase-current' : ''}`}
          aria-current={i === at ? 'step' : undefined}
        >
          {STATUS_TEXT[p]}
        </li>
      ))}
    </ol>
  );
}

const OUTCOME_TEXT: Record<WitnessOutcome, string> = { pass: 'pass', fail: 'fail', error: 'error', timeout: 'timeout' };

function RunChips({ label, outcomes }: { label: 'base' | 'head'; outcomes: WitnessOutcome[] }) {
  return (
    <div className="runs" aria-label={`${label} runs`}>
      <span className="runs-label">{label}</span>
      {outcomes.map((o, i) => (
        <span key={i} className={`chip chip-${o}`} title={`${label} run ${i + 1}: ${o}`}>
          {OUTCOME_TEXT[o]}
        </span>
      ))}
    </div>
  );
}

function Pending({ active, text }: { active: boolean; text: string }) {
  return active ? (
    <p className="pending">
      <span className="pending-dot" aria-hidden="true" />
      {text}
    </p>
  ) : (
    <p className="muted cell-empty">—</p>
  );
}

function ChargeCell({ charge }: { charge: Charge }) {
  return (
    <div className="cell enter">
      <div className="cell-head">
        <span className="charge-id">{charge.id}</span>
        <span className={`sev sev-${charge.severity}`}>{charge.severity}</span>
        <code className="loc">
          {charge.file}
          {charge.line !== null && `:${charge.line}`}
        </code>
      </div>
      <p className="claim">{charge.claim}</p>
      <details className="witness">
        <summary>
          Witness <code>{charge.witnessPath}</code>
        </summary>
        <pre className="code-block">{charge.witnessCode}</pre>
      </details>
    </div>
  );
}

function EvidenceCell({ evidence, active }: { evidence: Evidence | undefined; active: boolean }) {
  if (!evidence) return <Pending active={active} text="Running witness on base and head…" />;
  return (
    <div className="cell enter">
      <div className="cell-head">
        <span className={`pill ${evidence.admissible ? 'pill-admissible' : 'pill-inadmissible'}`}>
          {evidence.admissible ? 'Admissible' : 'Inadmissible'}
        </span>
      </div>
      <RunChips label="base" outcomes={evidence.base} />
      <RunChips label="head" outcomes={evidence.head} />
      <p className="reason">{evidence.reason}</p>
      {evidence.headLog && (
        <details className="log-details">
          <summary>Head log</summary>
          <pre className="log">{evidence.headLog}</pre>
        </details>
      )}
    </div>
  );
}

function DefenseCell({
  rebuttal,
  evidence,
  active,
}: {
  rebuttal: Rebuttal | undefined;
  evidence: Evidence | undefined;
  active: boolean;
}) {
  if (rebuttal) {
    return (
      <div className="cell enter">
        <div className="cell-head">
          <span className={`pill ${rebuttal.concedes ? 'pill-concedes' : 'pill-contests'}`}>
            {rebuttal.concedes ? 'Concedes' : 'Contests'}
          </span>
        </div>
        <p className="argument">{rebuttal.argument}</p>
      </div>
    );
  }
  if (evidence && !evidence.admissible) return <p className="muted cell-na">Not heard: evidence inadmissible.</p>;
  return <Pending active={active} text={evidence ? 'Defense is preparing…' : 'Awaiting evidence'} />;
}

function RulingCell({ outcome, active }: { outcome: ChargeOutcome; active: boolean }) {
  if (outcome.state === 'pending') return <Pending active={active} text="Awaiting ruling" />;
  return (
    <div className={`cell enter ruling ruling-${outcome.state}`}>
      <span className="ruling-mark">{outcome.state === 'convicted' ? 'Convicted' : 'Dismissed'}</span>
      <p className="ruling-reason">{outcome.reason}</p>
    </div>
  );
}

const LANES = ['Charges', 'Evidence', 'Defense', 'Ruling'] as const;

function Lanes({ record }: { record: CaseRecord }) {
  const active = isActive(record.status);
  return (
    <section className="lanes" aria-label="Proceedings">
      <div className="lane-heads" aria-hidden="true">
        {LANES.map((l) => (
          <span key={l} className="lane-title">
            {l}
          </span>
        ))}
      </div>
      {record.charges.length === 0 &&
        (active ? (
          <Pending active text="The prosecutor is reading the diff…" />
        ) : (
          <p className="muted">No charges filed.</p>
        ))}
      {record.charges.map((charge) => {
        const evidence = record.evidence.find((e) => e.chargeId === charge.id);
        const rebuttal = record.rebuttals.find((r) => r.chargeId === charge.id);
        const outcome = chargeOutcome(record, charge.id);
        return (
          <div
            key={charge.id}
            className={`lane-row outcome-${outcome.state}`}
            role="group"
            aria-label={`Charge ${charge.id}`}
          >
            <div className="lane-cell" data-lane="Charges">
              <ChargeCell charge={charge} />
            </div>
            <div className="lane-cell" data-lane="Evidence">
              <EvidenceCell evidence={evidence} active={active} />
            </div>
            <div className="lane-cell" data-lane="Defense">
              <DefenseCell rebuttal={rebuttal} evidence={evidence} active={active} />
            </div>
            <div className="lane-cell" data-lane="Ruling">
              <RulingCell outcome={outcome} active={active} />
            </div>
          </div>
        );
      })}
    </section>
  );
}

export interface CaseViewProps {
  record: CaseRecord;
  onReplay?(): void;
  onSkip?(): void;
}

export function CaseView({ record, onReplay, onSkip }: CaseViewProps) {
  const active = isActive(record.status);
  const now = useNow(active);
  const totals = useMemo(() => caseTotals(record.usage), [record.usage]);
  const tally = caseTally(record);
  const { patch, description } = caseExtras(record);
  const diff = useMemo(
    () => (patch ? patchToDiff(patch, record.baseRef, record.headRef) : null),
    [patch, record.baseRef, record.headRef],
  );

  return (
    <article className="case-view" aria-label={`Case ${record.title}`}>
      <header className="case-head">
        <div className="case-title-block">
          <h2>{record.title}</h2>
          <p className="muted case-refs">
            <code>{record.id}</code> · <CaseStatusBadge status={record.status} /> · <code>{record.repoPath}</code> ·
            base <code>{record.baseRef.slice(0, 10)}</code> → head <code>{record.headRef.slice(0, 10)}</code>
          </p>
        </div>
        <dl className="meters" aria-label="Case meters">
          <div className="meter">
            <dt>Cost</dt>
            <dd>{formatUsd(totals.costUsd)}</dd>
          </div>
          {TIERS.map((t) => (
            <div key={t} className="meter" title={`${totals.tokens[t].calls} call(s)`}>
              <dt>{t}</dt>
              <dd>{formatTokens(totals.tokens[t].prompt + totals.tokens[t].completion)} tok</dd>
            </div>
          ))}
          <div className="meter">
            <dt>Elapsed</dt>
            <dd>{formatDuration(elapsedMs(record, now))}</dd>
          </div>
        </dl>
      </header>

      <div className="case-bar">
        <PhaseTrack status={record.status} />
        <p className="tally" aria-label="Tally">
          <span className="tally-convicted">{tally.convicted} convicted</span> ·{' '}
          <span className="tally-dismissed">{tally.dismissed} dismissed</span>
          {tally.inadmissible > 0 && <> ({tally.inadmissible} inadmissible)</>}
          {tally.pending > 0 && <> · {tally.pending} pending</>}
        </p>
        {(onReplay || onSkip) && (
          <div className="actions">
            {onSkip && active && (
              <button type="button" onClick={onSkip}>
                Skip to verdict
              </button>
            )}
            {onReplay && (
              <button type="button" onClick={onReplay}>
                Replay
              </button>
            )}
          </div>
        )}
      </div>

      {record.error && (
        <p className="error" role="alert">
          {record.error}
        </p>
      )}

      {description && (
        <details className="pr-description">
          <summary>PR description</summary>
          <p>{description}</p>
        </details>
      )}

      <details className="case-diff" open>
        <summary>
          Diff{diff && ` · ${diff.files.length} file${diff.files.length === 1 ? '' : 's'}`}
        </summary>
        {diff ? (
          <DiffViewer diff={diff} verdicts={[]} />
        ) : (
          <p className="muted">This case record carries no patch, so the diff is unavailable.</p>
        )}
      </details>

      <Lanes record={record} />
    </article>
  );
}
