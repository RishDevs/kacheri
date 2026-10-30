// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CreateTaskInput, ServerEvent, Task } from '@kacheri/shared';
import type { EventHandlers, KacheriApi } from '../src/api';
import { App } from '../src/App';
import { CreateTaskForm, parseOwnedPaths, validateTaskInput } from '../src/components/CreateTaskForm';
import { availableActions, TaskView } from '../src/components/TaskView';
import { DIFF, VERDICTS, makeTask } from './fixtures';

afterEach(cleanup);

function fakeApi(initial: Task[] = []) {
  let handlers: EventHandlers | null = null;
  const store = new Map(initial.map((t) => [t.id, t]));
  const update = (id: string, patch: Partial<Task>): Task => {
    const next = { ...(store.get(id) ?? makeTask({ id })), ...patch, updatedAt: '2026-10-30T07:05:00.000Z' };
    store.set(id, next);
    return next;
  };
  const api = {
    listTasks: vi.fn(async () => [...store.values()]),
    createTask: vi.fn(async (input: CreateTaskInput) => {
      const task = makeTask({ id: 't_new', ...input });
      store.set(task.id, task);
      return task;
    }),
    getTask: vi.fn(async (id: string) => ({ task: store.get(id) ?? makeTask({ id }), runs: [], verdicts: [] })),
    startTask: vi.fn(async (id: string) => update(id, { status: 'running', branch: `kacheri/${id}` })),
    reviewTask: vi.fn(async (id: string) => update(id, { status: 'reviewing' })),
    mergeTask: vi.fn(async () => ({ ok: false as const, reason: 'tests_failed' as const, detail: 'npm test exited 1' })),
    rejectTask: vi.fn(async (id: string) => update(id, { status: 'rejected' })),
    getDiff: vi.fn(async () => DIFF),
    subscribe: vi.fn((h: EventHandlers) => {
      handlers = h;
      return { close: vi.fn() };
    }),
  } satisfies KacheriApi;
  const emit = (event: ServerEvent) => act(() => handlers!.onEvent(event));
  const open = () => act(() => handlers!.onOpen?.());
  return { api, emit, open };
}

describe('CreateTaskForm', () => {
  it('parses owned paths and validates input', () => {
    expect(parseOwnedPaths(' a/** \n\nb/*, c ')).toEqual(['a/**', 'b/*', 'c']);
    const base = { title: 't', prompt: 'p', agent: 'cursor' as const, ownedPaths: ['x'] };
    expect(validateTaskInput(base)).toBeNull();
    expect(validateTaskInput({ ...base, title: ' ' })).toMatch(/Title/);
    expect(validateTaskInput({ ...base, ownedPaths: [] })).toMatch(/owned path/);
    expect(validateTaskInput({ ...base, reviewers: ['cursor'] })).toMatch(/author/);
  });

  it('submits a CreateTaskInput and excludes the author from reviewers', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<CreateTaskForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New UI' } });
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Do it' } });
    fireEvent.change(screen.getByLabelText('Author'), { target: { value: 'gemini' } });
    expect(screen.queryByRole('checkbox', { name: 'gemini' })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'claude' }));
    fireEvent.change(screen.getByLabelText(/Owned paths/), { target: { value: 'packages/web/**\ndocs/**' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Create task' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'New UI',
      prompt: 'Do it',
      agent: 'gemini',
      reviewers: ['claude'],
      ownedPaths: ['packages/web/**', 'docs/**'],
    });
    await waitFor(() => expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(''));
  });

  it('shows a validation error instead of submitting', () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<CreateTaskForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'y' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Create task' }));
    expect(screen.getByRole('alert').textContent).toMatch(/owned path/);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('TaskView', () => {
  it('derives allowed actions from status', () => {
    expect(availableActions(makeTask({ status: 'queued' }))).toEqual({ start: true, review: false, merge: false, reject: true });
    expect(availableActions(makeTask({ status: 'running', branch: 'b' }))).toEqual({
      start: false,
      review: false,
      merge: false,
      reject: false,
    });
    expect(availableActions(makeTask({ status: 'ready', branch: 'b' }))).toEqual({ start: false, review: true, merge: true, reject: true });
    expect(availableActions(makeTask({ status: 'merged', branch: 'b' }))).toEqual({
      start: false,
      review: false,
      merge: false,
      reject: false,
    });
  });

  it('renders logs, verdicts, diff with findings, and reports merge refusals', async () => {
    const { api } = fakeApi();
    const task = makeTask({ status: 'ready', branch: 'kacheri/t_abc123' });
    const runs = [
      { id: 'r1', taskId: task.id, agent: 'cursor' as const, kind: 'build' as const, status: 'succeeded' as const, exitCode: 0, startedAt: task.createdAt, endedAt: task.updatedAt },
    ];
    render(
      <TaskView
        api={api}
        task={task}
        runs={runs}
        verdicts={VERDICTS}
        logs={{ r1: { segments: [{ stream: 'stdout', text: 'building...\n' }], size: 12, truncated: false } }}
        onTask={() => {}}
      />,
    );
    expect(screen.getByText(/building\.\.\./)).toBeTruthy();
    expect(screen.getByText('Hardcoded secret')).toBeTruthy();
    await screen.findByText('Secret committed to source');
    expect(api.getDiff).toHaveBeenCalledWith(task.id);

    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/tests_failed.*npm test exited 1/));
    expect(api.mergeTask).toHaveBeenCalledWith(task.id);
  });
});

describe('App', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('loads the board, opens a task, starts it and applies live events', async () => {
    const queued = makeTask({ id: 't_one', title: 'First task' });
    const { api, emit, open } = fakeApi([queued]);
    render(<App api={api} />);
    open();
    expect(screen.getByRole('status').textContent).toBe('Live');

    const card = await screen.findByRole('button', { name: /First task/ });
    fireEvent.click(card);
    await waitFor(() => expect(api.getTask).toHaveBeenCalledWith('t_one'));
    expect(window.location.hash).toBe('#/tasks/t_one');

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() =>
      expect(within(screen.getByRole('listitem', { name: 'Running' })).getByText('First task')).toBeTruthy(),
    );
    expect(api.startTask).toHaveBeenCalledWith('t_one');

    emit({
      type: 'run',
      run: { id: 'run1', taskId: 't_one', agent: 'cursor', kind: 'build', status: 'running', exitCode: null, startedAt: '2026-10-30T07:05:00.000Z', endedAt: null },
    });
    emit({ type: 'log', runId: 'run1', taskId: 't_one', stream: 'stdout', chunk: 'hello ' });
    emit({ type: 'log', runId: 'run1', taskId: 't_one', stream: 'stdout', chunk: 'world' });
    expect(screen.getByLabelText('Run log').textContent).toBe('hello world');

    emit({ type: 'task', task: { ...queued, status: 'ready', branch: 'kacheri/t_one', updatedAt: '2026-10-30T07:10:00.000Z' } });
    expect(within(screen.getByRole('listitem', { name: 'Ready' })).getByText('First task')).toBeTruthy();
  });

  it('creates a task through the form and selects it', async () => {
    const { api } = fakeApi([]);
    render(<App api={api} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Brand new' } });
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'p' } });
    fireEvent.change(screen.getByLabelText(/Owned paths/), { target: { value: 'packages/web/**' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Create task' }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalled());
    expect(await screen.findByRole('heading', { name: 'Brand new' })).toBeTruthy();
    expect(window.location.hash).toBe('#/tasks/t_new');
  });
});
