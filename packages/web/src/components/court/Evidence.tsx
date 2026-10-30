import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Evidence, WitnessOutcome } from '@kacheri/shared';
import { OUTCOME_LABEL, hasRunFault, runSummary } from '../../court/summary';

export type RunSide = 'base' | 'head';

export interface LogTarget {
  chargeId: string;
  side: RunSide;
  run: number; // 0-based
}

const SIDE_LABEL: Record<RunSide, string> = { base: 'BASE', head: 'HEAD' };

function RegisterRow({
  side,
  outcomes,
  runs,
  onOpen,
}: {
  side: RunSide;
  outcomes: WitnessOutcome[];
  runs: number;
  onOpen(side: RunSide, run: number): void;
}) {
  return (
    <tr aria-label={`${side} runs`}>
      <th scope="row" className={`reg-side${hasRunFault(outcomes) ? ' reg-side-fault' : ''}`}>
        {SIDE_LABEL[side]}
      </th>
      {Array.from({ length: runs }, (_, i) => {
        const o = outcomes[i];
        return (
          <td key={i} className="reg-cell">
            {o === undefined ? (
              <span className="muted">—</span>
            ) : (
              <button
                type="button"
                className={`reg-run run-${o}`}
                aria-label={`${side} run ${i + 1}: ${OUTCOME_LABEL[o]}, open log`}
                onClick={() => onOpen(side, i)}
              >
                {OUTCOME_LABEL[o]}
              </button>
            )}
          </td>
        );
      })}
      <td className="reg-total">{runSummary(outcomes)}</td>
    </tr>
  );
}

export function EvidenceRegister({
  evidence,
  showVerdict = true,
  onOpenLog,
}: {
  evidence: Evidence;
  showVerdict?: boolean;
  onOpenLog(target: LogTarget): void;
}) {
  const runs = Math.max(evidence.base.length, evidence.head.length);
  const open = (side: RunSide, run: number) => onOpenLog({ chargeId: evidence.chargeId, side, run });
  return (
    <table className="register" aria-label="Evidence register">
      <thead>
        <tr>
          <th scope="col">
            <span className="sr-only">Tree</span>
          </th>
          {Array.from({ length: runs }, (_, i) => (
            <th key={i} scope="col">
              run {i + 1}
            </th>
          ))}
          <th scope="col">
            <span className="sr-only">Total</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <RegisterRow side="base" outcomes={evidence.base} runs={runs} onOpen={open} />
        <RegisterRow side="head" outcomes={evidence.head} runs={runs} onOpen={open} />
      </tbody>
      {showVerdict && (
        <tfoot>
          <tr>
            <th scope="row" className={evidence.admissible ? 'reg-admissible' : 'reg-inadmissible'}>
              {evidence.admissible ? 'Admissible' : 'Inadmissible'}
            </th>
            <td colSpan={runs + 1} className="reg-reason">
              {evidence.reason}
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

export interface DrawerOutcome {
  className: string;
  text: string;
}

export function Drawer({
  title,
  outcome,
  onClose,
  children,
}: {
  title: string;
  outcome: DrawerOutcome | null;
  onClose(): void;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside className="log-drawer" role="dialog" aria-modal="false" aria-label={`Log: ${title}`}>
      <header className="drawer-head">
        <span className="label">Raw log</span>
        <code>{title}</code>
        {outcome && <span className={`${outcome.className} drawer-outcome`}>{outcome.text}</span>}
        <button type="button" ref={closeRef} className="drawer-close" onClick={onClose}>
          Close
        </button>
      </header>
      {children}
    </aside>
  );
}

export function LogDrawer({
  target,
  evidence,
  onClose,
}: {
  target: LogTarget;
  evidence: Evidence | undefined;
  onClose(): void;
}) {
  const outcomes = evidence ? evidence[target.side] : [];
  const outcome = outcomes[target.run];
  const lastHead = evidence ? evidence.head.length - 1 : -1;
  const recorded = target.side === 'head' && target.run === lastHead;
  const title = `${target.chargeId} · ${target.side} run ${target.run + 1}`;

  return (
    <Drawer
      title={title}
      outcome={outcome ? { className: `run-${outcome}`, text: OUTCOME_LABEL[outcome] } : null}
      onClose={onClose}
    >
      {!evidence ? (
        <p className="muted">No evidence recorded for this charge.</p>
      ) : recorded ? (
        <pre className="log">{evidence.headLog || '(empty output)'}</pre>
      ) : (
        <>
          <p className="muted drawer-note">
            No log recorded for this run. The court keeps the output of the last head run only.
          </p>
          {evidence.headLog && lastHead >= 0 && (
            <>
              <p className="label">head run {lastHead + 1}</p>
              <pre className="log">{evidence.headLog}</pre>
            </>
          )}
        </>
      )}
    </Drawer>
  );
}

type CopyState = 'idle' | 'copied' | 'failed';

export function CopyButton({
  text,
  label,
  className,
  copiedNote,
  failedNote,
}: {
  text: string;
  label: string;
  className: string;
  copiedNote: string;
  failedNote: string;
}) {
  const [state, setState] = useState<CopyState>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(t);
  }, [state]);

  async function copy() {
    try {
      const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
      if (!clip) throw new Error('clipboard unavailable');
      await clip.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={() => void copy()}>
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
      </button>
      <span className="sr-only" aria-live="polite">
        {state === 'copied' ? copiedNote : state === 'failed' ? failedNote : ''}
      </span>
    </>
  );
}

export function ReproStrip({ command, preview }: { command: string; preview: string }) {
  return (
    <div className="repro-strip">
      <code className="repro-preview" title={command}>
        {preview}
      </code>
      <CopyButton
        text={command}
        label="Copy repro"
        className="repro-copy"
        copiedNote="Repro command copied"
        failedNote="Could not copy the repro command"
      />
    </div>
  );
}
