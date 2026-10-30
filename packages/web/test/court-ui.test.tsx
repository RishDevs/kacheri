// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CaseRecord, CourtEvent, Evidence } from '@kacheri/shared';
import type { KacheriApi } from '../src/api';
import { parseBench, type BenchData } from '../src/court/bench';
import { applyCommand } from '../src/court/repro';
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

function section(title: string): HTMLElement {
  return screen.getByRole('heading', { name: title }).closest('section') as HTMLElement;
}

function judgmentBox(): HTMLElement {
  return screen.getByRole('region', { name: 'Judgment' });
}

function headline(): string {
  return judgmentBox().querySelector('.judgment-headline')?.textContent ?? '';
}

function countItem(n: number): HTMLElement {
  return within(section('I. The Charges')).getByText(`Count ${n}.`).closest('li') as HTMLElement;
}

function mockClipboard() {
  const writeText = vi.fn(async (_text: string) => undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

afterEach(() => {
  delete (navigator as { clipboard?: unknown }).clipboard;
});

describe('CourtPage (live)', () => {
  it('fills the judgment in as events arrive, with the current stage in plain words', async () => {
    const { source, emit } = fakeSource([makeCase()]);
    render(<CourtPage source={source} caseId="case1" onSelect={vi.fn()} />);
    await screen.findByRole('article', { name: 'Case Add range support' });
    await waitFor(() => expect(source.getCase).toHaveBeenCalledWith('case1'));
    expect(headline()).toBe('The prosecution is writing proof tests…');
    expect(judgmentBox().textContent).toContain('In plain words: the court has not decided yet.');
    expect(within(section('I. The Charges')).getByText('No charges have been filed yet.')).toBeTruthy();

    const c1 = makeCharge('c1', { claim: 'Off by one in range end' });
    const c2 = makeCharge('c2', { claim: 'Flaky claim' });
    emit({ type: 'usage', caseId: 'case1', usage: makeUsage({ costUsd: 0.0012 }) });
    emit({ type: 'charge', caseId: 'case1', charge: c1 });
    emit({ type: 'charge', caseId: 'case1', charge: c2 });
    expect(countItem(1).textContent).toContain('Off by one in range end');
    expect(countItem(1).textContent).toContain('src/a.js:3');
    expect(within(countItem(1)).getByText('PENDING')).toBeTruthy();

    const usage = [makeUsage({ costUsd: 0.0012 })];
    emit({ type: 'case', record: makeCase({ status: 'trial', charges: [c1, c2], usage }) });
    expect(headline()).toBe('The court is running test 1 of 12…');
    const e1 = makeEvidence('c1', true);
    const e2 = makeEvidence('c2', false);
    emit({ type: 'evidence', caseId: 'case1', evidence: e1 });
    expect(headline()).toBe('The court is running test 7 of 12…');
    emit({ type: 'evidence', caseId: 'case1', evidence: e2 });

    emit({ type: 'case', record: makeCase({ status: 'deliberation', charges: [c1, c2], evidence: [e1, e2], usage }) });
    expect(headline()).toBe('The defense is responding…');
    expect(screen.getByRole('heading', { name: 'II. The Evidence on Count 1' })).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Exhibit 1: record of trial runs' })).toBeTruthy();
    expect(within(section('III. The Defense')).getByText('The defense has not answered Count 1 yet.')).toBeTruthy();

    emit({ type: 'rebuttal', caseId: 'case1', rebuttal: { chargeId: 'c1', argument: 'Fair cop.', concedes: true } });
    expect(headline()).toBe('The judge is deciding…');
    expect(section('III. The Defense').textContent).toContain(
      'Counsel for the change (Nemotron Super) conceded Count 1: fair cop.',
    );

    emit({ type: 'ruling', caseId: 'case1', ruling: { chargeId: 'c1', decision: 'convicted', reason: 'Proven by the test.' } });
    emit({ type: 'ruling', caseId: 'case1', ruling: { chargeId: 'c2', decision: 'dismissed', reason: 'Inadmissible.' } });
    expect(headline()).toBe('The court is testing the fix…');
    expect(within(countItem(1)).getByText('PROVEN')).toBeTruthy();
    expect(within(countItem(2)).getByText('DISMISSED')).toBeTruthy();
    expect(section('V. Order').textContent).toContain('The court has not yet made an order.');
    expect(within(section('V. Order')).queryByText('So ordered.')).toBeNull();

    const remedy = makeRemedy();
    emit({ type: 'remedy', caseId: 'case1', remedy });
    const runs = screen.getByRole('table', { name: 'Exhibit 1: record of trial runs' });
    expect(within(within(runs).getByText('With the fix').closest('tr')!).getAllByText('PASS')).toHaveLength(3);

    emit({
      type: 'case',
      record: makeCase({
        status: 'closed',
        endedAt: '2026-10-30T07:03:00.000Z',
        charges: [c1, c2],
        evidence: [e1, e2],
        rebuttals: [{ chargeId: 'c1', argument: 'Fair cop.', concedes: true }],
        rulings: [
          { chargeId: 'c1', decision: 'convicted', reason: 'Proven by the test.' },
          { chargeId: 'c2', decision: 'dismissed', reason: 'Inadmissible: passes on head 3/3.' },
        ],
        usage,
        remedy,
      }),
    });
    expect(headline()).toBe('Guilty on Count 1. Count 2 dismissed for want of evidence.');
    expect(judgmentBox().className).toContain('judgment-guilty');
    expect(judgmentBox().textContent).toContain(
      'In plain words: this change breaks one thing, proven by a test that fails. The other concern had no working proof, so it is not counted. A fix has been tested and is ready.',
    );
    expect(within(section('V. Order')).getByText('So ordered.')).toBeTruthy();
    expect(screen.getByText('Entered 30 October 2026')).toBeTruthy();
    expect(screen.queryByText(/^Replay\./)).toBeNull();
  });

  it('lists cases in a plain docket table, opens one by link, and files a new case', async () => {
    const onSelect = vi.fn();
    const guilty = makeCase({
      id: 'k2',
      title: 'Second case',
      status: 'closed',
      startedAt: '2026-10-29T07:00:00.000Z',
      charges: [makeCharge('c1'), makeCharge('c2')],
      evidence: [makeEvidence('c1', true), makeEvidence('c2', false)],
      rulings: [{ chargeId: 'c1', decision: 'convicted', reason: 'r' }],
      usage: [makeUsage({ costUsd: 0.0123 })],
    });
    const { source } = fakeSource([makeCase({ id: 'k1', title: 'First case' }), guilty]);
    render(<CourtPage source={source} caseId={null} onSelect={onSelect} />);
    const docket = await screen.findByRole('table', { name: 'Case docket' });
    expect(within(docket).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Case No.',
      'Parties',
      'Filed',
      'Judgment',
      'Costs',
    ]);

    const link = within(docket).getByRole('link', { name: 'First case' });
    expect(link.getAttribute('href')).toBe('#/court/k1');
    fireEvent.click(link);
    expect(onSelect).toHaveBeenCalledWith('k1');
    const first = link.closest('tr')!;
    expect(first.textContent).toContain('KC-2026-K1');
    expect(first.textContent).toContain('2026-10-30');
    expect(first.textContent).toContain('IN SESSION');
    expect(first.textContent).toContain('$0.0000');
    const second = within(docket).getByRole('link', { name: 'Second case' }).closest('tr')!;
    expect(within(second).getByText('GUILTY 1').className).toContain('verdict-guilty');
    expect(second.textContent).toContain('of 2 counts');
    expect(second.textContent).toContain('$0.0123');

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

  it('marks a not-guilty case in the docket', async () => {
    const record = makeCase({
      status: 'closed',
      charges: [makeCharge('c1')],
      evidence: [makeEvidence('c1', false)],
    });
    render(<CourtPage source={fakeSource([record]).source} caseId={null} onSelect={vi.fn()} />);
    expect((await screen.findByText('NOT GUILTY')).className).toContain('verdict-not-guilty');
  });

  it('labels a recorded run as a replay with its date, and goes back to the docket by link', async () => {
    const onSelect = vi.fn();
    const record = makeCase({ mode: 'replay', status: 'closed', endedAt: '2026-10-30T07:02:00.000Z' });
    render(<CourtPage source={fakeSource([record]).source} caseId="case1" onSelect={onSelect} />);
    const label = await screen.findByText(/^Replay\./);
    expect(label.textContent).toBe('Replay. This case was recorded on 30 October 2026 and is played back here, not run live.');
    fireEvent.click(screen.getByRole('link', { name: '← Back to the docket' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

describe('CourtPage (demo replay of the normalize-url case)', () => {
  const demo = readDemo<CaseRecord>('cases/demo-1.json');

  async function renderDemo() {
    const fake = fakeSource([demo], { demo: true });
    render(<CourtPage source={fake.source} caseId={demo.id} onSelect={vi.fn()} />);
    await screen.findByRole('article', { name: `Case ${demo.title}` });
    return fake;
  }

  it('renders the caption, judgment and every section as in the approved mockup', async () => {
    const { source, replay, stops } = await renderDemo();
    await waitFor(() => expect(replay).toHaveBeenCalledWith(demo.id));
    expect(source.getCase).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('Demo replay');
    expect(screen.getByText('sitting in review of sindresorhus/normalize-url')).toBeTruthy();

    const caption = screen.getByRole('group', { name: 'Caption' });
    expect(within(caption).getByText('THE MAINTAINERS OF NORMALIZE-URL,')).toBeTruthy();
    expect(within(caption).getByText('PULL REQUEST ec3ab37, “Refactor URL normalization edge handling,”')).toBeTruthy();
    expect(within(caption).getByText('Plaintiff,')).toBeTruthy();
    expect(within(caption).getByText('Defendant.')).toBeTruthy();
    expect(within(caption).getByText('KC-2026-0014')).toBeTruthy();
    expect(within(caption).getByText('JUDGMENT')).toBeTruthy();
    expect(within(caption).getByText(/^Base/).textContent).toBe('Base d74a32e · Head ec3ab37');

    expect(headline()).toBe('Guilty on Count 1. Counts 2 to 4 dismissed for want of evidence.');
    expect(judgmentBox().querySelector('.plain')?.textContent).toBe(
      'In plain words: this change breaks one thing, proven by a test that fails. The other three concerns had no working proof, so they are not counted. A fix has been tested and is ready.',
    );
    expect(within(judgmentBox()).getByRole('button', { name: 'Apply the ordered fix' })).toBeTruthy();
    expect(within(judgmentBox()).getByRole('button', { name: 'Copy repro command' })).toBeTruthy();

    expect(countItem(1).textContent).toBe('Count 1. Hostnames with a port lose their protocol. index.js:17 PROVEN');
    expect(countItem(1).className).toContain('count-proven');
    for (const n of [2, 3, 4]) {
      expect(within(countItem(n)).getByText('DISMISSED')).toBeTruthy();
      expect(countItem(n).className).toContain('count-dismissed');
      expect(countItem(n).querySelector('.loc')).toBeNull();
    }

    const evidence = section('II. The Evidence on Count 1');
    expect(evidence.textContent).toContain(
      'The prosecution (Nemotron Nano) filed a test as its proof. The court ran it three times on the code before the change, three times after, and three times with the fix.',
    );

    expect(section('III. The Defense').textContent).toContain(
      'Counsel for the change (Nemotron Super) conceded Count 1: hostnames with a port are documented input, and nothing in the pull request says this behaviour should change.',
    );

    const findings = section('IV. Findings of the Court');
    expect(findings.textContent).toContain(
      'On Count 1: the test is sound, it fails only after the change, and the failure traces to the removed check at line 17.',
    );
    expect(findings.textContent).toContain(
      'On Counts 2 to 4: dismissed without trial. Count 2’s test passed on the new code. Count 3’s test gave the same result before the change. Count 4’s test could not run.',
    );

    const order = section('V. Order');
    expect(order.textContent).toContain(
      'It is ordered that the following remedy be applied. The court re-ran Exhibit 1 on the remedied code (3 of 3 pass) and the library’s own 25 tests (all pass).',
    );
    expect(order.querySelector('.fix-patch')?.textContent).toBe(
      "  return protocol.endsWith(':')\n+   && !protocol.includes('.')\n    && !supportedProtocols.has(protocol);",
    );
    expect(within(order).getByText('So ordered.')).toBeTruthy();

    expect(screen.getByText('Nemotron 3 Ultra, presiding')).toBeTruthy();
    expect(screen.getByText('Entered 30 October 2026')).toBeTruthy();
    const costs = document.querySelector('.costs')!;
    expect(within(costs as HTMLElement).getByText('$0.0179')).toBeTruthy();
    expect(within(costs as HTMLElement).getByText('2m 47s')).toBeTruthy();
    expect(screen.getByText(/^Replay\./).textContent).toContain('recorded on 30 October 2026');

    const calls = replay.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Replay from the start' }));
    await waitFor(() => expect(replay.mock.calls.length).toBe(calls + 1));
    expect(stops[calls - 1]).toHaveBeenCalled();
  });

  it('renders the three exhibits: trial runs, the proof test, and the line at issue', async () => {
    await renderDemo();
    const evidence = section('II. The Evidence on Count 1');
    expect(within(evidence).getByText('EXHIBIT 1')).toBeTruthy();
    expect(within(evidence).getByText('Record of trial runs')).toBeTruthy();
    const runs = within(evidence).getByRole('table', { name: 'Exhibit 1: record of trial runs' });
    expect(within(runs).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Code tested', 'Run 1', 'Run 2', 'Run 3']);
    const row = (label: string) => within(runs).getByText(label).closest('tr') as HTMLElement;
    expect(within(row('Before the change')).getAllByText('PASS')).toHaveLength(3);
    expect(within(row('After the change')).getAllByText('FAIL')).toHaveLength(3);
    expect(within(row('With the fix')).getAllByText('PASS')).toHaveLength(3);
    expect(within(row('After the change')).getAllByText('FAIL')[0].className).toBe('cell fail');
    expect(within(row('Before the change')).getAllByText('PASS')[0].className).toBe('cell pass');

    expect(within(evidence).getByText('EXHIBIT 2')).toBeTruthy();
    expect(within(evidence).getByText('The proof test, as filed')).toBeTruthy();
    const code = evidence.querySelectorAll('pre.exhibit-code')[0];
    expect(code.textContent).toContain("assert.equal(normalizeUrl('sindresorhus.com:123'), 'http://sindresorhus.com:123');");

    expect(within(evidence).getByText('EXHIBIT 3')).toBeTruthy();
    expect(within(evidence).getByText('The line at issue, index.js')).toBeTruthy();
    const lines = evidence.querySelector('.lines-at-issue')!;
    expect(lines.textContent).toBe(
      "  return protocol.endsWith(':')\n    && !protocol.includes('.')     ← removed by this change\n    && !supportedProtocols.has(protocol);",
    );
    const removed = lines.querySelector('.xl-del')!;
    expect(removed.querySelector('.xl-code')?.textContent).toBe("    && !protocol.includes('.')");
    expect(removed.querySelector('.xl-note')?.textContent).toBe('← removed by this change');
    expect(within(evidence).queryByText('EXHIBIT 4')).toBeNull();
  });

  it('copies the repro command and the apply command for the ordered fix', async () => {
    const writeText = mockClipboard();
    await renderDemo();
    fireEvent.click(within(judgmentBox()).getByRole('button', { name: 'Copy repro command' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const cmd = writeText.mock.calls[0][0];
    expect(cmd).toContain(`git checkout --detach '${demo.headRef}'`);
    expect(cmd).toContain("node --test '__kacheri__/c1.test.mjs' # expected: FAIL on head");
    expect(await within(judgmentBox()).findByRole('button', { name: 'Copied' })).toBeTruthy();

    fireEvent.click(within(judgmentBox()).getByRole('button', { name: 'Apply the ordered fix' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText.mock.calls[1][0]).toBe(applyCommand(demo.remedy!.patch));
    expect(await within(judgmentBox()).findByRole('button', { name: 'Copied: paste it in a terminal' })).toBeTruthy();
  });
});

describe('CaseView', () => {
  const closed = { status: 'closed' as const, endedAt: '2026-10-30T07:03:00.000Z' };

  it('shows the caption parties for a local repository', () => {
    render(<CaseView record={makeCase({ ...closed, repoPath: '/home/me/tinysemver/' })} />);
    const caption = screen.getByRole('group', { name: 'Caption' });
    expect(within(caption).getByText('THE MAINTAINERS OF TINYSEMVER,')).toBeTruthy();
    expect(within(caption).getByText('PULL REQUEST bbbbbbb, “Add range support,”')).toBeTruthy();
    expect(within(caption).getByText('v.')).toBeTruthy();
    expect(within(caption).getByText('KC-2026-CASE1')).toBeTruthy();
    expect(screen.getByText('sitting in review of tinysemver')).toBeTruthy();
  });

  it('labels each count PROVEN, DISMISSED or PENDING and shows locations only for live counts', () => {
    const record = makeCase({
      status: 'deliberation',
      charges: [makeCharge('c1', { line: 7 }), makeCharge('c2'), makeCharge('c3', { file: 'src/b.js', line: null })],
      evidence: [makeEvidence('c1', true), makeEvidence('c2', false), makeEvidence('c3', true)],
      rulings: [
        { chargeId: 'c1', decision: 'convicted', reason: 'proven' },
        { chargeId: 'c2', decision: 'dismissed', reason: 'Inadmissible: passes on head 3/3.' },
      ],
    });
    render(<CaseView record={record} />);
    expect(countItem(1).textContent).toBe('Count 1. claim c1 src/a.js:7 PROVEN');
    expect(countItem(2).textContent).toBe('Count 2. claim c2 DISMISSED');
    expect(countItem(3).textContent).toBe('Count 3. claim c3 src/b.js PENDING');
    expect(within(countItem(1)).getByText('PROVEN').className).toBe('count-status');
    expect(countItem(3).className).toContain('count-pending');
    expect(screen.getByRole('heading', { name: 'II. The Evidence on Counts 1 and 3' })).toBeTruthy();
    expect(section('IV. Findings of the Court').textContent).toContain('On Count 3: the judge has not ruled yet.');
  });

  it('numbers exhibits across several proven counts and shows the changed lines at each', () => {
    const patch = [
      'diff --git a/src/a.js b/src/a.js',
      '--- a/src/a.js',
      '+++ b/src/a.js',
      '@@ -1,4 +1,4 @@',
      ' function f(n) {',
      '-  const end = n;',
      '+  const end = n - 1;',
      '   return end;',
      ' }',
      '',
    ].join('\n');
    const record = makeCase({
      ...closed,
      patch,
      charges: [makeCharge('c1', { line: 2 }), makeCharge('c2', { line: 3 })],
      evidence: [makeEvidence('c1', true), makeEvidence('c2', true, { base: ['pass', 'pass'], head: ['fail', 'fail'] })],
      rulings: [
        { chargeId: 'c1', decision: 'convicted', reason: 'r1' },
        { chargeId: 'c2', decision: 'convicted', reason: 'r2' },
      ],
    });
    render(<CaseView record={record} />);
    const evidence = section('II. The Evidence on Counts 1 and 2');
    expect(within(evidence).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Count 1', 'Count 2']);
    expect(Array.from(evidence.querySelectorAll('.exhibit')).map((e) => e.textContent)).toEqual([
      'EXHIBIT 1',
      'EXHIBIT 2',
      'EXHIBIT 3',
      'EXHIBIT 4',
      'EXHIBIT 5',
      'EXHIBIT 6',
    ]);
    expect(evidence.textContent).toContain('The court ran it twice on the code before the change and twice after.');
    const second = within(evidence).getByRole('table', { name: 'Exhibit 4: record of trial runs' });
    expect(within(second).queryByText('With the fix')).toBeNull();
    expect(within(within(second).getByText('After the change').closest('tr')!).getAllByText('—')).toHaveLength(1);
    const issue = evidence.querySelector('.lines-at-issue')!;
    expect(issue.textContent).toBe(
      '  function f(n) {\n    const end = n;     ← removed by this change\n    const end = n - 1;     ← added by this change\n    return end;',
    );
  });

  it('dismisses counts in plain language, one reason per kind of failed proof', () => {
    const ev = (chargeId: string, reason: string, overrides: Partial<Evidence> = {}) =>
      makeEvidence(chargeId, false, { reason, ...overrides });
    const ids = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'];
    const record = makeCase({
      ...closed,
      charges: ids.map((id) => makeCharge(id)),
      evidence: [
        ev('c1', 'witness passes on head: no bug demonstrated'),
        ev('c2', 'witness also fails on base: pre-existing behaviour, not introduced by this change'),
        ev('c3', 'witness is broken (errors on base)', { base: ['error'], head: ['error'] }),
        ev('c4', 'flaky witness (head 2/3 fail, base 3/3 pass)'),
        ev('c5', 'witness rejected before running: depends on time or randomness', { base: [], head: [] }),
        ev('c6', 'witness violated the sandbox on head'),
        ev('c7', 'witness timed out'),
        makeEvidence('c8', true),
      ],
      rulings: [{ chargeId: 'c8', decision: 'dismissed', reason: 'The behaviour change is announced in the pull request.' }],
    });
    render(<CaseView record={record} />);
    const findings = section('IV. Findings of the Court');
    expect(findings.textContent).toContain(
      'On Counts 1 to 7: dismissed without trial. Count 1’s test passed on the new code. Count 2’s test gave the same result before the change. Count 3’s test could not run. Count 4’s test was not consistent. Count 5’s test checked the wrong thing. Count 6’s test tried something not allowed. Count 7’s test did not finish in time.',
    );
    expect(findings.textContent).toContain(
      'On Count 8: dismissed after hearing. The behaviour change is announced in the pull request.',
    );
    expect(headline()).toBe('Not guilty. All 8 counts dismissed.');
  });

  it('enters a not-guilty judgment when nothing is proven', () => {
    const record = makeCase({
      ...closed,
      charges: [makeCharge('c1'), makeCharge('c2'), makeCharge('c3')],
      evidence: [makeEvidence('c1', false), makeEvidence('c2', false), makeEvidence('c3', false)],
    });
    render(<CaseView record={record} />);
    expect(headline()).toBe('Not guilty. All 3 counts dismissed for want of evidence.');
    expect(judgmentBox().className).toContain('judgment-not-guilty');
    expect(judgmentBox().querySelector('.plain')?.textContent).toBe(
      'In plain words: Nothing in this change was proven to break.',
    );
    expect(within(judgmentBox()).queryByRole('button')).toBeNull();
    expect(screen.getByRole('heading', { name: 'II. The Evidence' })).toBeTruthy();
    expect(section('II. The Evidence').textContent).toContain('No count was proven, so the court sets out no evidence.');
    expect(section('III. The Defense').textContent).toContain('No count was proven, so the defense had nothing to answer.');
    expect(section('V. Order').textContent).toContain('No remedy is ordered. Nothing was proven, so there is nothing to fix.');
  });

  it('orders a verified remedy and shows its patch', () => {
    const record = makeCase({
      ...closed,
      charges: [makeCharge('c1')],
      evidence: [makeEvidence('c1', true)],
      rulings: [{ chargeId: 'c1', decision: 'convicted', reason: 'r1' }],
      remedy: makeRemedy(),
    });
    render(<CaseView record={record} />);
    const order = section('V. Order');
    expect(within(order).getByText(/^It is ordered/).textContent).toBe(
      'It is ordered that the following remedy be applied. The court re-ran Exhibit 1 on the remedied code (3 of 3 pass) and the library’s own 4 tests (all pass).',
    );
    expect(order.querySelector('.fix-patch')?.textContent).toBe('- const end = n - 1;\n+ const end = n;');
    expect(within(judgmentBox()).getByRole('button', { name: 'Apply the ordered fix' })).toBeTruthy();
  });

  it('orders no remedy when there is none, and says so plainly', () => {
    const record = makeCase({
      ...closed,
      charges: [makeCharge('c1')],
      evidence: [makeEvidence('c1', true)],
      rulings: [{ chargeId: 'c1', decision: 'convicted', reason: 'r1' }],
      remedy: null,
    });
    render(<CaseView record={record} />);
    const order = section('V. Order');
    expect(within(order).getByText(/^No remedy is ordered/).textContent).toBe(
      'No remedy is ordered. The court has no tested fix for this change.',
    );
    expect(order.querySelector('.fix-patch')).toBeNull();
    expect(within(order).getByText('So ordered.')).toBeTruthy();
    expect(judgmentBox().textContent).toContain('No tested fix is available.');
    expect(within(judgmentBox()).queryByRole('button', { name: 'Apply the ordered fix' })).toBeNull();
    expect(within(judgmentBox()).getByRole('button', { name: 'Copy repro command' })).toBeTruthy();
    expect(screen.queryByText('With the fix')).toBeNull();
  });

  it('orders no remedy when the proposed fix failed verification', () => {
    const record = makeCase({
      ...closed,
      charges: [makeCharge('c1')],
      evidence: [makeEvidence('c1', true)],
      rulings: [{ chargeId: 'c1', decision: 'convicted', reason: 'r1' }],
      remedy: makeRemedy({
        verified: false,
        suite: 'fail',
        witnesses: [{ chargeId: 'c1', outcomes: ['pass', 'fail', 'pass'] }],
      }),
    });
    render(<CaseView record={record} />);
    const order = section('V. Order');
    expect(within(order).getByText(/^No remedy is ordered/).textContent).toBe(
      'No remedy is ordered. A fix was proposed, but it did not pass the court’s tests: on the fixed code, Exhibit 1 gave 2 of 3 pass, and the library’s own 4 tests failed.',
    );
    expect(order.querySelector('.fix-patch')).toBeNull();
    expect(judgmentBox().textContent).toContain('A fix was tried, but it did not pass the court’s tests.');
    expect(within(judgmentBox()).queryByRole('button', { name: 'Apply the ordered fix' })).toBeNull();
    const fixRow = screen.getByText('With the fix').closest('tr')!;
    expect(within(fixRow).getByText('FAIL').className).toBe('cell fail');
  });

  it('reports a mistrial plainly', () => {
    render(<CaseView record={makeCase({ status: 'error', error: 'git exploded', endedAt: '2026-10-30T07:01:00.000Z' })} />);
    expect(headline()).toBe('Mistrial. The case could not be finished.');
    expect(screen.getByRole('alert').textContent).toBe('The court reports an error: git exploded');
    expect(screen.getByText('Not entered: the case did not finish')).toBeTruthy();
  });
});

describe('BenchPage (court record)', () => {
  const sample = parseBench(readDemo('bench.json'));

  it('flags sample data and lays out the headline results, reviewers and cases', async () => {
    render(<BenchPage source={fakeSource([], { bench: sample }).source} />);
    const banner = await screen.findByRole('note', { name: 'Sample data' });
    expect(banner.textContent).toMatch(/not real benchmark results/);
    expect(screen.getByText('Record of 25 trials, tinysemver')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Does demanding proof make code review more trustworthy?',
    );
    const stats = screen.getByRole('group', { name: 'Headline results' });
    expect(within(stats).getByText('56%')).toBeTruthy();
    expect(within(stats).getByText('single reviewer: 36%')).toBeTruthy();
    expect(within(stats).getByText('0.08')).toBeTruthy();
    expect(within(stats).getAllByText(/^\$0\.0\d{3}$/)).toHaveLength(1);

    const table = screen.getByRole('table', { name: 'Results by reviewer' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Reviewer',
      'Convicted',
      'False accusations',
      'Precision',
      'Cost / case',
      'Median time',
    ]);
    expect(within(table).getAllByRole('rowheader').map((h) => h.textContent)).toEqual([
      'Kacheri Court (proof required)',
      'Single reviewer, Nemotron Super',
    ]);
    expect(within(table).getByRole('rowheader', { name: 'Kacheri Court (proof required)' }).closest('tr')!.textContent).toContain(
      '14 of 25',
    );
    expect(screen.getByRole('heading', { name: 'II. The cases before the court' })).toBeTruthy();
    expect(screen.getByText('25 planted bugs.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'III. Method' }).nextElementSibling?.textContent).toContain(
      'These sample numbers are placeholders, not recorded runs.',
    );
  });

  it('reads real runner output: three reviewers, kinds of case, innocent changes excluded from the hit rate', async () => {
    const r = (itemId: string, system: string, kind: string, hit: boolean, falsePositives: number) => ({
      itemId,
      system,
      kind,
      hit,
      falsePositives,
      findings: falsePositives + (hit ? 1 : 0),
      convicted: system === 'court' ? falsePositives + (hit ? 1 : 0) : 0,
      costUsd: 0.01,
      latencyMs: 1000,
    });
    const data = parseBench([
      r('m1', 'court', 'mutant', true, 0),
      r('h1', 'court', 'historical', false, 0),
      r('k1', 'court', 'clean', false, 0),
      r('m1', 'baseline', 'mutant', true, 2),
      r('h1', 'baseline', 'historical', true, 1),
      r('k1', 'baseline', 'clean', false, 3),
      r('m1', 'baseline-ultra', 'mutant', true, 1),
      r('h1', 'baseline-ultra', 'historical', false, 0),
      r('k1', 'baseline-ultra', 'clean', false, 1),
    ]);
    render(<BenchPage source={fakeSource([], { bench: data }).source} />);
    const stats = await screen.findByRole('group', { name: 'Headline results' });
    expect(screen.queryByRole('note', { name: 'Sample data' })).toBeNull();
    expect(screen.getByText('Record of 3 trials')).toBeTruthy();
    expect(within(stats).getByText('50%')).toBeTruthy();
    expect(within(stats).getByText('single reviewer: 100%')).toBeTruthy();
    expect(within(stats).getByText('0.00')).toBeTruthy();
    expect(within(stats).getByText('single reviewer: 2.00')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Results by reviewer' });
    const ultra = within(table).getByRole('rowheader', { name: 'Single reviewer, Nemotron Ultra' }).closest('tr')!;
    expect(ultra.textContent).toContain('1 of 2');
    expect(screen.getByText('1 planted bug.')).toBeTruthy();
    expect(screen.getByText('1 real regression.')).toBeTruthy();
    expect(screen.getByText('1 innocent change.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'III. Method' }).nextElementSibling?.textContent).toContain(
      'All results come from recorded runs and can be replayed.',
    );
  });

  it('reports missing results', async () => {
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
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Docket', 'Court record', 'Board']);
    expect(within(nav).getByRole('link', { name: 'Board' }).getAttribute('aria-current')).toBe('page');

    act(() => {
      window.history.replaceState(null, '', '#/court');
      window.dispatchEvent(new Event('hashchange'));
    });
    fireEvent.click(await screen.findByRole('link', { name: 'First case' }));
    expect(window.location.hash).toBe('#/court/k1');
    expect(await screen.findByRole('article', { name: 'Case First case' })).toBeTruthy();

    act(() => {
      window.history.replaceState(null, '', '#/bench');
      window.dispatchEvent(new Event('hashchange'));
    });
    expect(await screen.findByText('No benchmark results published yet.')).toBeTruthy();
    expect(
      within(screen.getByRole('navigation', { name: 'Sections' })).getByRole('link', { name: 'Court record' }).getAttribute('aria-current'),
    ).toBe('page');
  });

  it('hides the board in demo mode and has no theme switch', () => {
    const { source } = fakeSource([], { demo: true });
    render(<Root api={null} court={source} />);
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    expect(within(nav).queryByText('Board')).toBeNull();
    expect(within(nav).getByRole('link', { name: 'Docket' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('button', { name: /theme|dark|light/i })).toBeNull();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(screen.getByText('Judges: NVIDIA Nemotron on Nebius Token Factory')).toBeTruthy();
  });
});
