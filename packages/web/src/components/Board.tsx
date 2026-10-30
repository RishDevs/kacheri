import type { Task, TaskStatus } from '@kacheri/shared';

export const STATUS_ORDER: readonly TaskStatus[] = [
  'queued',
  'running',
  'reviewing',
  'ready',
  'changes_requested',
  'merged',
  'rejected',
  'failed',
];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  reviewing: 'Reviewing',
  ready: 'Ready',
  changes_requested: 'Changes requested',
  merged: 'Merged',
  rejected: 'Rejected',
  failed: 'Failed',
};

export function groupByStatus(tasks: Task[]): Record<TaskStatus, Task[]> {
  const groups = Object.fromEntries(STATUS_ORDER.map((s) => [s, [] as Task[]])) as Record<TaskStatus, Task[]>;
  for (const t of tasks) (groups[t.status] ?? groups.failed).push(t);
  for (const s of STATUS_ORDER) groups[s].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return groups;
}

export interface BoardProps {
  tasks: Task[];
  selectedId: string | null;
  onSelect(id: string): void;
}

export function Board({ tasks, selectedId, onSelect }: BoardProps) {
  const groups = groupByStatus(tasks);
  return (
    <div className="board" role="list" aria-label="Task board">
      {STATUS_ORDER.map((status) => (
        <section key={status} className={`column status-${status}`} role="listitem" aria-label={STATUS_LABEL[status]}>
          <h3 className="column-title">
            {STATUS_LABEL[status]} <span className="count">{groups[status].length}</span>
          </h3>
          <ul className="cards">
            {groups[status].map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  className={`card${task.id === selectedId ? ' selected' : ''}`}
                  aria-pressed={task.id === selectedId}
                  onClick={() => onSelect(task.id)}
                >
                  <span className="card-title">{task.title}</span>
                  <span className="card-meta">
                    {task.agent}
                    {task.reviewers.length > 0 && <> → {task.reviewers.join(', ')}</>}
                  </span>
                  {task.error && <span className="card-error">{task.error}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
