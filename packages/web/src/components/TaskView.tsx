import { useEffect, useState } from 'react';
import type { MergeResult, Run, Task, TaskDiff, TaskStatus, Verdict } from '@kacheri/shared';
import type { KacheriApi } from '../api';
import type { RunLog } from '../state';
import { STATUS_LABEL } from './Board';
import { DiffViewer } from './DiffViewer';
import { LogView } from './LogView';

export interface TaskViewProps {
  api: KacheriApi;
  task: Task;
  runs: Run[];
  verdicts: Verdict[];
  logs: Record<string, RunLog>;
  onTask(task: Task): void;
}

type Action = 'start' | 'review' | 'merge' | 'reject';

const ACTIVE: readonly TaskStatus[] = ['running', 'reviewing'];
const TERMINAL: readonly TaskStatus[] = ['merged', 'rejected'];

export function availableActions(task: Task): Record<Action, boolean> {
  const busy = ACTIVE.includes(task.status);
  const done = TERMINAL.includes(task.status);
  return {
    start: task.status === 'queued',
    review: task.branch !== null && !busy && !done && task.status !== 'queued',
    merge: task.status === 'ready',
    reject: !done && !busy,
  };
}

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}

function describeMerge(result: MergeResult): string {
  return result.ok ? `Merged as ${result.commit.slice(0, 10)}.` : `Merge refused (${result.reason}): ${result.detail}`;
}

export function TaskView({ api, task, runs, verdicts, logs, onTask }: TaskViewProps) {
  const [pending, setPending] = useState<Action | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [diff, setDiff] = useState<TaskDiff | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);

  useEffect(() => {
    setMessage(null);
    setDiff(null);
    setDiffError(null);
  }, [task.id]);

  useEffect(() => {
    if (!task.branch) return;
    let cancelled = false;
    api.getDiff(task.id).then(
      (d) => {
        if (!cancelled) {
          setDiff(d);
          setDiffError(null);
        }
      },
      (err: Error) => {
        if (!cancelled) setDiffError(err.message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, task.id, task.branch, task.status]);

  async function run(action: Action) {
    setPending(action);
    setMessage(null);
    try {
      if (action === 'merge') {
        const result = await api.mergeTask(task.id);
        setMessage({ kind: result.ok ? 'info' : 'error', text: describeMerge(result) });
      } else {
        const call = { start: api.startTask, review: api.reviewTask, reject: api.rejectTask }[action];
        onTask(await call(task.id));
      }
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setPending(null);
    }
  }

  const can = availableActions(task);
  const sortedRuns = runs.slice().sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  return (
    <article className="task-view" aria-label={`Task ${task.title}`}>
      <header className="task-head">
        <div>
          <h2>{task.title}</h2>
          <p className="muted">
            <code>{task.id}</code> · <span className={`badge status-${task.status}`}>{STATUS_LABEL[task.status]}</span> ·
            author {task.agent} · reviewers {task.reviewers.join(', ') || '—'}
            {task.branch && (
              <>
                {' '}
                · branch <code>{task.branch}</code>
              </>
            )}
          </p>
        </div>
        <div className="actions">
          <button type="button" disabled={!can.start || pending !== null} onClick={() => run('start')}>
            {pending === 'start' ? 'Starting…' : 'Start'}
          </button>
          <button type="button" disabled={!can.review || pending !== null} onClick={() => run('review')}>
            {pending === 'review' ? 'Requesting…' : 'Review'}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!can.merge || pending !== null}
            onClick={() => run('merge')}
          >
            {pending === 'merge' ? 'Merging…' : 'Merge'}
          </button>
          <button
            type="button"
            className="danger"
            disabled={!can.reject || pending !== null}
            onClick={() => run('reject')}
          >
            {pending === 'reject' ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      </header>

      {message && (
        <p className={message.kind} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
      {task.error && (
        <p className="error" role="alert">
          {task.error}
        </p>
      )}

      <details className="prompt">
        <summary>Prompt and owned paths</summary>
        <pre>{task.prompt}</pre>
        <ul>
          {task.ownedPaths.map((p) => (
            <li key={p}>
              <code>{p}</code>
            </li>
          ))}
        </ul>
      </details>

      <section aria-label="Verdicts">
        <h3>Verdicts</h3>
        {verdicts.length === 0 ? (
          <p className="muted">No verdicts yet.</p>
        ) : (
          <ul className="verdicts">
            {verdicts.map((v) => (
              <li key={v.reviewer} className={`verdict verdict-${v.status.toLowerCase()}`}>
                <strong>{v.status}</strong> · {v.reviewer} · {v.findings.length} finding
                {v.findings.length === 1 ? '' : 's'}
                <div>{v.summary}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Runs">
        <h3>Runs</h3>
        {sortedRuns.length === 0 ? (
          <p className="muted">No runs yet.</p>
        ) : (
          sortedRuns.map((r) => (
            <details key={r.id} className={`run run-${r.status}`} open={r.status === 'running'}>
              <summary>
                {r.kind} · {r.agent} · {r.status}
                {r.exitCode !== null && ` (exit ${r.exitCode})`} · {formatTime(r.startedAt)}
                {r.endedAt && ` – ${formatTime(r.endedAt)}`}
              </summary>
              <LogView log={logs[r.id]} />
            </details>
          ))
        )}
      </section>

      <section aria-label="Diff">
        <h3>Diff</h3>
        {!task.branch && <p className="muted">No worktree yet.</p>}
        {diffError && (
          <p className="error" role="alert">
            {diffError}
          </p>
        )}
        {diff && <DiffViewer diff={diff} verdicts={verdicts} />}
      </section>
    </article>
  );
}
