// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Board, groupByStatus, STATUS_ORDER } from '../src/components/Board';
import { makeTask } from './fixtures';

afterEach(cleanup);

const tasks = [
  makeTask({ id: 't_q1', title: 'Queued one', status: 'queued' }),
  makeTask({ id: 't_r1', title: 'Running one', status: 'running', branch: 'kacheri/t_r1' }),
  makeTask({ id: 't_ok', title: 'Ready one', status: 'ready', updatedAt: '2026-10-30T08:00:00.000Z' }),
  makeTask({ id: 't_ok2', title: 'Ready two', status: 'ready', updatedAt: '2026-10-30T09:00:00.000Z' }),
  makeTask({ id: 't_f', title: 'Broken', status: 'failed', error: 'git exploded' }),
];

describe('groupByStatus', () => {
  it('buckets every status and sorts newest first', () => {
    const groups = groupByStatus(tasks);
    expect(Object.keys(groups).sort()).toEqual([...STATUS_ORDER].sort());
    expect(groups.ready.map((t) => t.id)).toEqual(['t_ok2', 't_ok']);
    expect(groups.merged).toEqual([]);
  });
});

describe('Board', () => {
  it('renders one column per status with tasks in the right column', () => {
    render(<Board tasks={tasks} selectedId={null} onSelect={() => {}} />);
    for (const label of ['Queued', 'Running', 'Reviewing', 'Ready', 'Changes requested', 'Merged', 'Rejected', 'Failed']) {
      expect(screen.getByRole('listitem', { name: label })).toBeTruthy();
    }
    const ready = screen.getByRole('listitem', { name: 'Ready' });
    expect(within(ready).getByText('Ready one')).toBeTruthy();
    expect(within(ready).getByText('Ready two')).toBeTruthy();
    expect(within(ready).getByText('2')).toBeTruthy();
    const queued = screen.getByRole('listitem', { name: 'Queued' });
    expect(within(queued).getByText('Queued one')).toBeTruthy();
    expect(within(queued).queryByText('Ready one')).toBeNull();
    expect(within(screen.getByRole('listitem', { name: 'Failed' })).getByText('git exploded')).toBeTruthy();
  });

  it('calls onSelect with the task id and marks the selected card', () => {
    const onSelect = vi.fn();
    render(<Board tasks={tasks} selectedId="t_r1" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Queued one/ }));
    expect(onSelect).toHaveBeenCalledWith('t_q1');
    expect(screen.getByRole('button', { name: /Running one/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /Queued one/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('shows author and reviewers on cards', () => {
    render(<Board tasks={[makeTask({ agent: 'claude', reviewers: ['codex', 'gemini'] })]} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText(/claude → codex, gemini/)).toBeTruthy();
  });
});
