import { describe, expect, it } from 'vitest';
import type { BenchResult, CaseRecord } from '@kacheri/shared';
import { MODELS } from '@kacheri/shared';
import { anchorKey, locateLine, patchToDiff, parsePatch } from '../src/diff';
import { benchRows, median, parseBench, summarize } from '../src/court/bench';
import { base64Utf8, reproCommand, shellQuote } from '../src/court/repro';
import { caseToReplay } from '../src/court/replay';
import { applyToRecord, courtReducer, initialCourtState, sortCases } from '../src/court/state';
import {
  caseExtras,
  caseTally,
  caseTotals,
  chargeOutcome,
  convictedChargeIds,
  elapsedMs,
  formatDuration,
  formatTokens,
  formatUsd,
  hasRunFault,
  isFixVerified,
  isoDate,
  modelLineage,
  runSummary,
  shortSha,
  SUITE_LABEL,
} from '../src/court/summary';
import { makeCase, makeCharge, makeEvidence, makeRemedy, makeUsage, readDemo } from './court-fixtures';

describe('courtReducer', () => {
  it('loads cases and applies streamed events by id', () => {
    let s = courtReducer(initialCourtState, { type: 'cases/loaded', cases: [makeCase()] });
    const ev = (event: Parameters<typeof applyToRecord>[1]) => (s = courtReducer(s, { type: 'event', event }));
    ev({ type: 'charge', caseId: 'case1', charge: makeCharge('c1') });
    ev({ type: 'charge', caseId: 'case1', charge: makeCharge('c2') });
    ev({ type: 'charge', caseId: 'case1', charge: makeCharge('c1', { claim: 'updated' }) });
    ev({ type: 'evidence', caseId: 'case1', evidence: makeEvidence('c1', true) });
    ev({ type: 'rebuttal', caseId: 'case1', rebuttal: { chargeId: 'c1', argument: 'no', concedes: false } });
    ev({ type: 'ruling', caseId: 'case1', ruling: { chargeId: 'c1', decision: 'convicted', reason: 'r' } });
    ev({ type: 'usage', caseId: 'case1', usage: makeUsage() });
    ev({ type: 'usage', caseId: 'case1', usage: makeUsage() });
    const remedy = makeRemedy();
    ev({ type: 'remedy', caseId: 'case1', remedy });
    const rec = s.cases.case1;
    expect(rec.remedy).toBe(remedy);
    expect(rec.charges.map((c) => c.claim)).toEqual(['updated', 'claim c2']);
    expect(rec.evidence).toHaveLength(1);
    expect(rec.rebuttals).toHaveLength(1);
    expect(rec.rulings[0].decision).toBe('convicted');
    expect(rec.usage).toHaveLength(2);
  });

  it('replaces the record on a case event and ignores events for unknown cases', () => {
    const before = courtReducer(initialCourtState, { type: 'cases/loaded', cases: [makeCase()] });
    const after = courtReducer(before, {
      type: 'event',
      event: { type: 'charge', caseId: 'nope', charge: makeCharge('c1') },
    });
    expect(after).toBe(before);
    const created = courtReducer(before, { type: 'event', event: { type: 'case', record: makeCase({ id: 'case2' }) } });
    expect(Object.keys(created.cases).sort()).toEqual(['case1', 'case2']);
    const closed = courtReducer(created, {
      type: 'event',
      event: { type: 'case', record: makeCase({ status: 'closed' }) },
    });
    expect(closed.cases.case1.status).toBe('closed');
  });

  it('sorts cases newest first', () => {
    const cases = { a: makeCase({ id: 'a', startedAt: '2026-01-01T00:00:00Z' }), b: makeCase({ id: 'b', startedAt: '2026-02-01T00:00:00Z' }) };
    expect(sortCases(cases).map((c) => c.id)).toEqual(['b', 'a']);
  });
});

describe('case summary', () => {
  it('totals cost and tokens per tier', () => {
    const t = caseTotals([
      makeUsage({ promptTokens: 100, completionTokens: 50, costUsd: 0.001 }),
      makeUsage({ tier: 'ultra', role: 'judge', promptTokens: 2000, completionTokens: 1000, costUsd: 0.005 }),
    ]);
    expect(t.costUsd).toBeCloseTo(0.006);
    expect(t.tokens.nano).toEqual({ prompt: 100, completion: 50, calls: 1 });
    expect(t.tokens.super).toEqual({ prompt: 0, completion: 0, calls: 0 });
    expect(t.tokens.ultra.calls).toBe(1);
  });

  it('formats money, tokens and durations', () => {
    expect(formatUsd(0.02177014)).toBe('$0.0218');
    expect(formatUsd(0)).toBe('$0.0000');
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(31718)).toBe('31.7k');
    expect(formatDuration(12_400)).toBe('12.4s');
    expect(formatDuration(161_591)).toBe('2m 41s');
    expect(formatDuration(3_725_000)).toBe('1h 02m 05s');
  });

  it('measures elapsed time against now while the case is open', () => {
    const open = makeCase({ startedAt: '2026-10-30T07:00:00.000Z' });
    expect(elapsedMs(open, Date.parse('2026-10-30T07:00:05.000Z'))).toBe(5000);
    const closed = makeCase({ endedAt: '2026-10-30T07:01:00.000Z' });
    expect(elapsedMs(closed, Date.parse('2027-01-01T00:00:00Z'))).toBe(60_000);
  });

  it('derives outcomes: ruling wins, inadmissible is dismissed once closed, otherwise pending', () => {
    const rec = makeCase({
      charges: [makeCharge('c1'), makeCharge('c2'), makeCharge('c3')],
      evidence: [makeEvidence('c1', true), makeEvidence('c2', false)],
      rulings: [{ chargeId: 'c1', decision: 'convicted', reason: 'proved' }],
      status: 'deliberation',
    });
    expect(chargeOutcome(rec, 'c1')).toEqual({ state: 'convicted', reason: 'proved', inadmissible: false });
    expect(chargeOutcome(rec, 'c2')).toEqual({ state: 'pending' });
    const closed = { ...rec, status: 'closed' as const };
    expect(chargeOutcome(closed, 'c2')).toEqual({
      state: 'dismissed',
      inadmissible: true,
      reason: 'Inadmissible: passes on head 3/3',
    });
    expect(caseTally(closed)).toEqual({ convicted: 1, dismissed: 2, inadmissible: 1, pending: 0 });
  });

  it('summarizes runs, shortens SHAs and formats dates for the register and docket', () => {
    expect(runSummary(['pass', 'pass', 'pass'])).toBe('3/3 pass');
    expect(runSummary(['fail', 'pass', 'fail'])).toBe('2/3 fail, 1/3 pass');
    expect(runSummary([])).toBe('no runs');
    expect(hasRunFault(['pass', 'timeout'])).toBe(true);
    expect(hasRunFault(['pass', 'fail'])).toBe(false);
    expect(shortSha('4f1c2a9e7b3d58c0a6e91f2d7c4b8a05e3f6d912')).toBe('4f1c2a9');
    expect(shortSha('main')).toBe('main');
    expect(isoDate('2026-10-29T18:44:48.902Z')).toBe('2026-10-29');
    expect(isoDate('not a date')).toBe('');
    expect(isoDate(null)).toBe('');
  });

  it('derives the model lineage from usage and adds the remedy tier when present', () => {
    const labels = (rec: Pick<CaseRecord, 'usage' | 'remedy'>) => modelLineage(rec).map((s) => s.label);
    expect(labels(makeCase())).toEqual(['Nano', 'Super', 'Ultra']);
    const nano = [makeUsage(), makeUsage(), makeUsage()];
    expect(labels(makeCase({ usage: nano }))).toEqual(['Nano ×3', 'Super', 'Ultra']);
    expect(labels(makeCase({ usage: nano.slice(0, 1) }))).toEqual(['Nano ×1', 'Super', 'Ultra']);
    const fix = modelLineage(makeCase({ usage: nano.slice(0, 2), remedy: makeRemedy() }));
    expect(fix.map((s) => s.label)).toEqual(['Nano ×2', 'Super', 'Ultra', 'Super (fix)']);
    expect(fix[3]).toEqual({ key: 'remedy', tier: 'super', label: 'Super (fix)' });
    expect(new Set(fix.map((s) => s.key)).size).toBe(fix.length);
    // remedy usage alone (the fix is still being verified) already shows the tier
    expect(labels(makeCase({ usage: [makeUsage({ tier: 'super', role: 'remedy' })], remedy: null }))).toEqual([
      'Nano',
      'Super',
      'Ultra',
      'Super (fix)',
    ]);
  });

  it('marks a fix verified only on convicted charges the verified remedy addresses', () => {
    const rec = makeCase({
      status: 'closed',
      charges: [makeCharge('c1'), makeCharge('c2')],
      evidence: [makeEvidence('c1', true), makeEvidence('c2', true)],
      rulings: [
        { chargeId: 'c1', decision: 'convicted', reason: 'r1' },
        { chargeId: 'c2', decision: 'dismissed', reason: 'r2' },
      ],
      remedy: makeRemedy({ chargeIds: ['c1', 'c2'] }),
    });
    expect(convictedChargeIds(rec)).toEqual(['c1']);
    expect(isFixVerified(rec, 'c1')).toBe(true);
    expect(isFixVerified(rec, 'c2')).toBe(false);
    expect(isFixVerified({ ...rec, remedy: makeRemedy({ verified: false }) }, 'c1')).toBe(false);
    expect(isFixVerified({ ...rec, remedy: makeRemedy({ chargeIds: ['c9'] }) }, 'c1')).toBe(false);
    expect(isFixVerified({ ...rec, remedy: null }, 'c1')).toBe(false);
    expect(SUITE_LABEL).toEqual({ pass: 'PASS', fail: 'FAIL', not_run: 'NOT RUN' });
  });

  it('reads optional patch/description extras defensively', () => {
    expect(caseExtras(makeCase())).toEqual({ patch: undefined, description: undefined });
    const rec = { ...makeCase(), patch: 'diff', description: 7 } as unknown as CaseRecord;
    expect(caseExtras(rec)).toEqual({ patch: 'diff', description: undefined });
  });
});

describe('reproCommand', () => {
  it('checks out head, writes the witness byte-for-byte and runs it', () => {
    const code = "assert.equal(f('it\\'s'), '✓');\n";
    const cmd = reproCommand({ headRef: 'b'.repeat(40) }, { witnessPath: '__kacheri__/c1.test.mjs', witnessCode: code });
    const lines = cmd.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe(`git checkout --detach '${'b'.repeat(40)}'`);
    expect(lines[3]).toBe("node --test '__kacheri__/c1.test.mjs' # expected: FAIL on head");
    const encoded = /Buffer\.from\('\\''([A-Za-z0-9+/=]+)'\\''/.exec(lines[2]);
    expect(encoded).not.toBeNull();
    expect(Buffer.from(encoded![1], 'base64').toString('utf8')).toBe(code);
    expect(base64Utf8('✓')).toBe(Buffer.from('✓').toString('base64'));
    expect(shellQuote("a'b")).toBe("'a'\\''b'");
  });
});

describe('caseToReplay', () => {
  const record = makeCase({
    status: 'closed',
    endedAt: '2026-10-30T07:03:00.000Z',
    charges: [makeCharge('c1'), makeCharge('c2')],
    evidence: [makeEvidence('c1', true), makeEvidence('c2', false)],
    rebuttals: [{ chargeId: 'c1', argument: 'fine', concedes: true }],
    rulings: [
      { chargeId: 'c1', decision: 'convicted', reason: 'r1' },
      { chargeId: 'c2', decision: 'dismissed', reason: 'r2' },
    ],
    usage: [makeUsage(), makeUsage({ tier: 'super', role: 'defense' }), makeUsage({ tier: 'ultra', role: 'judge' })],
  });

  it('streams filing, trial, defense and ruling in order, ending with the original record', () => {
    const steps = caseToReplay(record, '2026-11-01T00:00:00.000Z');
    const types = steps.map((s) => s.event.type);
    expect(types).toEqual([
      'case',
      'usage',
      'charge',
      'charge',
      'case',
      'evidence',
      'evidence',
      'case',
      'usage',
      'rebuttal',
      'usage',
      'ruling',
      'ruling',
      'case',
    ]);
    const first = steps[0].event;
    expect(first.type === 'case' && first.record).toMatchObject({ status: 'filing', charges: [], endedAt: null, startedAt: '2026-11-01T00:00:00.000Z' });
    const statuses = steps.flatMap((s) => (s.event.type === 'case' ? [s.event.record.status] : []));
    expect(statuses).toEqual(['filing', 'trial', 'deliberation', 'closed']);
    const last = steps[steps.length - 1].event;
    expect(last.type === 'case' && last.record).toBe(record);
    expect(steps[0].delayMs).toBe(0);
    expect(steps.slice(1).every((s) => s.delayMs > 0)).toBe(true);
  });

  it('holds back the remedy and its usage until after the rulings', () => {
    const remedy = makeRemedy();
    const withRemedy = { ...record, remedy, usage: [...record.usage, makeUsage({ tier: 'super', role: 'remedy' })] };
    const steps = caseToReplay(withRemedy, '2026-11-01T00:00:00.000Z');
    const first = steps[0].event;
    expect(first.type === 'case' && first.record.remedy).toBeNull();
    expect(steps.slice(-4).map((s) => s.event.type)).toEqual(['ruling', 'usage', 'remedy', 'case']);
    const ev = steps[steps.length - 2].event;
    expect(ev.type === 'remedy' && ev.remedy).toBe(remedy);
    const deliberation = steps.filter((s) => s.event.type === 'case' && s.event.record.status !== 'closed');
    expect(deliberation.every((s) => s.event.type === 'case' && s.event.record.remedy === null)).toBe(true);
  });

  it('intermediate snapshots accumulate what was streamed so far', () => {
    const steps = caseToReplay(record, '2026-11-01T00:00:00.000Z');
    const trial = steps.find((s) => s.event.type === 'case' && s.event.record.status === 'trial')!.event;
    expect(trial.type === 'case' && trial.record.charges.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(trial.type === 'case' && trial.record.usage).toHaveLength(1);
  });
});

describe('bench', () => {
  const r = (o: Partial<BenchResult>): BenchResult => ({
    itemId: 'm1',
    system: 'court',
    findings: 1,
    convicted: 1,
    hit: true,
    falsePositives: 0,
    costUsd: 0.02,
    latencyMs: 100,
    ...o,
  });

  it('accepts a bare array (unflagged) or an object with a sample flag', () => {
    const bare = parseBench([r({})]);
    expect(bare.sample).toBe(false);
    expect(bare.results).toHaveLength(1);
    const flagged = parseBench({ sample: true, label: 'SAMPLE', results: [r({})], items: [{ id: 'm1', file: 'a.js', line: 2 }, 5] });
    expect(flagged.sample).toBe(true);
    expect(flagged.label).toBe('SAMPLE');
    expect(flagged.items).toEqual([{ id: 'm1', repo: '', file: 'a.js', line: 2, operator: '', description: '', patch: undefined }]);
    expect(() => parseBench({ nope: 1 })).toThrow(/results/);
    expect(() => parseBench([{ itemId: 'x' }])).toThrow(/#0/);
  });

  it('summarizes hit rate, false positives, precision, cost and p50 latency', () => {
    const results = [
      r({ itemId: 'm1', hit: true, falsePositives: 0, costUsd: 0.01, latencyMs: 100 }),
      r({ itemId: 'm2', hit: false, falsePositives: 1, costUsd: 0.03, latencyMs: 300 }),
      r({ itemId: 'm1', system: 'baseline', convicted: 0, findings: 4, hit: true, falsePositives: 3, costUsd: 0.004, latencyMs: 10 }),
    ];
    const court = summarize(results, 'court')!;
    expect(court.hitRate).toBe(0.5);
    expect(court.fpPerPr).toBe(0.5);
    expect(court.precision).toBe(0.5);
    expect(court.costPerPr).toBeCloseTo(0.02);
    expect(court.p50LatencyMs).toBe(200);
    expect(summarize(results, 'baseline')!.precision).toBe(0.25);
    expect(summarize([], 'court')).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
  });

  it('builds one row per item, item order first', () => {
    const data = parseBench({ results: [r({ itemId: 'z' }), r({ itemId: 'a', system: 'baseline' })], items: [{ id: 'a' }] });
    expect(benchRows(data).map((x) => [x.itemId, !!x.court, !!x.baseline])).toEqual([
      ['a', false, true],
      ['z', true, false],
    ]);
  });
});

describe('patchToDiff', () => {
  it('derives file kinds and line stats from a unified diff', () => {
    const patch = [
      'diff --git a/new.js b/new.js',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.js',
      '@@ -0,0 +1,2 @@',
      '+a',
      '+b',
      'diff --git a/x.js b/x.js',
      '--- a/x.js',
      '+++ b/x.js',
      '@@ -1,2 +1,2 @@',
      '-old',
      '+new',
      ' same',
      '',
    ].join('\n');
    const diff = patchToDiff(patch, 'base', 'head');
    expect(diff.files).toEqual([
      { path: 'new.js', kind: 'added', additions: 2, deletions: 0 },
      { path: 'x.js', kind: 'modified', additions: 1, deletions: 1 },
    ]);
    expect(diff.baseRef).toBe('base');
  });
});

describe('demo data', () => {
  const demo = readDemo<CaseRecord & { patch: string; description: string }>('cases/demo-1.json');

  it('is a complete closed CaseRecord with five charges', () => {
    expect(demo.id).toBe('demo-1');
    expect(demo.status).toBe('closed');
    expect(demo.charges).toHaveLength(5);
    const ids = demo.charges.map((c) => c.id).sort();
    expect(demo.evidence.map((x) => x.chargeId).sort()).toEqual(ids);
    expect(demo.rulings.map((x) => x.chargeId).sort()).toEqual(ids);
    for (const u of demo.usage) {
      expect(u.model).toBe(MODELS[u.tier].id);
      const cost = (u.promptTokens * MODELS[u.tier].inPerM + u.completionTokens * MODELS[u.tier].outPerM) / 1e6;
      expect(u.costUsd).toBeCloseTo(cost, 8);
    }
    expect(formatUsd(caseTotals(demo.usage).costUsd)).toBe('$0.0274');
  });

  it('carries a verified remedy for its convicted charge that applies to head', () => {
    const remedy = demo.remedy!;
    expect(remedy).toBeTruthy();
    expect(remedy.chargeIds).toEqual(convictedChargeIds(demo));
    expect(remedy.verified).toBe(true);
    expect(remedy.suite).toBe('pass');
    expect(remedy.attempts).toBe(2);
    expect(remedy.witnesses).toEqual([{ chargeId: 'c1', outcomes: ['pass', 'pass', 'pass'] }]);
    expect(demo.usage.filter((u) => u.role === 'remedy')).toHaveLength(remedy.attempts);
    expect(demo.usage.filter((u) => u.role === 'remedy').every((u) => u.tier === 'super')).toBe(true);

    const head = new Map<number, string>();
    const compare = parsePatch(demo.patch).find((f) => f.path === 'src/compare.js')!;
    for (const l of compare.hunks.flatMap((h) => h.lines)) if (l.kind !== 'del' && l.newNo !== null) head.set(l.newNo, l.text);
    const fix = parsePatch(remedy.patch);
    expect(fix.map((f) => f.path)).toEqual(['src/compare.js']);
    const lines = fix[0].hunks.flatMap((h) => h.lines);
    for (const l of lines) {
      if ((l.kind === 'context' || l.kind === 'del') && l.oldNo !== null) expect(l.text).toBe(head.get(l.oldNo));
    }
    const del = lines.find((l) => l.kind === 'del')!;
    expect(del.oldNo).toBe(28);
    expect(del.text).toContain('MAIN.length - 1');
    expect(lines.find((l) => l.kind === 'add')?.text).toBe('  for (let i = 0; i < MAIN.length; i++) {');
  });

  it('obeys the admissibility rule and has the intended mix of outcomes', () => {
    for (const e of demo.evidence) {
      const rule = e.head.every((o) => o === 'fail') && e.base.every((o) => o === 'pass');
      expect(e.admissible).toBe(rule);
      expect(e.base).toHaveLength(3);
      expect(e.head).toHaveLength(3);
    }
    const outcome = (id: string) => chargeOutcome(demo, id).state;
    const admissible = demo.evidence.filter((e) => e.admissible).map((e) => e.chargeId);
    expect(admissible).toHaveLength(2);
    expect(admissible.map(outcome).sort()).toEqual(['convicted', 'dismissed']);
    const inadmissible = demo.evidence.filter((e) => !e.admissible);
    expect(inadmissible.some((e) => e.head.every((o) => o === 'pass'))).toBe(true);
    expect(inadmissible.some((e) => e.base.every((o) => o === 'error'))).toBe(true);
    expect(inadmissible.some((e) => e.head.includes('pass') && e.head.includes('fail'))).toBe(true);
    expect(demo.rebuttals.map((r) => r.chargeId).sort()).toEqual(admissible.sort());
    expect(caseTally(demo)).toEqual({ convicted: 1, dismissed: 4, inadmissible: 3, pending: 0 });
  });

  it('carries a patch whose hunk counts parse cleanly and cover every charged file', () => {
    const files = parsePatch(demo.patch);
    expect(files.map((f) => f.path)).toEqual(['src/parse.js', 'src/compare.js', 'src/range.js']);
    const convicted = demo.charges.find((c) => chargeOutcome(demo, c.id).state === 'convicted')!;
    const file = files.find((f) => f.path === convicted.file)!;
    const line = file.hunks.flatMap((h) => h.lines).find((l) => l.newNo === convicted.line);
    expect(line?.kind).toBe('add');
    expect(line?.text).toContain('MAIN.length - 1');
    for (const f of files) {
      for (const h of f.hunks) expect(h.lines.every((l) => l.kind !== 'meta')).toBe(true);
    }
  });

  it('locates every charge on a diff line for the workbench anchors', () => {
    const files = parsePatch(demo.patch);
    for (const c of demo.charges) {
      expect(locateLine(files, c.file, c.line)).toEqual({ path: c.file, line: c.line });
    }
    expect(locateLine(files, './src/compare.js', 999)).toEqual({ path: 'src/compare.js', line: null });
    expect(locateLine(files, 'src/nope.js', 1)).toBeNull();
    expect(anchorKey('src/compare.js', 28)).toBe('src/compare.js#28');
    expect(anchorKey('src/compare.js', null)).toBe('src/compare.js#file');
  });

  it('bench sample is flagged and has 25 items x 2 systems with consistent counts', () => {
    const raw = readDemo<{ sample: unknown; label: string }>('bench.json');
    expect(raw.sample).toBe(true);
    expect(raw.label).toMatch(/SAMPLE/);
    const data = parseBench(raw);
    expect(data.sample).toBe(true);
    expect(data.items).toHaveLength(25);
    expect(data.results).toHaveLength(50);
    for (const row of benchRows(data)) {
      expect(row.court && row.baseline).toBeTruthy();
      const c = row.court!;
      const b = row.baseline!;
      expect(c.falsePositives).toBe(c.convicted - (c.hit ? 1 : 0));
      expect(b.falsePositives).toBe(b.findings - (b.hit ? 1 : 0));
      expect(c.convicted).toBeLessThanOrEqual(c.findings);
    }
    expect(summarize(data.results, 'court')!.hitRate).toBeCloseTo(0.56);
    expect(summarize(data.results, 'court')!.fpPerPr).toBeCloseTo(0.08);
    expect(summarize(data.results, 'baseline')!.hitRate).toBeCloseTo(0.36);
  });
});
