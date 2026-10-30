import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { CaseRecord, Charge } from '@kacheri/shared';
import {
  afterColon,
  caseNumber,
  claimText,
  countList,
  defendant,
  dismissal,
  heardChargeIds,
  judgment,
  longDate,
  orderText,
  patchExcerpt,
  plaintiff,
  planExhibits,
  possessive,
  repoLabel,
  timesWord,
  type CountExhibits,
  type ExcerptLine,
} from '../../court/judgment';
import { applyCommand, reproCommand } from '../../court/repro';
import {
  caseTotals,
  chargeOutcome,
  convictedChargeIds,
  elapsedMs,
  formatDuration,
  formatUsd,
  isActive,
  shortSha,
} from '../../court/summary';
import { caseHref, followInApp } from '../links';
import { CopyButton } from './CopyButton';
import { CodeExhibit, ExcerptLines, ExhibitLabel, RunsExhibit, type RunRow } from './Exhibits';

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

const LINE_NUMBERS = Array.from({ length: 28 }, (_, i) => String(i + 1)).join('\n');
// Paragraphs in the parties column; the ")" count until the column has been measured.
const PARTY_LINES = 5;

function location(charge: Pick<Charge, 'file' | 'line'>): string {
  return charge.line === null ? charge.file : `${charge.file}:${charge.line}`;
}

// Lines of text that fit a content box; null when there is no layout to measure.
export function parenLines(contentHeightPx: number, lineHeightPx: number): number | null {
  if (!(contentHeightPx > 0) || !(lineHeightPx > 0)) return null;
  return Math.max(1, Math.round(contentHeightPx / lineHeightPx));
}

// "v." is always a single line, so its height is the caption's line height.
function measuredLines(parties: HTMLElement): number | null {
  const paragraphs = parties.querySelectorAll('p');
  const probe = parties.querySelector('.versus');
  if (paragraphs.length === 0 || !probe) return null;
  const top = paragraphs[0].getBoundingClientRect().top;
  const bottom = paragraphs[paragraphs.length - 1].getBoundingClientRect().bottom;
  return parenLines(bottom - top, probe.getBoundingClientRect().height);
}

function useLineCount(ref: RefObject<HTMLElement>, fallback: number): number {
  const [lines, setLines] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setLines(measuredLines(el) ?? fallback);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, fallback]);
  return lines;
}

function Caption({ record }: { record: CaseRecord }) {
  const parties = useRef<HTMLDivElement>(null);
  const lines = useLineCount(parties, PARTY_LINES);
  return (
    <div className="caption" role="group" aria-label="Caption">
      <div className="caption-parties" ref={parties}>
        <p>{`${plaintiff(record)},`}</p>
        <p className="party-role">Plaintiff,</p>
        <p className="versus">v.</p>
        <p>{defendant(record)}</p>
        <p className="party-role">Defendant.</p>
      </div>
      <div className="caption-parens" aria-hidden="true">
        <span>{Array.from({ length: lines }, () => ')').join('\n')}</span>
      </div>
      <div className="caption-matter">
        <p>
          Case No. <span className="tt">{caseNumber(record)}</span>
        </p>
        <p className="caption-title">JUDGMENT</p>
        <p className="caption-refs">
          Base{' '}
          <span className="tt" title={record.baseRef}>
            {shortSha(record.baseRef)}
          </span>{' '}
          · Head{' '}
          <span className="tt" title={record.headRef}>
            {shortSha(record.headRef)}
          </span>
        </p>
      </div>
    </div>
  );
}

function JudgmentBox({ record }: { record: CaseRecord }) {
  const j = judgment(record);
  const live = j.standing === 'in-session';
  const remedy = record.remedy;
  const canApply = !live && Boolean(remedy && remedy.verified);
  const repro = live
    ? ''
    : convictedChargeIds(record)
        .map((id) => record.charges.find((c) => c.id === id))
        .filter((c): c is Charge => c !== undefined)
        .map((c) => reproCommand(record, c))
        .join('\n\n');
  return (
    <section className={`judgment judgment-${j.standing}`} aria-label="Judgment">
      <p className="judgment-label">Judgment</p>
      <p className="judgment-headline" aria-live={live ? 'polite' : undefined}>
        {j.headline}
      </p>
      <p className="plain">
        <strong>In plain words:</strong> {j.plain}
      </p>
      {(canApply || repro.length > 0) && (
        <div className="actions">
          {canApply && remedy && (
            <CopyButton
              text={applyCommand(remedy.patch)}
              label="Apply the ordered fix"
              copiedLabel="Copied: paste it in a terminal"
              className="btn btn-dark"
              copiedNote="A git apply command for the ordered fix was copied. Paste it in a terminal at the head commit."
              failedNote="Could not copy the fix command"
            />
          )}
          {repro.length > 0 && (
            <CopyButton
              text={repro}
              label="Copy repro command"
              className="btn"
              copiedNote="Repro command copied"
              failedNote="Could not copy the repro command"
            />
          )}
        </div>
      )}
    </section>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="part">
      <h2 className="sec">{title}</h2>
      {children}
    </section>
  );
}

function Charges({ record }: { record: CaseRecord }) {
  if (record.charges.length === 0) {
    return (
      <Part title="I. The Charges">
        <p className="p dim">{isActive(record.status) ? 'No charges have been filed yet.' : 'No charges were filed.'}</p>
      </Part>
    );
  }
  return (
    <Part title="I. The Charges">
      <ol className="counts">
        {record.charges.map((c, i) => {
          const state = chargeOutcome(record, c.id).state;
          const status = state === 'convicted' ? 'PROVEN' : state === 'dismissed' ? 'DISMISSED' : 'PENDING';
          const tone = state === 'convicted' ? 'proven' : state === 'dismissed' ? 'dismissed' : 'pending';
          return (
            <li key={c.id} className={`count count-${tone}`}>
              <strong>{`Count ${i + 1}.`}</strong> {claimText(c)}{' '}
              {state !== 'dismissed' && (
                <>
                  <span className="loc">{location(c)}</span>{' '}
                </>
              )}
              <span className="count-status">{status}</span>
            </li>
          );
        })}
      </ol>
    </Part>
  );
}

function CountEvidence({ record, plan, titled }: { record: CaseRecord; plan: CountExhibits; titled: boolean }) {
  const charge = record.charges.find((c) => c.id === plan.chargeId);
  const evidence = record.evidence.find((e) => e.chargeId === plan.chargeId);
  if (!charge || !evidence) return null;
  const fix = record.remedy ? (record.remedy.witnesses.find((w) => w.chargeId === charge.id)?.outcomes ?? []) : null;
  const rows: RunRow[] = [
    { label: 'Before the change', outcomes: evidence.base },
    { label: 'After the change', outcomes: evidence.head },
  ];
  if (fix) rows.push({ label: 'With the fix', outcomes: fix });
  const before = `${timesWord(evidence.base.length)} on the code before the change`;
  const ran =
    fix && fix.length > 0
      ? `The court ran it ${before}, ${timesWord(evidence.head.length)} after, and ${timesWord(fix.length)} with the fix.`
      : `The court ran it ${before} and ${timesWord(evidence.head.length)} after.`;
  return (
    <div className="count-evidence">
      {titled && <h3 className="sub">{`Count ${plan.count}`}</h3>}
      <p className="p">The prosecution (Nemotron Nano) filed a test as its proof. {ran}</p>
      <RunsExhibit n={plan.runs} rows={rows} />
      <CodeExhibit n={plan.code} title="The proof test, as filed" code={charge.witnessCode} />
      {plan.lines !== null && plan.excerpt && (
        <figure className="exhibit-block">
          <ExhibitLabel n={plan.lines} title={`The line at issue, ${plan.excerpt.path}`} />
          <ExcerptLines lines={plan.excerpt.lines} mode="issue" />
        </figure>
      )}
    </div>
  );
}

function EvidenceSection({ record, plan }: { record: CaseRecord; plan: readonly CountExhibits[] }) {
  const title = `II. The Evidence${plan.length > 0 ? ` on ${countList(plan.map((p) => p.count))}` : ''}`;
  return (
    <Part title={title}>
      {plan.length === 0 && (
        <p className="p dim">
          {isActive(record.status)
            ? 'No count has been proven yet.'
            : 'No count was proven, so the court sets out no evidence.'}
        </p>
      )}
      {plan.map((p) => (
        <CountEvidence key={p.chargeId} record={record} plan={p} titled={plan.length > 1} />
      ))}
    </Part>
  );
}

function DefenseSection({ record, plan }: { record: CaseRecord; plan: readonly CountExhibits[] }) {
  const active = isActive(record.status);
  return (
    <Part title="III. The Defense">
      {plan.length === 0 && (
        <p className="p dim">
          {active ? 'The defense has not been called yet.' : 'No count was proven, so the defense had nothing to answer.'}
        </p>
      )}
      {plan.map((p) => {
        const rebuttal = record.rebuttals.find((r) => r.chargeId === p.chargeId);
        if (!rebuttal) {
          return (
            <p key={p.chargeId} className="p dim">
              {active
                ? `The defense has not answered Count ${p.count} yet.`
                : `Counsel for the change made no answer on Count ${p.count}.`}
            </p>
          );
        }
        return (
          <p key={p.chargeId} className="p">
            Counsel for the change (Nemotron Super) <em>{rebuttal.concedes ? 'conceded' : 'argued'}</em>{' '}
            {rebuttal.concedes ? `Count ${p.count}` : `on Count ${p.count}`}: {afterColon(rebuttal.argument)}
          </p>
        );
      })}
    </Part>
  );
}

function FindingsSection({ record, plan }: { record: CaseRecord; plan: readonly CountExhibits[] }) {
  const paragraphs: ReactNode[] = [];
  for (const p of plan) {
    const outcome = chargeOutcome(record, p.chargeId);
    paragraphs.push(
      outcome.state === 'convicted' ? (
        <p key={p.chargeId} className="p">
          <strong>{`On Count ${p.count}:`}</strong> {afterColon(outcome.reason)}
        </p>
      ) : (
        <p key={p.chargeId} className="p dim">
          <strong>{`On Count ${p.count}:`}</strong> the judge has not ruled yet.
        </p>
      ),
    );
  }
  const withoutTrial: { count: number; text: string }[] = [];
  record.charges.forEach((c, i) => {
    const d = dismissal(record, c.id);
    if (!d) return;
    if (d.kind === 'judge') {
      paragraphs.push(
        <p key={c.id} className="p dim">
          <strong>{`On Count ${i + 1}:`}</strong> dismissed after hearing. {d.text}
        </p>,
      );
    } else {
      withoutTrial.push({ count: i + 1, text: possessive(i + 1, d.text) });
    }
  });
  if (withoutTrial.length > 0) {
    paragraphs.push(
      <p key="without-trial" className="p dim">
        <strong>{`On ${countList(withoutTrial.map((w) => w.count))}:`}</strong> dismissed without trial.{' '}
        {withoutTrial.map((w) => w.text).join(' ')}
      </p>,
    );
  }
  if (paragraphs.length === 0) {
    paragraphs.push(
      <p key="none" className="p dim">
        {record.charges.length === 0 && !isActive(record.status)
          ? 'No charges were filed, so the court makes no findings.'
          : 'The court has made no findings yet.'}
      </p>,
    );
  }
  return <Part title="IV. Findings of the Court">{paragraphs}</Part>;
}

function OrderSection({ record, plan }: { record: CaseRecord; plan: readonly CountExhibits[] }) {
  const order = orderText(record, plan);
  const remedy = record.remedy;
  const files = order.ordered && remedy ? patchExcerpt(remedy.patch) : [];
  const lines: ExcerptLine[] =
    files.length > 1
      ? files.flatMap((f): ExcerptLine[] => [{ kind: 'file', text: f.path }, ...f.lines])
      : files.flatMap((f) => f.lines);
  return (
    <Part title="V. Order">
      <p className="p">{order.text}</p>
      {lines.length > 0 && <ExcerptLines lines={lines} mode="fix" />}
      {!isActive(record.status) && <p className="p so-ordered">So ordered.</p>}
    </Part>
  );
}

function Signature({ record, now }: { record: CaseRecord; now: number }) {
  const entered = record.status === 'closed' ? longDate(record.endedAt) : '';
  const note = entered
    ? `Entered ${entered}`
    : record.status === 'error'
      ? 'Not entered: the case did not finish'
      : 'Not yet entered';
  return (
    <div className="signature">
      <div className="signed">
        <div className="sig-line" aria-hidden="true" />
        <p className="sig-name">Nemotron 3 Ultra, presiding</p>
        <p className="sig-date">{note}</p>
      </div>
      <dl className="costs">
        <dt>Court costs</dt>
        <dd>{formatUsd(caseTotals(record.usage).costUsd)}</dd>
        <dt>Time in court</dt>
        <dd>{formatDuration(elapsedMs(record, now))}</dd>
      </dl>
    </div>
  );
}

export interface CaseViewProps {
  record: CaseRecord;
  // true when the record is a stored run being replayed (demo mode)
  replay?: boolean;
  recordedAt?: string | null;
  onReplay?(): void;
  onSkip?(): void;
  onBack?(): void;
}

export function CaseView({ record, replay = false, recordedAt = null, onReplay, onSkip, onBack }: CaseViewProps) {
  const active = isActive(record.status);
  const now = useNow(active);
  const plan = useMemo(() => planExhibits(record, heardChargeIds(record)), [record]);
  const isReplay = replay || record.mode === 'replay';
  const recorded = longDate(recordedAt ?? record.endedAt ?? record.startedAt);
  const showSkip = Boolean(onSkip) && active;
  const showBar = Boolean(onBack) || isReplay || showSkip || Boolean(onReplay);

  return (
    <div className="case">
      {showBar && (
        <div className="case-bar">
          {onBack && (
            <a className="back-link" href={caseHref(null)} onClick={(e) => followInApp(e, onBack)}>
              ← Back to the docket
            </a>
          )}
          {isReplay && (
            <p className="replay-note">
              {recorded
                ? `Replay. This case was recorded on ${recorded} and is played back here, not run live.`
                : 'Replay. This case is played back from a record, not run live.'}
            </p>
          )}
          {(showSkip || onReplay) && (
            <span className="case-bar-actions">
              {showSkip && onSkip && (
                <button type="button" className="btn" onClick={onSkip}>
                  Skip to the judgment
                </button>
              )}
              {onReplay && (
                <button type="button" className="btn" onClick={onReplay}>
                  Replay from the start
                </button>
              )}
            </span>
          )}
        </div>
      )}
      <article className="filing pleading" aria-label={`Case ${record.title}`}>
        <div className="line-numbers" aria-hidden="true">
          {LINE_NUMBERS}
        </div>
        <h1 className="court-name">The Kacheri Court of Code Review</h1>
        <p className="court-sitting">sitting in review of {repoLabel(record.repoPath)}</p>
        <Caption record={record} />
        {record.error && (
          <p className="case-error" role="alert">
            The court reports an error: {record.error}
          </p>
        )}
        <JudgmentBox record={record} />
        <Charges record={record} />
        <EvidenceSection record={record} plan={plan} />
        <DefenseSection record={record} plan={plan} />
        <FindingsSection record={record} plan={plan} />
        <OrderSection record={record} plan={plan} />
        <Signature record={record} now={now} />
      </article>
    </div>
  );
}
