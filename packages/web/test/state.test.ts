import { describe, expect, it } from 'vitest';
import type { Run } from '@kacheri/shared';
import { appendLog, initialState, MAX_LOG_CHARS, reducer } from '../src/state';
import { VERDICTS, makeTask } from './fixtures';

const run: Run = {
  id: 'r1',
  taskId: 't_abc123',
  agent: 'cursor',
  kind: 'build',
  status: 'running',
  exitCode: null,
  startedAt: '2026-10-30T07:01:00.000Z',
  endedAt: null,
};

describe('reducer', () => {
  it('loads tasks and ignores stale task events', () => {
    const fresh = makeTask({ status: 'running', updatedAt: '2026-10-30T07:05:00.000Z' });
    let s = reducer(initialState, { type: 'tasks/loaded', tasks: [fresh] });
    s = reducer(s, { type: 'event', event: { type: 'task', task: makeTask({ status: 'queued' }) } });
    expect(s.tasks[fresh.id].status).toBe('running');
    s = reducer(s, { type: 'detail/loaded', detail: { task: makeTask(), runs: [run], verdicts: [] } });
    expect(s.tasks[fresh.id].status).toBe('running');
    expect(s.extras[fresh.id].runs).toEqual([run]);
    s = reducer(s, {
      type: 'event',
      event: { type: 'task', task: makeTask({ status: 'ready', updatedAt: '2026-10-30T07:09:00.000Z' }) },
    });
    expect(s.tasks[fresh.id].status).toBe('ready');
  });

  it('upserts runs and verdicts by id / reviewer', () => {
    let s = reducer(initialState, { type: 'event', event: { type: 'run', run } });
    s = reducer(s, { type: 'event', event: { type: 'run', run: { ...run, status: 'succeeded', exitCode: 0 } } });
    expect(s.extras.t_abc123.runs).toHaveLength(1);
    expect(s.extras.t_abc123.runs[0].status).toBe('succeeded');
    s = reducer(s, { type: 'event', event: { type: 'verdict', taskId: 't_abc123', verdict: VERDICTS[0] } });
    s = reducer(s, {
      type: 'event',
      event: { type: 'verdict', taskId: 't_abc123', verdict: { ...VERDICTS[0], status: 'PASS', findings: [] } },
    });
    expect(s.extras.t_abc123.verdicts).toHaveLength(1);
    expect(s.extras.t_abc123.verdicts[0].status).toBe('PASS');
    expect(s.extras.t_abc123.runs).toHaveLength(1);
  });

  it('appends log chunks per run', () => {
    let s = reducer(initialState, { type: 'event', event: { type: 'log', runId: 'r1', taskId: 't', stream: 'stdout', chunk: 'a' } });
    s = reducer(s, { type: 'event', event: { type: 'log', runId: 'r1', taskId: 't', stream: 'stdout', chunk: 'b' } });
    s = reducer(s, { type: 'event', event: { type: 'log', runId: 'r1', taskId: 't', stream: 'stderr', chunk: 'c' } });
    expect(s.logs.r1.segments).toEqual([
      { stream: 'stdout', text: 'ab' },
      { stream: 'stderr', text: 'c' },
    ]);
  });
});

describe('appendLog', () => {
  it('caps retained output and marks truncation', () => {
    let log = appendLog(undefined, 'stdout', 'x'.repeat(MAX_LOG_CHARS - 10));
    log = appendLog(log, 'stderr', 'y'.repeat(30));
    expect(log.size).toBe(MAX_LOG_CHARS);
    expect(log.truncated).toBe(true);
    expect(log.segments.map((s) => s.text.length).reduce((a, b) => a + b, 0)).toBe(MAX_LOG_CHARS);
    expect(log.segments[1].text).toBe('y'.repeat(30));
  });
});
