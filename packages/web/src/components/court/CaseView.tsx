import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MODELS } from '@kacheri/shared';
import type { CaseRecord, CaseStatus, Charge, Evidence, Rebuttal, Verdict } from '@kacheri/shared';
import { anchorKey, locateLine, parsePatch, patchToDiff } from '../../diff';
import { reproCommand } from '../../court/repro';
import {
  STATUS_TEXT,
  TIERS,
  TIER_LABEL,
  caseExtras,
  caseTally,
  caseTotals,
  chargeOutcome,
  elapsedMs,
  formatDuration,
  formatTokens,
  formatUsd,
  isActive,
  isFixVerified,
  isoDate,
  modelLineage,
  shortSha,
  type ChargeOutcome,
} from '../../court/summary';
import { DiffViewer, type DiffMarker } from '../DiffViewer';
import { EvidenceRegister, LogDrawer, ReproStrip, type LogTarget } from './Evidence';
import { RemedySection, SuiteLogDrawer } from './Remedy';

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

function Pending({ active, text }: { active: boolean; text: string }) {
  return active ? <p className="pending">{text}</p> : <p className="muted cell-empty">—</p>;
}

// Captures `animate` at mount: the stamp animates only when a conviction arrives while the case is on screen.
function Stamp({ animate }: { animate: boolean }) {
  const [arrive] = useState(animate);
  return <strong className={`stamp${arrive ? ' stamp-arrive' : ''}`}>Convicted</strong>;
}

function VerdictMark({ outcome, animate }: { outcome: ChargeOutcome; animate: boolean }) {
  if (outcome.state === 'convicted') return <Stamp animate={animate} />;
  if (outcome.state === 'dismissed') return <span className="verdict-mark">Dismissed</span>;
  return null;
}

function DefenseBody({
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
      <>
        <span className={`defense-mark ${rebuttal.concedes ? 'defense-concedes' : 'defense-contests'}`}>
          {rebuttal.concedes ? 'Concedes' : 'Contests'}
        </span>
        <p className="argument">{rebuttal.argument}</p>
      </>
    );
  }
  if (evidence && !evidence.admissible) return <p className="muted">Not heard: evidence inadmissible.</p>;
  return <Pending active={active} text={evidence ? 'Defense is preparing…' : 'Awaiting evidence'} />;
}

function RulingBody({ outcome, active }: { outcome: ChargeOutcome; active: boolean }) {
  if (outcome.state === 'pending') return <Pending active={active} text="Awaiting ruling" />;
  return <blockquote className="ruling-reason">{outcome.reason}</blockquote>;
}

function Part({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="charge-part">
      <h4 className="part-label">{label}</h4>
      <div className="part-body">{children}</div>
    </div>
  );
}

interface ChargeSectionProps {
  record: CaseRecord;
  charge: Charge;
  focused: boolean;
  anchored: boolean;
  live: boolean;
  animateStamp: boolean;
  fixVerified: boolean;
  onLocate(chargeId: string): void;
  onOpenLog(target: LogTarget): void;
}

function ChargeSection({
  record,
  charge,
  focused,
  anchored,
  live,
  animateStamp,
  fixVerified,
  onLocate,
  onOpenLog,
}: ChargeSectionProps) {
  const evidence = record.evidence.find((e) => e.chargeId === charge.id);
  const rebuttal = record.rebuttals.find((r) => r.chargeId === charge.id);
  const outcome = chargeOutcome(record, charge.id);
  const inadmissible = evidence !== undefined && !evidence.admissible;
  const location = charge.line === null ? charge.file : `${charge.file}:${charge.line}`;

  const witness = (
    <div className="witness-block">
      <details className="witness">
        <summary>
          Witness <code>{charge.witnessPath}</code>
        </summary>
        <pre className="code-block">{charge.witnessCode}</pre>
      </details>
      <ReproStrip
        command={reproCommand(record, charge)}
        preview={`git checkout --detach ${shortSha(record.headRef)} && node --test ${charge.witnessPath}`}
      />
    </div>
  );
  const defense = (
    <Part label="Defense">
      <DefenseBody rebuttal={rebuttal} evidence={evidence} active={live} />
    </Part>
  );
  const ruling = (
    <Part label="Ruling">
      <RulingBody outcome={outcome} active={live} />
    </Part>
  );

  return (
    <section
      role="group"
      aria-label={`Charge ${charge.id}`}
      data-charge-anchor={charge.id}
      className={`charge outcome-${outcome.state}${inadmissible ? ' charge-inadmissible' : ''}${focused ? ' charge-active' : ''}`}
    >
      <header className="charge-head">
        <span className="charge-id">{charge.id}</span>
        <span className={`sev sev-${charge.severity}`}>{charge.severity}</span>
        {anchored ? (
          <button
            type="button"
            className="loc-link"
            title="Show in diff"
            aria-pressed={focused}
            onClick={() => onLocate(charge.id)}
          >
            {location}
          </button>
        ) : (
          <code className="loc">{location}</code>
        )}
        <span className="charge-verdict">
          <VerdictMark outcome={outcome} animate={animateStamp} />
          {fixVerified && <span className="fix-mark">Fix verified</span>}
        </span>
      </header>
      <h3 className="claim">{charge.claim}</h3>

      {inadmissible && evidence ? (
        <details className="inadmissible-line">
          <summary>
            <span className="adm-label">Inadmissible</span> <span className="adm-reason">{evidence.reason}</span>
          </summary>
          <div className="inadmissible-body">
            <EvidenceRegister evidence={evidence} showVerdict={false} onOpenLog={onOpenLog} />
            {witness}
            {defense}
            {ruling}
          </div>
        </details>
      ) : (
        <>
          <Part label="Evidence">
            {evidence ? (
              <EvidenceRegister evidence={evidence} onOpenLog={onOpenLog} />
            ) : (
              <Pending active={live} text="Running witness on base and head…" />
            )}
          </Part>
          {witness}
          {defense}
          {ruling}
        </>
      )}
    </section>
  );
}

type FocusSource = 'docket' | 'diff';

interface Focus {
  chargeId: string;
  from: FocusSource;
  anchor: string | null;
}

const NO_VERDICTS: Verdict[] = [];

function findByData(root: HTMLElement | null, key: 'anchor' | 'chargeAnchor', value: string): HTMLElement | null {
  if (!root) return null;
  const selector = key === 'anchor' ? '[data-anchor]' : '[data-charge-anchor]';
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
    if (el.dataset[key] === value) return el;
  }
  return null;
}

export interface CaseViewProps {
  record: CaseRecord;
  // true when the record is a stored run being replayed (demo mode)
  replay?: boolean;
  recordedAt?: string | null;
  onReplay?(): void;
  onSkip?(): void;
}

export function CaseView({ record, replay = false, recordedAt = null, onReplay, onSkip }: CaseViewProps) {
  const active = isActive(record.status);
  const now = useNow(active);
  const totals = useMemo(() => caseTotals(record.usage), [record.usage]);
  const tally = caseTally(record);
  const { patch, description } = caseExtras(record);
  const diff = useMemo(
    () => (patch ? patchToDiff(patch, record.baseRef, record.headRef) : null),
    [patch, record.baseRef, record.headRef],
  );
  const files = useMemo(() => (patch ? parsePatch(patch) : []), [patch]);

  const anchors = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of record.charges) {
      const loc = locateLine(files, c.file, c.line);
      if (loc) map.set(c.id, anchorKey(loc.path, loc.line));
    }
    return map;
  }, [files, record.charges]);

  const markers = useMemo<DiffMarker[]>(
    () =>
      record.charges
        .filter((c) => anchors.has(c.id))
        .map((c) => {
          const state = chargeOutcome(record, c.id).state;
          return { id: c.id, file: c.file, line: c.line, label: c.id, tone: state, title: `${c.id} · ${state} · ${c.claim}` };
        }),
    [record, anchors],
  );

  // A fresh object per click, so repeated clicks on the same charge scroll again.
  const [focus, setFocus] = useState<Focus | null>(null);
  const locate = useCallback(
    (chargeId: string, from: FocusSource) => setFocus({ chargeId, from, anchor: anchors.get(chargeId) ?? null }),
    [anchors],
  );
  const locateFromDocket = useCallback((id: string) => locate(id, 'docket'), [locate]);
  const locateFromDiff = useCallback((id: string) => locate(id, 'diff'), [locate]);

  const docketRef = useRef<HTMLElement>(null);
  const diffRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focus) return;
    const target =
      focus.from === 'docket'
        ? focus.anchor === null
          ? null
          : findByData(diffRef.current, 'anchor', focus.anchor)
        : findByData(docketRef.current, 'chargeAnchor', focus.chargeId);
    if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'center' });
  }, [focus]);

  const [log, setLog] = useState<LogTarget | 'suite' | null>(null);
  const closeLog = useCallback(() => setLog(null), []);
  const openSuiteLog = useCallback(() => setLog('suite'), []);
  const lineage = useMemo(() => modelLineage(record), [record]);

  const [settled, setSettled] = useState(false);
  useEffect(() => setSettled(true), []);

  const articleRef = useRef<HTMLElement>(null);
  const teleRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const root = articleRef.current;
    const head = teleRef.current;
    if (!root || !head) return;
    const apply = () => root.style.setProperty('--tele-h', `${head.offsetHeight}px`);
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(apply);
    ro.observe(head);
    return () => ro.disconnect();
  }, []);

  const isReplay = replay || record.mode === 'replay';
  const recorded = recordedAt ?? record.endedAt ?? record.startedAt;
  const recordedDate = isoDate(recorded);

  return (
    <article ref={articleRef} className="case-view" aria-label={`Case ${record.title}`}>
      <header ref={teleRef} className="telemetry">
        <div className="tele-main">
          <div className="tele-title">
            <p className="label tele-kicker">
              Case <code>{record.id}</code> · <CaseStatusBadge status={record.status} />
            </p>
            <h2 className="case-title">{record.title}</h2>
            <p className="tele-refs">
              <code className="muted">{record.repoPath}</code>{' '}
              <span className="shas">
                <code title={`base ${record.baseRef}`}>{shortSha(record.baseRef)}</code>
                <span className="muted">..</span>
                <code title={`head ${record.headRef}`}>{shortSha(record.headRef)}</code>
              </span>
            </p>
            {isReplay && (
              <p className="replay-label">
                Replay of recorded Token Factory run
                {recordedDate && (
                  <>
                    {' '}
                    · recorded on <time dateTime={recorded}>{recordedDate}</time>
                  </>
                )}
              </p>
            )}
          </div>
          <dl className="ledger" aria-label="Case meters">
            <div className="ledger-item ledger-lineage">
              <dt>Models</dt>
              <dd>
                <span aria-label="Model lineage">
                  {lineage.map((m, i) => (
                    <Fragment key={m.key}>
                      {i > 0 && ' → '}
                      <abbr title={MODELS[m.tier].id}>{m.label}</abbr>
                    </Fragment>
                  ))}
                </span>
              </dd>
            </div>
            {TIERS.map((t) => {
              const tk = totals.tokens[t];
              return (
                <div
                  key={t}
                  className="ledger-item"
                  title={`${MODELS[t].id} · ${tk.calls} call(s) · ${tk.prompt} prompt / ${tk.completion} completion tokens`}
                >
                  <dt>{TIER_LABEL[t]}</dt>
                  <dd>{formatTokens(tk.prompt + tk.completion)} tok</dd>
                </div>
              );
            })}
            <div className="ledger-item">
              <dt>Cost</dt>
              <dd>{formatUsd(totals.costUsd)}</dd>
            </div>
            <div className="ledger-item">
              <dt>Elapsed</dt>
              <dd>{formatDuration(elapsedMs(record, now))}</dd>
            </div>
          </dl>
        </div>
        <div className="tele-bar">
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
      </header>

      {record.error && (
        <p className="error case-error" role="alert">
          {record.error}
        </p>
      )}

      <div className="workbench">
        <section ref={docketRef} className="docket" aria-label="Docket">
          {description && (
            <details className="pr-description">
              <summary>PR description</summary>
              <p>{description}</p>
            </details>
          )}
          <h3 className="pane-label">
            Charges <span className="count">{record.charges.length}</span>
          </h3>
          {record.charges.length === 0 &&
            (active ? (
              <Pending active text="The prosecutor is reading the diff…" />
            ) : (
              <p className="muted">No charges filed.</p>
            ))}
          <ol className="charges">
            {record.charges.map((charge) => (
              <li key={charge.id}>
                <ChargeSection
                  record={record}
                  charge={charge}
                  focused={focus?.chargeId === charge.id}
                  anchored={anchors.has(charge.id)}
                  live={active}
                  animateStamp={settled}
                  fixVerified={isFixVerified(record, charge.id)}
                  onLocate={locateFromDocket}
                  onOpenLog={setLog}
                />
              </li>
            ))}
          </ol>
          {record.remedy && <RemedySection record={record} remedy={record.remedy} onOpenSuiteLog={openSuiteLog} />}
        </section>

        <section ref={diffRef} className="diff-pane" aria-label="Diff">
          <h3 className="pane-label">
            Diff
            {diff && (
              <span className="muted">
                {' '}
                · {diff.files.length} file{diff.files.length === 1 ? '' : 's'}
              </span>
            )}
          </h3>
          {diff ? (
            <DiffViewer
              diff={diff}
              verdicts={NO_VERDICTS}
              markers={markers}
              activeMarkerId={focus?.chargeId ?? null}
              onMarkerClick={locateFromDiff}
            />
          ) : (
            <p className="muted">This case record carries no patch, so the diff is unavailable.</p>
          )}
        </section>
      </div>

      {log === 'suite'
        ? record.remedy && <SuiteLogDrawer remedy={record.remedy} onClose={closeLog} />
        : log && (
            <LogDrawer target={log} evidence={record.evidence.find((e) => e.chargeId === log.chargeId)} onClose={closeLog} />
          )}
    </article>
  );
}
