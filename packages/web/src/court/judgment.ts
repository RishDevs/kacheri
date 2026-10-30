import type { CaseRecord, Charge, Evidence } from '@kacheri/shared';
import { locateLine, parsePatch, type DiffLine } from '../diff';
import { caseExtras, chargeOutcome, convictedChargeIds, isActive, isoDate, shortSha } from './summary';

// Wording for the judgment document (docs/DESIGN.md): every legal phrase is paired with plain language.

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

export function numberWord(n: number): string {
  return Number.isInteger(n) && n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n);
}

export function timesWord(n: number): string {
  if (n === 1) return 'once';
  if (n === 2) return 'twice';
  return `${numberWord(n)} times`;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// "30 October 2026" (UTC); empty for unparseable input.
export function longDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function cleanPath(repoPath: string): string {
  return repoPath.trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

export function repoName(repoPath: string): string {
  const parts = cleanPath(repoPath).split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : repoPath;
}

// "owner/repo" stays as written; local filesystem paths shrink to their last segment.
export function repoLabel(repoPath: string): string {
  const p = cleanPath(repoPath);
  return /^(?:\/|\.|~|[A-Za-z]:)/.test(p) ? repoName(p) : p;
}

export function caseNumber(record: Pick<CaseRecord, 'id' | 'startedAt'>): string {
  if (/^KC-/i.test(record.id)) return record.id.toUpperCase();
  const year = isoDate(record.startedAt).slice(0, 4) || '0000';
  return `KC-${year}-${record.id.replace(/^case[_-]/i, '').toUpperCase()}`;
}

export function plaintiff(record: Pick<CaseRecord, 'repoPath'>): string {
  return `THE MAINTAINERS OF ${repoName(record.repoPath).toUpperCase()}`;
}

export function defendant(record: Pick<CaseRecord, 'headRef' | 'title'>): string {
  return `PULL REQUEST ${shortSha(record.headRef)}, “${record.title.trim()},”`;
}

function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// Runs of three or more collapse to "a to b": [2, 3, 4] -> "2 to 4", [1, 3] -> "1 and 3".
function numberRuns(nums: readonly number[]): string[] {
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    if (j - i >= 2) {
      parts.push(`${sorted[i]} to ${sorted[j]}`);
      i = j + 1;
    } else {
      parts.push(String(sorted[i]));
      i++;
    }
  }
  return parts;
}

function numbered(singular: string, plural: string, nums: readonly number[]): string {
  if (nums.length === 0) return '';
  return `${new Set(nums).size === 1 ? singular : plural} ${joinAnd(numberRuns(nums))}`;
}

export function countList(nums: readonly number[]): string {
  return numbered('Count', 'Counts', nums);
}

export function exhibitList(nums: readonly number[]): string {
  return numbered('Exhibit', 'Exhibits', nums);
}

export function countNumber(record: Pick<CaseRecord, 'charges'>, chargeId: string): number {
  return record.charges.findIndex((c) => c.id === chargeId) + 1;
}

// Lowercases a leading ordinary word so model text reads on after a colon ("The test" -> "the test").
export function afterColon(text: string): string {
  const t = text.trim();
  return /^(?!I\b)[A-Z][a-z]+\b/.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The count shows file:line on its own, so the claim drops the prosecutor's mentions of the charged file.
export function claimText(charge: Pick<Charge, 'claim' | 'file'>): string {
  const claim = charge.claim.trim().replace(/\s+/g, ' ');
  const base = charge.file.replace(/\\/g, '/').split('/').filter(Boolean).pop();
  if (!base) return claim;
  const at = `(?:(?:in|at|see|from)\\s+)?`;
  const path =
    '`?(?:\\.?/)?(?:[\\w.@-]+/)*' +
    escapeRe(base) +
    '(?::\\d+(?:[:-]\\d+)?)?`?(?:,?\\s+(?:on\\s+)?lines?\\s+\\d+(?:\\s*[-–]\\s*\\d+)?)?(?![\\w/])';
  const body = claim.replace(new RegExp(`\\s*[([]\\s*${at}${path}\\s*[)\\]]`, 'gi'), '');
  const lead = new RegExp(`^${at}${path}\\s*[:,—–-]?\\s*`, 'i');
  const leading = lead.test(body);
  const out = body
    .replace(lead, '')
    .replace(new RegExp(`[\\s,]+${at}${path}(?=\\s*(?:[.;!?]|$))`, 'gi'), '')
    .replace(new RegExp(`\\s+(?:in|at)\\s+${path}`, 'gi'), '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
  if (!out) return claim;
  return leading && /^[a-z]+\b/.test(out) ? out[0].toUpperCase() + out.slice(1) : out;
}

export type EvidenceFault = 'passes-on-head' | 'fails-on-base' | 'broken' | 'timeout' | 'flaky' | 'lint' | 'sandbox';
export type DismissalKind = EvidenceFault | 'unheard' | 'judge';

export const DISMISSAL_TEXT: Record<Exclude<DismissalKind, 'judge'>, string> = {
  'passes-on-head': 'its test passed on the new code',
  'fails-on-base': 'its test gave the same result before the change',
  broken: 'its test could not run',
  timeout: 'its test did not finish in time',
  flaky: 'its test was not consistent',
  lint: 'its test checked the wrong thing',
  sandbox: 'its test tried something not allowed',
  unheard: 'its test was never run',
};

// Reads the court's admissibility reason (packages/court witness.ts), falling back to the run outcomes.
export function evidenceFault(evidence: Pick<Evidence, 'reason' | 'base' | 'head'>): EvidenceFault {
  const r = evidence.reason.toLowerCase();
  if (/rejected before running|\blint/.test(r)) return 'lint';
  if (/sandbox/.test(r)) return 'sandbox';
  if (/flaky/.test(r)) return 'flaky';
  if (/timed out|timeout/.test(r)) return 'timeout';
  if (/broken|errors? on|crash/.test(r)) return 'broken';
  if (/fails on base/.test(r)) return 'fails-on-base';
  if (/passes on head/.test(r)) return 'passes-on-head';
  const { base, head } = evidence;
  if (base.includes('error') || head.includes('error')) return 'broken';
  if (base.includes('timeout') || head.includes('timeout')) return 'timeout';
  if (head.length > 0 && head.every((o) => o === 'pass')) return 'passes-on-head';
  if (base.includes('fail') && head.length > 0 && head.every((o) => o === 'fail')) return 'fails-on-base';
  return 'flaky';
}

export interface Dismissal {
  kind: DismissalKind;
  // "its test ..." for dismissals without trial; the judge's own reason otherwise
  text: string;
}

export function dismissal(record: CaseRecord, chargeId: string): Dismissal | null {
  const outcome = chargeOutcome(record, chargeId);
  if (outcome.state !== 'dismissed') return null;
  const evidence = record.evidence.find((e) => e.chargeId === chargeId);
  if (!evidence) return { kind: 'unheard', text: DISMISSAL_TEXT.unheard };
  if (!evidence.admissible) {
    const kind = evidenceFault(evidence);
    return { kind, text: DISMISSAL_TEXT[kind] };
  }
  return { kind: 'judge', text: outcome.reason };
}

// "its test passed on the new code" -> "Count 2’s test passed on the new code."
export function possessive(count: number, text: string): string {
  return `${text.replace(/^its /, `Count ${count}’s `)}.`;
}

// Convicted counts, plus counts still before the court with admissible evidence (live cases).
export function heardChargeIds(record: CaseRecord): string[] {
  return record.charges
    .filter((c) => {
      const state = chargeOutcome(record, c.id).state;
      if (state === 'convicted') return true;
      return state === 'pending' && record.evidence.some((e) => e.chargeId === c.id && e.admissible);
    })
    .map((c) => c.id);
}

// Each count runs its test three times before and three times after the change.
export const RUNS_PER_COUNT = 6;

export function stageText(record: CaseRecord): string {
  switch (record.status) {
    case 'filing':
      return 'The prosecution is writing proof tests…';
    case 'trial': {
      const total = record.charges.length * RUNS_PER_COUNT;
      if (total === 0) return 'The court is running the tests…';
      const current = Math.min(record.evidence.length * RUNS_PER_COUNT + 1, total);
      return `The court is running test ${current} of ${total}…`;
    }
    case 'deliberation': {
      const admitted = record.evidence.filter((e) => e.admissible);
      const ruled = admitted.filter((e) => record.rulings.some((r) => r.chargeId === e.chargeId));
      const anyConvicted = record.rulings.some((r) => r.decision === 'convicted');
      if (admitted.length > 0 && ruled.length === admitted.length && anyConvicted) return 'The court is testing the fix…';
      const defended = admitted.every((e) => record.rebuttals.some((r) => r.chargeId === e.chargeId));
      if (defended || record.usage.some((u) => u.role === 'judge')) return 'The judge is deciding…';
      return 'The defense is responding…';
    }
    case 'closed':
      return 'The court has decided.';
    case 'error':
      return 'The case could not be finished.';
  }
}

export type Standing = 'guilty' | 'not-guilty' | 'in-session' | 'mistrial';

export interface JudgmentText {
  standing: Standing;
  headline: string;
  // follows "In plain words:"
  plain: string;
}

export function judgment(record: CaseRecord): JudgmentText {
  if (record.status === 'error') {
    return {
      standing: 'mistrial',
      headline: 'Mistrial. The case could not be finished.',
      plain: 'the court stopped before it could decide, so this change is neither cleared nor found at fault.',
    };
  }
  if (isActive(record.status)) {
    return {
      standing: 'in-session',
      headline: stageText(record),
      plain: 'the court has not decided yet. The sections below fill in as the work is done.',
    };
  }

  const convicted: number[] = [];
  const dismissed: number[] = [];
  let wantOfEvidence = true;
  record.charges.forEach((c, i) => {
    const d = dismissal(record, c.id);
    if (d) {
      dismissed.push(i + 1);
      if (d.kind === 'judge') wantOfEvidence = false;
    } else if (chargeOutcome(record, c.id).state === 'convicted') {
      convicted.push(i + 1);
    }
  });
  const want = wantOfEvidence ? ' for want of evidence' : '';
  const total = record.charges.length;

  if (convicted.length === 0) {
    let headline = `Not guilty. All ${total} counts dismissed${want}.`;
    if (total === 0) headline = 'Not guilty. No charges were filed.';
    else if (total === 1) headline = `Not guilty. Count 1 dismissed${want}.`;
    return { standing: 'not-guilty', headline, plain: 'Nothing in this change was proven to break.' };
  }

  const c = convicted.length;
  const d = dismissed.length;
  let headline = `Guilty on ${countList(convicted)}.`;
  if (d > 0) headline += ` ${countList(dismissed)} dismissed${want}.`;

  let plain = `this change breaks ${c === 1 ? 'one thing' : `${numberWord(c)} things`}, proven by ${
    c === 1 ? 'a test that fails' : 'tests that fail'
  }.`;
  if (d > 0) {
    const others = d === 1 ? 'The other concern' : `The other ${numberWord(d)} concerns`;
    const why = wantOfEvidence ? 'had no working proof' : d === 1 ? 'was not proven' : 'were not proven';
    plain += ` ${others} ${why}, so ${d === 1 ? 'it is' : 'they are'} not counted.`;
  }
  const remedy = record.remedy;
  if (remedy && remedy.verified) plain += ' A fix has been tested and is ready.';
  else if (remedy) plain += ' A fix was tried, but it did not pass the court’s tests.';
  else plain += ' No tested fix is available.';
  return { standing: 'guilty', headline, plain };
}

// ---------------------------------------------------------------------------------------------
// Exhibits: excerpts of the diff and of the remedy patch

export type ExcerptKind = 'context' | 'add' | 'del' | 'gap' | 'file';

export interface ExcerptLine {
  kind: ExcerptKind;
  text: string;
}

export interface LineExcerpt {
  path: string;
  lines: ExcerptLine[];
}

function isChange(line: DiffLine | undefined): boolean {
  return line !== undefined && (line.kind === 'add' || line.kind === 'del');
}

function indentOf(text: string): number {
  return text.length - text.trimStart().length;
}

// Tabs become two spaces and the common indent is removed, so excerpts read like the mockup.
export function dedent(lines: readonly ExcerptLine[]): ExcerptLine[] {
  const expanded = lines.map((l) => ({ kind: l.kind, text: l.text.replace(/\t/g, '  ') }));
  const indents = expanded.filter((l) => l.kind !== 'gap' && l.kind !== 'file' && l.text.trim()).map((l) => indentOf(l.text));
  const cut = indents.length ? Math.min(...indents) : 0;
  return expanded.map((l) =>
    l.kind === 'gap' || l.kind === 'file' ? l : { kind: l.kind, text: l.text.slice(Math.min(cut, indentOf(l.text))) },
  );
}

function toExcerpt(lines: readonly DiffLine[]): ExcerptLine[] {
  return lines.map((l) => ({ kind: l.kind === 'meta' ? 'context' : l.kind, text: l.text }));
}

// The charged line with the nearest change around it (one line of context either side).
export function chargedExcerpt(patch: string | undefined, charge: Pick<Charge, 'file' | 'line'>): LineExcerpt | null {
  if (!patch) return null;
  const files = parsePatch(patch);
  const loc = locateLine(files, charge.file, charge.line);
  if (!loc) return null;
  const file = files.find((f) => f.path === loc.path);
  if (!file) return null;
  for (const hunk of file.hunks) {
    const lines = hunk.lines.filter((l) => l.kind !== 'meta');
    const at =
      loc.line === null ? lines.findIndex((l) => isChange(l)) : lines.findIndex((l) => l.kind !== 'del' && l.newNo === loc.line);
    if (at === -1) continue;
    let near = -1;
    for (let d = 0; d <= 3 && near === -1; d++) {
      if (isChange(lines[at + d])) near = at + d;
      else if (isChange(lines[at - d])) near = at - d;
    }
    let from = Math.max(0, at - 1);
    let to = Math.min(lines.length - 1, at + 1);
    if (near !== -1) {
      let start = near;
      let end = near;
      while (start > 0 && isChange(lines[start - 1])) start--;
      while (end < lines.length - 1 && isChange(lines[end + 1])) end++;
      from = Math.max(0, Math.min(at, start - 1));
      to = Math.min(lines.length - 1, Math.max(at, end + 1));
    }
    return { path: file.path, lines: dedent(toExcerpt(lines.slice(from, to + 1))) };
  }
  return null;
}

// Changed lines of every hunk with `pad` lines of context; skipped stretches become a gap line.
export function patchExcerpt(patch: string, pad = 1): LineExcerpt[] {
  return parsePatch(patch)
    .map((file) => {
      const out: ExcerptLine[] = [];
      for (const hunk of file.hunks) {
        const lines = hunk.lines.filter((l) => l.kind !== 'meta');
        let block: DiffLine[] = [];
        const flush = () => {
          if (block.length === 0) return;
          if (out.length > 0) out.push({ kind: 'gap', text: '⋯' });
          out.push(...dedent(toExcerpt(block)));
          block = [];
        };
        lines.forEach((line, i) => {
          const keep = lines.slice(Math.max(0, i - pad), i + pad + 1).some((l) => isChange(l));
          if (keep) block.push(line);
          else flush();
        });
        flush();
      }
      return { path: file.path, lines: out };
    })
    .filter((f) => f.lines.length > 0);
}

export interface CountExhibits {
  chargeId: string;
  count: number;
  runs: number;
  code: number;
  lines: number | null;
  excerpt: LineExcerpt | null;
}

// Exhibits are numbered in order across the heard counts: trial runs, proof test, then the line at issue.
export function planExhibits(record: CaseRecord, chargeIds: readonly string[]): CountExhibits[] {
  const { patch } = caseExtras(record);
  let next = 1;
  return chargeIds.map((id) => {
    const charge = record.charges.find((c) => c.id === id);
    const excerpt = charge ? chargedExcerpt(patch, charge) : null;
    const runs = next++;
    const code = next++;
    const lines = excerpt ? next++ : null;
    return { chargeId: id, count: countNumber(record, id), runs, code, lines, excerpt };
  });
}

export function suiteTestCount(log: string): number | null {
  const m = /^\s*(?:ℹ|#) tests (\d+)\s*$/m.exec(log);
  return m ? Number(m[1]) : null;
}

export interface OrderText {
  // true when the remedy patch is ordered and should be shown
  ordered: boolean;
  text: string;
}

export function orderText(record: CaseRecord, plan: readonly CountExhibits[]): OrderText {
  if (isActive(record.status)) return { ordered: false, text: 'The court has not yet made an order.' };
  if (record.status === 'error') return { ordered: false, text: 'No remedy is ordered. The case did not finish.' };
  const convicted = convictedChargeIds(record);
  if (convicted.length === 0) {
    return { ordered: false, text: 'No remedy is ordered. Nothing was proven, so there is nothing to fix.' };
  }
  const remedy = record.remedy;
  if (!remedy) return { ordered: false, text: 'No remedy is ordered. The court has no tested fix for this change.' };

  const addressed = convicted.filter((id) => remedy.chargeIds.includes(id));
  const ids = addressed.length > 0 ? addressed : convicted;
  const refs = ids
    .map((id) => plan.find((p) => p.chargeId === id)?.runs)
    .filter((n): n is number => n !== undefined);
  const exhibits = refs.length > 0 ? exhibitList(refs) : 'the proof tests';
  const outcomes = ids.flatMap((id) => remedy.witnesses.find((w) => w.chargeId === id)?.outcomes ?? []);
  const passed = outcomes.filter((o) => o === 'pass').length;
  const tests = suiteTestCount(remedy.suiteLog);
  const suite = `the library’s own ${tests === null ? '' : `${tests} `}tests`;

  if (remedy.verified) {
    const suiteText = remedy.suite === 'pass' ? ` and ${suite} (all pass).` : `. ${suite[0].toUpperCase()}${suite.slice(1)} were not run.`;
    return {
      ordered: true,
      text: `It is ordered that the following remedy be applied. The court re-ran ${exhibits} on the remedied code (${passed} of ${outcomes.length} pass)${suiteText}`,
    };
  }
  const runs =
    outcomes.length === 0
      ? `${exhibits} ${refs.length > 1 ? 'were' : 'was'} not re-run on the fixed code`
      : `on the fixed code, ${exhibits} gave ${passed} of ${outcomes.length} pass`;
  const suiteFail = remedy.suite === 'fail' ? `, and ${suite} failed` : '';
  return {
    ordered: false,
    text: `No remedy is ordered. A fix was proposed, but it did not pass the court’s tests: ${runs}${suiteFail}.`,
  };
}
