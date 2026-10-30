// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CaseRecord, CourtEvent } from '@kacheri/shared';
import type { KacheriApi } from '../src/api';
import { parseBench, type BenchData } from '../src/court/bench';
import type { CourtHandlers, CourtSource } from '../src/court/source';
import { BenchPage } from '../src/components/court/BenchPage';
import { CourtPage } from '../src/components/court/CourtPage';
import { Root, parseRoute, routeHash } from '../src/Root';
import { makeCase, makeCharge, makeEvidence, makeUsage, readDemo } from './court-fixtures';

afterEach(cleanup);

function fakeSource(cases: CaseRecord[], opts: { demo?: boolean; bench?: BenchData | null } = {}) {
  let handlers: CourtHandlers | null = null;
  const stops: ReturnType<typeof vi.fn>[] = [];
  const replay = vi.fn((_id: string) => {
    const stop = vi.fn();
    stops.push(stop);
    return stop;
  });
  const source: CourtSource = {
    mode: opts.demo ? 'demo' : 'live',
    listCases: vi.fn(async () => cases),
    getCase: vi.fn(async (id: string) => cases.find((c) => c.id === id) ?? makeCase({ id })),
    createCase: opts.demo
      ? undefined
      : vi.fn(async (input: { title: string }) => makeCase({ id: 'new', title: input.title })),
    subscribe: vi.fn((h: CourtHandlers) => {
      handlers = h;
      return { close: vi.fn() };
    }),
    replay: opts.demo ? replay : undefined,
    loadBench: vi.fn(async () => opts.bench ?? null),
  };
  const emit = (event: CourtEvent) => act(() => handlers!.onEvent(event));
  return { source, emit, replay, stops };
}

describe('CourtPage (live)', () => {
  it('streams charges, evidence, defense, rulings and usage into the lanes', async () => {
    const { source, emit } = fakeSource([makeCase()]);
    render(<CourtPage source={source} caseId="case1" onSelect={vi.fn()} />);
    await screen.findByRole('article', { name: 'Case Add range support' });
    await waitFor(() => expect(source.getCase).toHaveBeenCalledWith('case1'));
    expect(screen.getByText('The prosecutor is reading the diff…')).toBeTruthy();

    emit({ type: 'usage', caseId: 'case1', usage: makeUsage({ costUsd: 0.0012, promptTokens: 1500, completionTokens: 700 }) });
    emit({ type: 'charge', caseId: 'case1', charge: makeCharge('c1', { claim: 'Off by one in range end' }) });
    emit({ type: 'charge', caseId: 'case1', charge: makeCharge('c2', { claim: 'Flaky claim' }) });
    const c1 = screen.getByRole('group', { name: 'Charge c1' });
    expect(within(c1).getByText('Off by one in range end')).toBeTruthy();
    expect(within(c1).getByText('src/a.js:3')).toBeTruthy();
    expect(within(c1).getByText('__kacheri__/c1.test.mjs')).toBeTruthy();

    emit({ type: 'evidence', caseId: 'case1', evidence: makeEvidence('c1', true) });
    emit({ type: 'evidence', caseId: 'case1', evidence: makeEvidence('c2', false) });
    expect(within(c1).getByText('Admissible')).toBeTruthy();
    expect(within(within(c1).getByLabelText('head runs')).getAllByText('fail')).toHaveLength(3);
    expect(within(within(c1).getByLabelText('base runs')).getAllByText('pass')).toHaveLength(3);
    const c2 = screen.getByRole('group', { name: 'Charge c2' });
    expect(within(c2).getByText('Inadmissible')).toBeTruthy();
    expect(within(c2).getByText('Not heard: evidence inadmissible.')).toBeTruthy();

    emit({ type: 'rebuttal', caseId: 'case1', rebuttal: { chargeId: 'c1', argument: 'Fair cop.', concedes: true } });
    expect(within(c1).getByText('Concedes')).toBeTruthy();
    expect(within(c1).getByText('Fair cop.')).toBeTruthy();

    emit({ type: 'ruling', caseId: 'case1', ruling: { chargeId: 'c1', decision: 'convicted', reason: 'Proven by witness.' } });
    emit({ type: 'ruling', caseId: 'case1', ruling: { chargeId: 'c2', decision: 'dismissed', reason: 'Inadmissible.' } });
    expect(within(c1).getByText('Convicted')).toBeTruthy();
    expect(c1.className).toContain('outcome-convicted');
    expect(within(c2).getByText('Dismissed')).toBeTruthy();
    expect(c2.className).toContain('outcome-dismissed');

    const meters = screen.getByLabelText('Case meters');
    expect(within(meters).getByText('$0.0012')).toBeTruthy();
    expect(within(meters).getByText('2.2k tok')).toBeTruthy();
    expect(screen.getByLabelText('Tally').textContent).toMatch(/1 convicted · 1 dismissed \(1 inadmissible\)/);
  });

  it('lists cases, selects one, and files a new case', async () => {
    const onSelect = vi.fn();
    const { source } = fakeSource([makeCase({ id: 'k1', title: 'First case' })]);
    render(<CourtPage source={source} caseId={null} onSelect={onSelect} />);
    expect(screen.getByRole('heading', { name: 'No evidence, no finding.' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /First case/ }));
    expect(onSelect).toHaveBeenCalledWith('k1');

    const form = screen.getByRole('form', { name: 'File a case' });
    fireEvent.submit(form);
    expect(within(form).getByRole('alert').textContent).toMatch(/Required: Title, Repository path, Base ref, Head ref/);
    fireEvent.change(within(form).getByLabelText('Title'), { target: { value: 'New case' } });
    fireEvent.change(within(form).getByLabelText('Repository path'), { target: { value: '/r' } });
    fireEvent.change(within(form).getByLabelText('Base ref'), { target: { value: 'main' } });
    fireEvent.change(within(form).getByLabelText('Head ref'), { target: { value: 'feat' } });
    fireEvent.submit(form);
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('new'));
    expect(source.createCase).toHaveBeenCalledWith({ title: 'New case', repoPath: '/r', baseRef: 'main', headRef: 'feat' });
  });
});

describe('CourtPage (demo)', () => {
  const demo = readDemo<CaseRecord>('cases/demo-1.json');

  it('renders the demo case: diff, lanes, verdicts and header meters', async () => {
    const { source, replay, stops } = fakeSource([demo], { demo: true });
    render(<CourtPage source={source} caseId="demo-1" onSelect={vi.fn()} />);
    await screen.findByRole('article', { name: `Case ${demo.title}` });
    await waitFor(() => expect(replay).toHaveBeenCalledWith('demo-1'));
    expect(source.getCase).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('Demo replay');

    expect(screen.getByRole('region', { name: 'src/compare.js' })).toBeTruthy();
    expect(screen.getByText('PR description')).toBeTruthy();
    const meters = screen.getByLabelText('Case meters');
    expect(within(meters).getByText('$0.0218')).toBeTruthy();
    expect(within(meters).getByText('31.7k tok')).toBeTruthy();
    expect(within(meters).getByText('2m 41s')).toBeTruthy();

    expect(within(screen.getByRole('group', { name: 'Charge c1' })).getByText('Convicted')).toBeTruthy();
    const c2 = screen.getByRole('group', { name: 'Charge c2' });
    expect(within(c2).getByText('Admissible')).toBeTruthy();
    expect(within(c2).getByText('Contests')).toBeTruthy();
    expect(within(c2).getByText('Dismissed')).toBeTruthy();
    for (const id of ['c3', 'c4', 'c5']) {
      const g = screen.getByRole('group', { name: `Charge ${id}` });
      expect(within(g).getByText('Inadmissible')).toBeTruthy();
      expect(within(g).getByText('Dismissed')).toBeTruthy();
    }
    expect(within(within(screen.getByRole('group', { name: 'Charge c4' })).getByLabelText('base runs')).getAllByText('error')).toHaveLength(3);

    const calls = replay.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    await waitFor(() => expect(replay.mock.calls.length).toBe(calls + 1));
    expect(stops[calls - 1]).toHaveBeenCalled();
  });
});

describe('BenchPage', () => {
  const sample = parseBench(readDemo('bench.json'));

  it('shows the sample banner, metric bars and a row per item', async () => {
    const { source } = fakeSource([], { bench: sample });
    render(<BenchPage source={source} />);
    const banner = await screen.findByRole('note', { name: 'Sample data' });
    expect(banner.textContent).toMatch(/not real benchmark results/);
    const hit = screen.getByRole('group', { name: 'Hit rate' });
    expect(within(hit).getByText('56%')).toBeTruthy();
    expect(within(hit).getByText('36%')).toBeTruthy();
    expect(within(screen.getByRole('group', { name: 'False positives per PR' })).getByText('0.08')).toBeTruthy();
    expect(within(screen.getByRole('group', { name: 'Cost per PR' })).getAllByText(/^\$0\.0\d{3}$/)).toHaveLength(2);
    const table = screen.getByRole('table', { name: 'Per-item results' });
    expect(within(table).getAllByRole('row')).toHaveLength(2 + 25);
    expect(within(table).getByText('m08')).toBeTruthy();
  });

  it('omits the banner for unflagged results and reports missing results', async () => {
    const real = { ...sample, sample: false, label: null };
    const { source } = fakeSource([], { bench: real });
    render(<BenchPage source={source} />);
    await screen.findByRole('group', { name: 'Hit rate' });
    expect(screen.queryByRole('note', { name: 'Sample data' })).toBeNull();
    cleanup();
    render(<BenchPage source={fakeSource([], { bench: null }).source} />);
    expect(await screen.findByText('No benchmark results published yet.')).toBeTruthy();
  });
});

describe('Root', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  function fakeApi(): KacheriApi {
    return {
      listTasks: vi.fn(async () => []),
      createTask: vi.fn(),
      getTask: vi.fn(),
      startTask: vi.fn(),
      reviewTask: vi.fn(),
      mergeTask: vi.fn(),
      rejectTask: vi.fn(),
      getDiff: vi.fn(),
      subscribe: vi.fn(() => ({ close: vi.fn() })),
    } as unknown as KacheriApi;
  }

  it('parses and builds hash routes', () => {
    expect(parseRoute('')).toEqual({ view: 'board' });
    expect(parseRoute('#/tasks/t1')).toEqual({ view: 'board' });
    expect(parseRoute('#/court')).toEqual({ view: 'court', caseId: null });
    expect(parseRoute('#/court/a%2Fb')).toEqual({ view: 'court', caseId: 'a/b' });
    expect(parseRoute('#/bench')).toEqual({ view: 'bench' });
    expect(routeHash({ view: 'court', caseId: 'a/b' })).toBe('#/court/a%2Fb');
  });

  it('shows the board with a daemon and switches sections on hash change', async () => {
    const { source } = fakeSource([makeCase({ id: 'k1', title: 'First case' })], { bench: null });
    render(<Root api={fakeApi()} court={source} />);
    expect(screen.getByRole('list', { name: 'Task board' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    expect(within(nav).getByText('Board').getAttribute('aria-current')).toBe('page');

    act(() => {
      window.history.replaceState(null, '', '#/court');
      window.dispatchEvent(new Event('hashchange'));
    });
    fireEvent.click(await screen.findByRole('button', { name: /First case/ }));
    expect(window.location.hash).toBe('#/court/k1');
    expect(await screen.findByRole('article', { name: 'Case First case' })).toBeTruthy();

    act(() => {
      window.history.replaceState(null, '', '#/bench');
      window.dispatchEvent(new Event('hashchange'));
    });
    expect(await screen.findByText('No benchmark results published yet.')).toBeTruthy();
  });

  it('hides the board in demo mode and toggles the theme', () => {
    const { source } = fakeSource([], { demo: true });
    render(<Root api={null} court={source} />);
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    expect(within(nav).queryByText('Board')).toBeNull();
    expect(within(nav).getByText('Court').getAttribute('aria-current')).toBe('page');
    const before = document.documentElement.dataset.theme;
    fireEvent.click(within(nav).getByRole('button', { name: /Switch to/ }));
    expect(document.documentElement.dataset.theme).not.toBe(before);
  });
});
