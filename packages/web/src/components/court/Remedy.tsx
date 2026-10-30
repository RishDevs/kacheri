import { useMemo } from 'react';
import type { CaseRecord, Remedy, Verdict, WitnessOutcome } from '@kacheri/shared';
import { patchToDiff } from '../../diff';
import { OUTCOME_LABEL, SUITE_LABEL, convictedChargeIds, hasRunFault, runSummary } from '../../court/summary';
import { DiffViewer } from '../DiffViewer';
import { CopyButton, Drawer } from './Evidence';

const NO_VERDICTS: Verdict[] = [];
const MIN_RUNS = 3;
const FIX_REF = 'head+fix';

function FixRow({ chargeId, outcomes, runs }: { chargeId: string; outcomes: WitnessOutcome[]; runs: number }) {
  return (
    <tr aria-label={`${chargeId} ${FIX_REF} runs`}>
      <th scope="row" className={`reg-side${hasRunFault(outcomes) ? ' reg-side-fault' : ''}`}>
        <span className="reg-charge">{chargeId}</span> HEAD+FIX
      </th>
      {Array.from({ length: runs }, (_, i) => {
        const o = outcomes[i];
        return (
          <td key={i} className="reg-cell">
            {o === undefined ? <span className="muted">—</span> : <span className={`run-${o}`}>{OUTCOME_LABEL[o]}</span>}
          </td>
        );
      })}
      <td className="reg-total">{runSummary(outcomes)}</td>
    </tr>
  );
}

export function RemedySection({
  record,
  remedy,
  onOpenSuiteLog,
}: {
  record: CaseRecord;
  remedy: Remedy;
  onOpenSuiteLog(): void;
}) {
  const diff = useMemo(() => patchToDiff(remedy.patch, record.headRef, FIX_REF), [remedy.patch, record.headRef]);
  const convicted = convictedChargeIds(record);
  const chargeIds = convicted.length > 0 ? convicted : remedy.chargeIds;
  const rows = chargeIds.map((id) => ({
    chargeId: id,
    outcomes: remedy.witnesses.find((w) => w.chargeId === id)?.outcomes ?? [],
  }));
  const runs = Math.max(MIN_RUNS, ...rows.map((r) => r.outcomes.length));

  return (
    <section className="remedy" aria-label="Remedy">
      <header className="remedy-head">
        <h3 className="remedy-title">Remedy</h3>
        <span className={`remedy-status ${remedy.verified ? 'remedy-verified' : 'remedy-unverified'}`}>
          {remedy.verified ? 'Verified' : 'Not verified'}
        </span>
        <span className="remedy-attempts">
          {remedy.attempts} attempt{remedy.attempts === 1 ? '' : 's'}
        </span>
      </header>
      <p className="remedy-explanation">{remedy.explanation}</p>

      <table className="register" aria-label="Remedy register">
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
          {rows.map((r) => (
            <FixRow key={r.chargeId} chargeId={r.chargeId} outcomes={r.outcomes} runs={runs} />
          ))}
        </tbody>
      </table>

      <p className="remedy-suite">
        <span className="label">Existing suite</span>
        <span className={`suite-${remedy.suite}`}>{SUITE_LABEL[remedy.suite]}</span>
        <button type="button" className="mini-button" onClick={onOpenSuiteLog}>
          View log
        </button>
      </p>

      <div className="remedy-patch">
        <div className="remedy-patch-head">
          <span className="label">Fix patch</span>
          <CopyButton
            text={remedy.patch}
            label="Copy patch"
            className="mini-button"
            copiedNote="Fix patch copied"
            failedNote="Could not copy the fix patch"
          />
        </div>
        <DiffViewer diff={diff} verdicts={NO_VERDICTS} />
      </div>
    </section>
  );
}

export function SuiteLogDrawer({ remedy, onClose }: { remedy: Remedy; onClose(): void }) {
  return (
    <Drawer
      title={`existing suite · ${FIX_REF}`}
      outcome={{ className: `suite-${remedy.suite}`, text: SUITE_LABEL[remedy.suite] }}
      onClose={onClose}
    >
      {remedy.suiteLog ? (
        <pre className="log">{remedy.suiteLog}</pre>
      ) : (
        <p className="muted drawer-note">
          {remedy.suite === 'not_run' ? 'The existing suite was not run on head+fix.' : '(empty output)'}
        </p>
      )}
    </Drawer>
  );
}
