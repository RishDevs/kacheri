import type { Run, ServerEvent, Task, TaskDetail, Verdict } from '@kacheri/shared';

export interface LogSegment {
  stream: 'stdout' | 'stderr';
  text: string;
}

export interface RunLog {
  segments: LogSegment[];
  size: number;
  truncated: boolean;
}

export interface TaskExtras {
  runs: Run[];
  verdicts: Verdict[];
}

export interface AppState {
  tasks: Record<string, Task>;
  extras: Record<string, TaskExtras>;
  logs: Record<string, RunLog>;
}

export const MAX_LOG_CHARS = 512 * 1024;

export const initialState: AppState = { tasks: {}, extras: {}, logs: {} };

export type Action =
  | { type: 'tasks/loaded'; tasks: Task[] }
  | { type: 'task/upsert'; task: Task }
  | { type: 'detail/loaded'; detail: TaskDetail }
  | { type: 'event'; event: ServerEvent };

function upsertBy<T>(list: T[], item: T, same: (a: T, b: T) => boolean): T[] {
  const idx = list.findIndex((x) => same(x, item));
  if (idx === -1) return [...list, item];
  const next = list.slice();
  next[idx] = item;
  return next;
}

function newer(a: Task | undefined, b: Task): boolean {
  return !a || a.updatedAt <= b.updatedAt;
}

export function appendLog(log: RunLog | undefined, stream: LogSegment['stream'], chunk: string): RunLog {
  const segments = log ? log.segments.slice() : [];
  const last = segments[segments.length - 1];
  if (last && last.stream === stream) {
    segments[segments.length - 1] = { stream, text: last.text + chunk };
  } else {
    segments.push({ stream, text: chunk });
  }
  let size = (log?.size ?? 0) + chunk.length;
  let truncated = log?.truncated ?? false;
  while (size > MAX_LOG_CHARS && segments.length > 0) {
    const first = segments[0];
    const overflow = size - MAX_LOG_CHARS;
    if (first.text.length <= overflow) {
      segments.shift();
      size -= first.text.length;
    } else {
      segments[0] = { stream: first.stream, text: first.text.slice(overflow) };
      size -= overflow;
    }
    truncated = true;
  }
  return { segments, size, truncated };
}

function extrasFor(state: AppState, taskId: string): TaskExtras {
  return state.extras[taskId] ?? { runs: [], verdicts: [] };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'tasks/loaded': {
      const tasks: Record<string, Task> = {};
      for (const t of action.tasks) {
        const existing = state.tasks[t.id];
        tasks[t.id] = newer(existing, t) ? t : existing!;
      }
      return { ...state, tasks };
    }
    case 'task/upsert': {
      if (!newer(state.tasks[action.task.id], action.task)) return state;
      return { ...state, tasks: { ...state.tasks, [action.task.id]: action.task } };
    }
    case 'detail/loaded': {
      const { task, runs, verdicts } = action.detail;
      return {
        ...state,
        tasks: newer(state.tasks[task.id], task) ? { ...state.tasks, [task.id]: task } : state.tasks,
        extras: { ...state.extras, [task.id]: { runs, verdicts } },
      };
    }
    case 'event':
      return applyEvent(state, action.event);
  }
}

export function applyEvent(state: AppState, event: ServerEvent): AppState {
  switch (event.type) {
    case 'task':
      return reducer(state, { type: 'task/upsert', task: event.task });
    case 'run': {
      const cur = extrasFor(state, event.run.taskId);
      const runs = upsertBy(cur.runs, event.run, (a, b) => a.id === b.id);
      return { ...state, extras: { ...state.extras, [event.run.taskId]: { ...cur, runs } } };
    }
    case 'verdict': {
      const cur = extrasFor(state, event.taskId);
      const verdicts = upsertBy(cur.verdicts, event.verdict, (a, b) => a.reviewer === b.reviewer);
      return { ...state, extras: { ...state.extras, [event.taskId]: { ...cur, verdicts } } };
    }
    case 'log':
      return {
        ...state,
        logs: { ...state.logs, [event.runId]: appendLog(state.logs[event.runId], event.stream, event.chunk) },
      };
  }
}
