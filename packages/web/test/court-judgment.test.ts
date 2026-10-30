import { describe, expect, it } from 'vitest';
import type { CaseRecord } from '@kacheri/shared';
import {
  afterColon,
  caseNumber,
  chargedExcerpt,
  countList,
  defendant,
  dismissal,
  evidenceFault,
  exhibitList,
  heardChargeIds,
  judgment,
  longDate,
  orderText,
  patchExcerpt,
  plaintiff,
  planExhibits,
  possessive,
  repoLabel,
  stageText,
  suiteTestCount,
  timesWord,
} from '../src/court/judgment';
import { applyCommand } from '../src/court/repro';
import { makeCase, makeCharge, makeEvidence, makeRemedy, makeUsage, readDemo } from './court-fixtures';

const demo = readDemo<CaseRecord>('cases/demo-1.json');

describe('caption and wording helpers', () => {
  it('names the parties and the case number from the record', () => {
    expect(plaintiff(demo)).toBe('THE MAINTAINERS OF NORMALIZE-URL');
    expect(defendant(demo)).toBe('PULL REQUEST ec3ab37, “Refactor URL normalization edge handling,”');
    expect(caseNumber(demo)).toBe('KC-2026-0014');
    expect(caseNumber({ id: 'case_1a2b3c4d', startedAt: '2026-10-30T07:00:00.000Z' })).toBe('KC-2026-1A2B3C4D');
    expect(caseNumber({ id: 'kc-2026-0003', startedAt: '' })).toBe('KC-2026-0003');
    expect(plaintiff({ repoPath: 'C:\\work\\tinysemver\\' })).toBe('THE MAINTAINERS OF TINYSEMVER');
    expect(repoLabel('sindresorhus/normalize-url')).toBe('sindresorhus/normalize-url');
    expect(repoLabel('/tmp/fixtures/normalize-url/')).toBe('normalize-url');
    expect(defendant({ headRef: 'feature-branch', title: ' Add range support ' })).toBe(
      'PULL REQUEST feature-branch, “Add range support,”',
    );
  });

  it('lists counts and exhibits the way a court writes them', () => {
    expect(countList([1])).toBe('Count 1');
    expect(countList([1, 3])).toBe('Counts 1 and 3');
    expect(countList([4, 2, 3])).toBe('Counts 2 to 4');
    expect(countList([1, 2, 3, 5])).toBe('Counts 1 to 3 and 5');
    expect(countList([1, 3, 5])).toBe('Counts 1, 3 and 5');
    expect(countList([])).toBe('');
    expect(exhibitList([1, 4])).toBe('Exhibits 1 and 4');
    expect(timesWord(1)).toBe('once');
    expect(timesWord(2)).toBe('twice');
    expect(timesWord(3)).toBe('three times');
    expect(timesWord(12)).toBe('12 times');
    expect(longDate('2026-10-30T07:14:51.903Z')).toBe('30 October 2026');
    expect(longDate('nope')).toBe('');
    expect(afterColon('The test is sound.')).toBe('the test is sound.');
    expect(afterColon('I agree.')).toBe('I agree.');
    expect(afterColon('PR #4 says so.')).toBe('PR #4 says so.');
    expect(possessive(2, 'its test could not run')).toBe('Count 2’s test could not run.');
    expect(suiteTestCount('ℹ tests 25\nℹ pass 25\n')).toBe(25);
    expect(suiteTestCount('# tests 3\n')).toBe(3);
    expect(suiteTestCount('ok')).toBeNull();
  });
});

describe('plain-language dismissal reasons', () => {
  const ev = (reason: string, base = ['pass'], head = ['pass']) =>
    evidenceFault({ reason, base: base as never, head: head as never });

  it('maps every reason the court gives to one plain sentence', () => {
    expect(ev('witness passes on head: no bug demonstrated')).toBe('passes-on-head');
    expect(ev('witness also fails on base: pre-existing behaviour, not introduced by this change')).toBe('fails-on-base');
    expect(ev('witness is broken (errors on base)')).toBe('broken');
    expect(ev('witness is broken (errors on head)')).toBe('broken');
    expect(ev('witness timed out')).toBe('timeout');
    expect(ev('flaky witness (head 2/3 fail, base 3/3 pass)')).toBe('flaky');
    expect(ev('witness rejected before running: does not import the code under test')).toBe('lint');
    expect(ev('witness violated the sandbox on head')).toBe('sandbox');
  });

  it('falls back to the run outcomes for unfamiliar wording', () => {
    expect(ev('?', ['pass'], ['pass', 'pass'])).toBe('passes-on-head');
    expect(ev('?', ['fail'], ['fail'])).toBe('fails-on-base');
    expect(ev('?', ['error'], [])).toBe('broken');
    expect(ev('?', ['pass'], ['timeout'])).toBe('timeout');
    expect(ev('?', ['pass'], ['fail', 'pass'])).toBe('flaky');
  });

  it('uses the judge’s reason for counts dismissed after a hearing, and nothing for proven counts', () => {
    const record = makeCase({
      status: 'closed',
      charges: [makeCharge('c1'), makeCharge('c2'), makeCharge('c3'), makeCharge('c4')],
      evidence: [makeEvidence('c1', true), makeEvidence('c2', true), makeEvidence('c3', false)],
      rulings: [
        { chargeId: 'c1', decision: 'convicted', reason: 'proven' },
        { chargeId: 'c2', decision: 'dismissed', reason: 'Intended behaviour.' },
      ],
    });
    expect(dismissal(record, 'c1')).toBeNull();
    expect(dismissal(record, 'c2')).toEqual({ kind: 'judge', text: 'Intended behaviour.' });
    expect(dismissal(record, 'c3')).toEqual({ kind: 'passes-on-head', text: 'its test passed on the new code' });
    expect(dismissal(record, 'c4')).toEqual({ kind: 'unheard', text: 'its test was never run' });
  });
});

describe('judgment', () => {
  it('matches the approved mockup for the demo case', () => {
    expect(judgment(demo)).toEqual({
      standing: 'guilty',
      headline: 'Guilty on Count 1. Counts 2 to 4 dismissed for want of evidence.',
      plain:
        'this change breaks one thing, proven by a test that fails. The other three concerns had no working proof, so they are not counted. A fix has been tested and is ready.',
    });
  });

  it('enters not guilty when nothing is proven', () => {
    const closed = (n: number) =>
      makeCase({
        status: 'closed',
        charges: Array.from({ length: n }, (_, i) => makeCharge(`c${i + 1}`)),
        evidence: Array.from({ length: n }, (_, i) => makeEvidence(`c${i + 1}`, false)),
      });
    expect(judgment(closed(4))).toEqual({
      standing: 'not-guilty',
      headline: 'Not guilty. All 4 counts dismissed for want of evidence.',
      plain: 'Nothing in this change was proven to break.',
    });
    expect(judgment(closed(1)).headline).toBe('Not guilty. Count 1 dismissed for want of evidence.');
    expect(judgment(closed(0)).headline).toBe('Not guilty. No charges were filed.');
  });

  it('drops "for want of evidence" when the judge dismissed a count that had proof', () => {
    const record = makeCase({
      status: 'closed',
      charges: [makeCharge('c1'), makeCharge('c2'), makeCharge('c3')],
      evidence: [makeEvidence('c1', true), makeEvidence('c2', true), makeEvidence('c3', true)],
      rulings: [
        { chargeId: 'c1', decision: 'convicted', reason: 'r1' },
        { chargeId: 'c2', decision: 'convicted', reason: 'r2' },
        { chargeId: 'c3', decision: 'dismissed', reason: 'intended' },
      ],
      remedy: makeRemedy({ verified: false }),
    });
    const j = judgment(record);
    expect(j.headline).toBe('Guilty on Counts 1 and 2. Count 3 dismissed.');
    expect(j.plain).toBe(
      'this change breaks two things, proven by tests that fail. The other concern was not proven, so it is not counted. A fix was tried, but it did not pass the court’s tests.',
    );
  });

  it('reports a mistrial and a case in session', () => {
    expect(judgment(makeCase({ status: 'error' })).standing).toBe('mistrial');
    const live = judgment(makeCase({ status: 'filing' }));
    expect(live.standing).toBe('in-session');
    expect(live.headline).toBe('The prosecution is writing proof tests…');
  });
});

describe('stageText', () => {
  const charges = [makeCharge('c1'), makeCharge('c2'), makeCharge('c3'), makeCharge('c4')];

  it('names the current step of a live case in plain words', () => {
    expect(stageText(makeCase({ status: 'filing' }))).toBe('The prosecution is writing proof tests…');
    expect(stageText(makeCase({ status: 'trial', charges }))).toBe('The court is running test 1 of 24…');
    expect(stageText(makeCase({ status: 'trial', charges, evidence: [makeEvidence('c1', true)] }))).toBe(
      'The court is running test 7 of 24…',
    );
    expect(stageText(makeCase({ status: 'trial' }))).toBe('The court is running the tests…');
    const evidence = [makeEvidence('c1', true), makeEvidence('c2', false)];
    const deliberation = makeCase({ status: 'deliberation', charges, evidence });
    expect(stageText(deliberation)).toBe('The defense is responding…');
    expect(stageText({ ...deliberation, usage: [makeUsage({ tier: 'ultra', role: 'judge' })] })).toBe('The judge is deciding…');
    const defended = { ...deliberation, rebuttals: [{ chargeId: 'c1', argument: 'no', concedes: false }] };
    expect(stageText(defended)).toBe('The judge is deciding…');
    const convicted = { ...defended, rulings: [{ chargeId: 'c1', decision: 'convicted' as const, reason: 'r' }] };
    expect(stageText(convicted)).toBe('The court is testing the fix…');
  });
});

describe('exhibits and order', () => {
  it('excerpts the line at issue with the removed check, dedented', () => {
    const excerpt = chargedExcerpt(demo.patch, demo.charges[0]);
    expect(excerpt).toEqual({
      path: 'index.js',
      lines: [
        { kind: 'context', text: "return protocol.endsWith(':')" },
        { kind: 'del', text: "  && !protocol.includes('.')" },
        { kind: 'context', text: '  && !supportedProtocols.has(protocol);' },
      ],
    });
    expect(chargedExcerpt(undefined, demo.charges[0])).toBeNull();
    expect(chargedExcerpt(demo.patch, { file: 'other.js', line: 1 })).toBeNull();
    expect(chargedExcerpt(demo.patch, { file: 'index.js', line: null })?.lines[1]).toEqual({
      kind: 'del',
      text: "  && !protocol.includes('.')",
    });
  });

  it('excerpts the remedy patch with one line of context and marks skipped stretches', () => {
    expect(patchExcerpt(demo.remedy!.patch)).toEqual([
      {
        path: 'index.js',
        lines: [
          { kind: 'context', text: "return protocol.endsWith(':')" },
          { kind: 'add', text: "  && !protocol.includes('.')" },
          { kind: 'context', text: '  && !supportedProtocols.has(protocol);' },
        ],
      },
    ]);
    const two = patchExcerpt(
      ['--- a/x.js', '+++ b/x.js', '@@ -1,6 +1,6 @@', '-a', '+A', ' b', ' c', ' d', ' e', '-f', '+F', ''].join('\n'),
    );
    expect(two[0].lines.map((l) => l.kind)).toEqual(['del', 'add', 'context', 'gap', 'context', 'del', 'add']);
  });

  it('numbers exhibits per heard count and skips the line exhibit when the diff lacks it', () => {
    const plan = planExhibits(demo, heardChargeIds(demo));
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ chargeId: 'c1', count: 1, runs: 1, code: 2, lines: 3 });
    const noPatch = makeCase({
      status: 'closed',
      charges: [makeCharge('c1'), makeCharge('c2')],
      evidence: [makeEvidence('c1', true), makeEvidence('c2', true)],
      rulings: [
        { chargeId: 'c1', decision: 'convicted', reason: 'r' },
        { chargeId: 'c2', decision: 'convicted', reason: 'r' },
      ],
    });
    expect(planExhibits(noPatch, heardChargeIds(noPatch)).map((p) => [p.runs, p.code, p.lines])).toEqual([
      [1, 2, null],
      [3, 4, null],
    ]);
  });

  it('writes the order with and without a remedy', () => {
    const plan = planExhibits(demo, heardChargeIds(demo));
    expect(orderText(demo, plan)).toEqual({
      ordered: true,
      text: 'It is ordered that the following remedy be applied. The court re-ran Exhibit 1 on the remedied code (3 of 3 pass) and the library’s own 25 tests (all pass).',
    });
    expect(orderText({ ...demo, remedy: null }, plan)).toEqual({
      ordered: false,
      text: 'No remedy is ordered. The court has no tested fix for this change.',
    });
    const notRun = { ...demo, remedy: { ...demo.remedy!, suite: 'not_run' as const, suiteLog: '' } };
    expect(orderText(notRun, plan).text).toBe(
      'It is ordered that the following remedy be applied. The court re-ran Exhibit 1 on the remedied code (3 of 3 pass). The library’s own tests were not run.',
    );
    const untested = { ...demo, remedy: { ...demo.remedy!, verified: false, witnesses: [], suite: 'pass' as const } };
    expect(orderText(untested, plan)).toEqual({
      ordered: false,
      text: 'No remedy is ordered. A fix was proposed, but it did not pass the court’s tests: Exhibit 1 was not re-run on the fixed code.',
    });
    expect(orderText({ ...demo, status: 'deliberation' }, plan).text).toBe('The court has not yet made an order.');
    const acquitted = makeCase({ status: 'closed', charges: [makeCharge('c1')], evidence: [makeEvidence('c1', false)] });
    expect(orderText(acquitted, []).text).toBe('No remedy is ordered. Nothing was proven, so there is nothing to fix.');
  });

  it('builds a git apply command for the ordered fix', () => {
    expect(applyCommand('diff\n')).toBe("git apply <<'KACHERI_FIX'\ndiff\nKACHERI_FIX");
    expect(applyCommand('diff')).toBe("git apply <<'KACHERI_FIX'\ndiff\nKACHERI_FIX");
  });
});
