import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import type { CreateTaskInput, Task } from '@kacheri/shared';
import type { KacheriApi } from './api';
import { initialState, reducer } from './state';
import { Board } from './components/Board';
import { CreateTaskForm } from './components/CreateTaskForm';
import { TaskView } from './components/TaskView';

type Connection = 'connecting' | 'live' | 'offline';

function readHash(): string | null {
  if (typeof window === 'undefined') return null;
  const m = /^#\/tasks\/([^/]+)$/.exec(window.location.hash);
  return m ? decodeURIComponent(m[1]) : null;
}

export function App({ api }: { api: KacheriApi }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [selectedId, setSelectedId] = useState<string | null>(readHash);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [error, setError] = useState<string | null>(null);

  const loadTasks = useCallback(() => {
    api.listTasks().then(
      (tasks) => {
        dispatch({ type: 'tasks/loaded', tasks });
        setError(null);
      },
      (err: Error) => setError(err.message),
    );
  }, [api]);

  useEffect(() => {
    loadTasks();
    let dropped = false;
    const sub = api.subscribe({
      onEvent: (event) => dispatch({ type: 'event', event }),
      onOpen: () => {
        setConnection('live');
        if (dropped) loadTasks();
        dropped = false;
      },
      onError: () => {
        setConnection('offline');
        dropped = true;
      },
    });
    return () => sub.close();
  }, [api, loadTasks]);

  useEffect(() => {
    const onHash = () => setSelectedId(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    api.getTask(selectedId).then(
      (detail) => {
        if (!cancelled) dispatch({ type: 'detail/loaded', detail });
      },
      (err: Error) => {
        if (!cancelled) setError(err.message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, selectedId]);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    const hash = id ? `#/tasks/${encodeURIComponent(id)}` : '';
    if (window.location.hash !== hash) {
      window.history.replaceState(null, '', hash || window.location.pathname + window.location.search);
    }
  }, []);

  const onTask = useCallback((task: Task) => dispatch({ type: 'task/upsert', task }), []);

  const createTask = useCallback(
    async (input: CreateTaskInput) => {
      const task = await api.createTask(input);
      onTask(task);
      select(task.id);
      return task;
    },
    [api, onTask, select],
  );

  const tasks = useMemo(() => Object.values(state.tasks), [state.tasks]);
  const selected = selectedId ? state.tasks[selectedId] : undefined;
  const extras = selectedId ? state.extras[selectedId] : undefined;

  return (
    <div className="app">
      <header className="app-head">
        <h1>Kacheri</h1>
        <span className={`conn conn-${connection}`} role="status">
          {connection === 'live' ? 'Live' : connection === 'offline' ? 'Disconnected — retrying' : 'Connecting…'}
        </span>
      </header>
      {error && (
        <p className="error banner" role="alert">
          {error}
        </p>
      )}
      <main className="layout">
        <aside className="sidebar">
          <CreateTaskForm onSubmit={createTask} />
        </aside>
        <div className="content">
          <Board tasks={tasks} selectedId={selectedId} onSelect={select} />
          {selected ? (
            <>
              <button type="button" className="link" onClick={() => select(null)}>
                Close task
              </button>
              <TaskView
                api={api}
                task={selected}
                runs={extras?.runs ?? []}
                verdicts={extras?.verdicts ?? []}
                logs={state.logs}
                onTask={onTask}
              />
            </>
          ) : (
            selectedId && <p className="muted">Loading task…</p>
          )}
        </div>
      </main>
    </div>
  );
}
