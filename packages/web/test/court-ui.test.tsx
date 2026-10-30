// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CaseRecord, CourtEvent } from '@kacheri/shared';
import type { KacheriApi } from '../src/api';
import { parseBench, type BenchData } from '../src/court/bench';
import type { CourtHandlers, CourtSource } from '../src/court/source';
import { BenchPage } from '../src/components/court/BenchPage';
import { CaseView } from '../src/components/court/CaseView';
import { CourtPage } from '../src/components/court/CourtPage';
import { Root, parseRoute, routeHash } from '../src/Root';
import { makeCase, makeCharge, makeEvidence, makeRemedy, makeUsage, readDemo } from './court-fixtures';

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
    expect(within(within(c1).getByLabelText('head runs')).getAllByText('FAIL')).toHaveLength(3);
    expect(within(within(c1).getByLabelText('base runs')).getAllByText('PASS')).toHaveLength(3);
    const c2 = screen.getByRole('group', { name: 'Charge c2' });
    expect(within(c2).getByText('Inadmissible')).toBeTruthy();
    expect(c2.className).toContain('charge-inadmissible');
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
    // the stamp appears only on the convicted charge, animated because the ruling arrived live
    expect(within(c1).getByText('Convicted').className).toContain('stamp-arrive');
    expect(c2.querySelector('.stamp')).toBeNull();
    expect(document.querySelectorAll('.stamp')).toHaveLength(1);
    expect(screen.queryByText(/Replay of recorded Token Factory run/)).toBeNull();

    const meters = screen.getByLabelText('Case meters');
    expect(within(meters).getByText('$0.0012')).toBeTruthy();
    expect(within(meters).getByText('2.2k tok')).toBeTruthy();
    expect(screen.getByLabelText('Tally').textContent).toMatch(/1 convicted · 1 dismissed \(1 inadmissible\)/);

    expect(screen.getByLabelText('Model lineage').textContent).toBe('Nano ×1 → Super → Ultra');
    expect(screen.queryByRole('region', { name: 'Remedy' })).toBeNull();
    expect(document.querySelector('.fix-mark')).toBeNull();
    emit({ type: 'remedy', caseId: 'case1', remedy: makeRemedy() });
    const remedy = screen.getByRole('region', { name: 'Remedy' });
    expect(within(remedy).getByText('Verified')).toBeTruthy();
    expect(within(within(remedy).getByLabelText('c1 head+fix runs')).getAllByText('PASS')).toHaveLength(3);
    expect(within(c1).getByText('Fix verified').className).toBe('fix-mark');
    expect(within(c2).queryByText('Fix verified')).toBeNull();
    expect(screen.getByLabelText('Model lineage').textContent).toBe('Nano ×1 → Super → Ultra → Super (fix)');
  });

  it('lists cases, selects one, and files a new case', async () => {
    const onSelect = vi.fn();
    const { source } = fakeSource([makeCase({ id: 'k1', title: 'First case' })]);
    render(<CourtPage source={source} caseId={null} onSelect={onSelect} />);
    expect(screen.getByRole('heading', { name: 'No evidence, no finding.' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /First case/ }));
    expect(onSelect).toHaveBeenCalledWith('k1');
    const docket = screen.getByRole('table', { name: 'Case docket' });
    const row = within(docket).getByRole('button', { name: /First case/ }).closest('tr')!;
    expect(row.textContent).toContain('aaaaaaa..bbbbbbb');
    expect(row.textContent).toContain('$0.0000');
    expect(row.textContent).toContain('2026-10-30');

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

  it('labels a recorded Token Factory run as a replay with its date', async () => {
    const record = makeCase({ mode: 'replay', status: 'closed', endedAt: '2026-10-30T07:02:00.000Z' });
    render(<CourtPage source={fakeSource([record]).source} caseId="case1" onSelect={vi.fn()} />);
    const label = await screen.findByText(/Replay of recorded Token Factory run/);
    expect(label.textContent).toContain('recorded on 2026-10-30');
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

    expect(within(screen.getByRole('region', { name: 'Diff' })).getByRole('region', { name: 'src/compare.js' })).toBeTruthy();
    expect(screen.getByText('PR description')).toBeTruthy();
    const meters = screen.getByLabelText('Case meters');
    expect(within(meters).getByText('$0.0274')).toBeTruthy();
    expect(within(meters).getByText('31.7k tok')).toBeTruthy();
    expect(within(meters).getByText('3m 23s')).toBeTruthy();

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
    const c4 = screen.getByRole('group', { name: 'Charge c4' });
    const c4Base = within(c4).getByLabelText('base runs');
    expect(within(c4Base).getAllByText('ERROR')).toHaveLength(3);
    expect(c4Base.querySelector('th')?.className).toContain('reg-side-fault');
    expect(c4.className).toContain('charge-inadmissible');

    const register = within(screen.getByRole('group', { name: 'Charge c1' })).getByRole('table', { name: 'Evidence register' });
    expect(within(within(register).getByLabelText('head runs')).getAllByText('FAIL')).toHaveLength(3);
    expect(within(register).getByText('3/3 fail')).toBeTruthy();
    expect(within(register).getByText('3/3 pass')).toBeTruthy();
    expect(within(register).getByText('fails on head 3/3, passes on base 3/3')).toBeTruthy();
    expect(
      within(within(screen.getByRole('group', { name: 'Charge c5' })).getByLabelText('head runs')).getByText(
        '2/3 fail, 1/3 pass',
      ),
    ).toBeTruthy();

    expect(screen.getByLabelText('Model lineage').textContent).toBe('Nano ×3 → Super → Ultra → Super (fix)');
    expect(within(meters).getByText('Nano ×3').getAttribute('title')).toBe('nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B');
    expect(within(meters).getByText('Super (fix)').getAttribute('title')).toBe('nvidia/nemotron-3-super-120b-a12b');
    expect(within(meters).getByText('24.5k tok')).toBeTruthy();
    expect(within(meters).getByText('9.1k tok')).toBeTruthy();
    expect(screen.getByText(/Replay of recorded Token Factory run/).textContent).toContain('recorded on 2026-10-29');

    // a closed case loads with its stamp already in place: only the convicted charge, no arrival animation
    const stamps = document.querySelectorAll('.stamp');
    expect(stamps).toHaveLength(1);
    expect(stamps[0].closest('[role="group"]')?.getAttribute('aria-label')).toBe('Charge c1');
    expect(stamps[0].className).not.toContain('stamp-arrive');

    const calls = replay.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    await waitFor(() => expect(replay.mock.calls.length).toBe(calls + 1));
    expect(stops[calls - 1]).toHaveBeenCalled();
  });
});

describe('CaseView workbench', () => {
  const demo = readDemo<CaseRecord>('cases/demo-1.json');
  type ScrollFn = (this: Element, arg?: boolean | ScrollIntoViewOptions) => void;
  const proto = Element.prototype as { scrollIntoView?: ScrollFn };
  let original: ScrollFn | undefined;
  let scrolled: Element[] = [];

  beforeEach(() => {
    original = proto.scrollIntoView;
    scrolled = [];
    proto.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
  });
  afterEach(() => {
    proto.scrollIntoView = original;
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  async function renderDemo() {
    const { source } = fakeSource([demo], { demo: true });
    render(<CourtPage source={source} caseId="demo-1" onSelect={vi.fn()} />);
    await screen.findByRole('article', { name: `Case ${demo.title}` });
  }

  it('links charges and diff lines both ways', async () => {
    await renderDemo();
    const diffPane = screen.getByRole('region', { name: 'Diff' });
    const compare = within(diffPane).getByRole('region', { name: 'src/compare.js' });
    const mark = within(compare).getByRole('button', { name: 'Go to charge c1' });
    const markedRow = mark.closest('tr')!;
    expect(markedRow.className).toContain('line-charged');
    expect(markedRow.textContent).toContain('MAIN.length - 1');
    expect(within(compare).getByRole('button', { name: 'Go to charge c4' })).toBeTruthy();

    const c1 = screen.getByRole('group', { name: 'Charge c1' });
    fireEvent.click(within(c1).getByRole('button', { name: 'src/compare.js:28' }));
    expect(markedRow.className).toContain('line-active');
    expect(c1.className).toContain('charge-active');
    expect(scrolled[scrolled.length - 1]).toBe(markedRow);

    const range = within(diffPane).getByRole('region', { name: 'src/range.js' });
    fireEvent.click(within(range).getByRole('button', { name: 'Go to charge c2' }));
    const c2 = screen.getByRole('group', { name: 'Charge c2' });
    expect(c2.className).toContain('charge-active');
    expect(c1.className).not.toContain('charge-active');
    expect(markedRow.className).not.toContain('line-active');
    expect(within(range).getByRole('button', { name: 'Go to charge c2' }).closest('tr')!.className).toContain('line-active');
    expect(scrolled[scrolled.length - 1]).toBe(c2);
  });

  it('opens each register cell in the log drawer', async () => {
    await renderDemo();
    const c1 = screen.getByRole('group', { name: 'Charge c1' });
    fireEvent.click(within(c1).getByRole('button', { name: 'head run 3: FAIL, open log' }));
    const drawer = screen.getByRole('dialog', { name: 'Log: c1 · head run 3' });
    expect(drawer.textContent).toContain('0 !== -1');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(within(c1).getByRole('button', { name: 'base run 1: PASS, open log' }));
    expect(screen.getByRole('dialog', { name: 'Log: c1 · base run 1' }).textContent).toMatch(/No log recorded for this run/);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('copies a repro that checks out head and runs the witness', async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await renderDemo();
    const c1 = screen.getByRole('group', { name: 'Charge c1' });
    expect(within(c1).getByText('Witness').closest('details')?.open).toBe(false);
    fireEvent.click(within(c1).getByRole('button', { name: 'Copy repro' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const cmd = writeText.mock.calls[0][0];
    expect(cmd).toContain(`git checkout --detach '${demo.headRef}'`);
    expect(cmd).toContain("node --test '__kacheri__/c1.test.mjs' # expected: FAIL on head");
    expect(await within(c1).findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('ends the docket with the verified remedy: register, suite log and fix patch', async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await renderDemo();
    const docket = screen.getByRole('region', { name: 'Docket' });
    const remedy = within(docket).getByRole('region', { name: 'Remedy' });
    const charges = docket.querySelector('ol.charges')!;
    expect(charges.compareDocumentPosition(remedy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(remedy.nextElementSibling).toBeNull();

    expect(within(remedy).getByRole('heading', { name: 'Remedy' }).className).toBe('remedy-title');
    expect(within(remedy).getByText('Verified').className).toContain('remedy-verified');
    expect(within(remedy).queryByText('Not verified')).toBeNull();
    expect(within(remedy).getByText('2 attempts')).toBeTruthy();
    expect(within(remedy).getByText(demo.remedy!.explanation)).toBeTruthy();

    const register = within(remedy).getByRole('table', { name: 'Remedy register' });
    expect(within(register).getAllByRole('row')).toHaveLength(2);
    const row = within(register).getByLabelText('c1 head+fix runs');
    expect(row.querySelector('th')?.textContent).toBe('c1 HEAD+FIX');
    expect(within(row).getAllByText('PASS')).toHaveLength(3);
    expect(within(row).getByText('3/3 pass')).toBeTruthy();

    const suite = within(remedy).getByText('Existing suite').closest('p')!;
    expect(within(suite).getByText('PASS').className).toBe('suite-pass');
    fireEvent.click(within(suite).getByRole('button', { name: 'View log' }));
    const drawer = screen.getByRole('dialog', { name: 'Log: existing suite · head+fix' });
    expect(drawer.textContent).toContain('ℹ pass 10');
    expect(within(drawer).getByText('PASS').className).toContain('suite-pass');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    expect(remedy.querySelector('.diff-refs')?.textContent).toBe(`${demo.headRef.slice(0, 10)}…head+fix · 1 file changed`);
    const fixFile = within(remedy).getByRole('region', { name: 'src/compare.js' });
    const dels = fixFile.querySelectorAll('tr.line-del');
    const adds = fixFile.querySelectorAll('tr.line-add');
    expect(dels).toHaveLength(1);
    expect(adds).toHaveLength(1);
    expect(dels[0].textContent).toContain('i < MAIN.length - 1;');
    expect(adds[0].textContent).toContain('i < MAIN.length;');

    fireEvent.click(within(remedy).getByRole('button', { name: 'Copy patch' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(demo.remedy!.patch));
    expect(await within(remedy).findByRole('button', { name: 'Copied' })).toBeTruthy();

    const c1 = screen.getByRole('group', { name: 'Charge c1' });
    const mark = within(c1).getByText('Fix verified');
    expect(mark.className).toBe('fix-mark');
    expect(mark.parentElement?.querySelector('.stamp')).toBeTruthy();
    expect(document.querySelectorAll('.fix-mark')).toHaveLength(1);
  });

  it('shows an unverified remedy muted, with no fix mark and missing runs as dashes', () => {
    const record = makeCase({
      status: 'closed',
      endedAt: '2026-10-30T07:03:00.000Z',
      charges: [makeCharge('c1'), makeCharge('c2')],
      evidence: [makeEvidence('c1', true), makeEvidence('c2', true)],
      rulings: [
        { chargeId: 'c1', decision: 'convicted', reason: 'r1' },
        { chargeId: 'c2', decision: 'convicted', reason: 'r2' },
      ],
      remedy: makeRemedy({
        chargeIds: ['c1', 'c2'],
        verified: false,
        attempts: 1,
        suite: 'fail',
        suiteLog: '',
        witnesses: [{ chargeId: 'c1', outcomes: ['pass', 'fail', 'pass'] }],
      }),
    });
    render(<CaseView record={record} />);
    const remedy = screen.getByRole('region', { name: 'Remedy' });
    expect(within(remedy).getByText('Not verified').className).toContain('remedy-unverified');
    expect(within(remedy).queryByText('Verified')).toBeNull();
    expect(within(remedy).getByText('1 attempt')).toBeTruthy();

    const c1Row = within(remedy).getByLabelText('c1 head+fix runs');
    expect(within(c1Row).getAllByText('PASS')).toHaveLength(2);
    expect(within(c1Row).getByText('FAIL').className).toBe('run-fail');
    expect(within(c1Row).getByText('2/3 pass, 1/3 fail')).toBeTruthy();
    const c2Row = within(remedy).getByLabelText('c2 head+fix runs');
    expect(within(c2Row).getAllByText('—')).toHaveLength(3);
    expect(within(c2Row).getByText('no runs')).toBeTruthy();

    const suite = within(remedy).getByText('Existing suite').closest('p')!;
    expect(within(suite).getByText('FAIL').className).toBe('suite-fail');
    fireEvent.click(within(suite).getByRole('button', { name: 'View log' }));
    expect(screen.getByRole('dialog', { name: 'Log: existing suite · head+fix' }).textContent).toContain('(empty output)');

    expect(document.querySelector('.fix-mark')).toBeNull();
    expect(screen.getByLabelText('Model lineage').textContent).toBe('Nano → Super → Ultra → Super (fix)');
  });

  it('labels a suite that was not run', () => {
    const record = makeCase({
      status: 'closed',
      charges: [makeCharge('c1')],
      rulings: [{ chargeId: 'c1', decision: 'convicted', reason: 'r1' }],
      remedy: makeRemedy({ suite: 'not_run', suiteLog: '' }),
    });
    render(<CaseView record={record} />);
    const suite = within(screen.getByRole('region', { name: 'Remedy' })).getByText('Existing suite').closest('p')!;
    expect(within(suite).getByText('NOT RUN').className).toBe('suite-not_run');
    fireEvent.click(within(suite).getByRole('button', { name: 'View log' }));
    expect(screen.getByRole('dialog').textContent).toContain('The existing suite was not run on head+fix.');
  });
});

describe('BenchPage', () => {
  const sample = parseBench(readDemo('bench.json'));

  it('shows the sample banner, metric bars and a row per item', async () => {
    const { source } = fakeSource([], { bench: sample });
    render(<BenchPage source={source} />);
    const banner = await screen.findByRole('note', { name: 'Sample data' });
    expect(banner.textContent).toMatch(/not real benchmark results/);
    const comparison = screen.getByRole('table', { name: 'Comparison' });
    expect(within(comparison).getAllByRole('row')).toHaveLength(3);
    expect(within(comparison).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'System',
      'Hit rate',
      'FP / PR',
      'Precision',
      '$ / PR',
      'p50 latency',
      'n',
    ]);
    const hit = screen.getByRole('group', { name: 'Hit rate' });
    // comparison table comes first, then the per-metric rules
    expect(comparison.compareDocumentPosition(hit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(hit).getByText('56%')).toBeTruthy();
    expect(within(hit).getByText('36%')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Precision' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'p50 latency' })).toBeTruthy();
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
