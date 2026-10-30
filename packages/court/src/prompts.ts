import type { Charge, ChatMessage, Evidence, Rebuttal } from '@kacheri/shared';

export interface CaseContext {
  title: string;
  diff: string;
  files: { path: string; content: string }[]; // changed files at head
  testExample: { path: string; content: string } | null;
  packageType: 'module' | 'commonjs';
}

const MAX_FILE = 24_000;
const MAX_DIFF = 60_000;

function contextBlock(c: CaseContext): string {
  const files = c.files.map((f) => `--- ${f.path} (at head)\n${f.content.slice(0, MAX_FILE)}`).join('\n\n');
  const example = c.testExample ? `\nAn existing test in this repo, for import style (${c.testExample.path}):\n${c.testExample.content.slice(0, 4000)}\n` : '';
  return `PR title: ${c.title}\n\nDiff (base -> head):\n${c.diff.slice(0, MAX_DIFF)}\n\nChanged files at head:\n${files}\n${example}`;
}

export function prosecutorMessages(c: CaseContext, maxCharges: number): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `You are the prosecutor in a code-review court. You may only accuse the change of a bug if you can PROVE it with an executable witness test.
A witness is a complete Node.js test file using node:test and node:assert/strict. It will be written to __kacheri__/<id>.test.mjs at the repository root and run directly with node, once on the BASE commit and once on the HEAD commit.
Admissible evidence: the witness FAILS on head and PASSES on base. A witness that errors, passes on head, or also fails on base is thrown out, so:
- import the code under test with a relative path from __kacheri__/ (e.g. "../src/index.js"); the repository uses ${c.packageType === 'module' ? 'ES modules' : 'CommonJS (use createRequire)'};
- only call APIs that exist on BOTH base and head;
- assert the behaviour that base has and head breaks; no network, no file writes, no child processes, no timers longer than 1 s.
Accuse only real behavioural regressions introduced by this diff (not style, not pre-existing issues). At most ${maxCharges} charges; zero is a valid answer.
Reply with only JSON: {"charges":[{"claim":"one sentence","file":"path","line":123,"severity":"critical|major|minor","witnessCode":"..."}]}`,
    },
    { role: 'user', content: contextBlock(c) },
  ];
}

export function defenseMessages(c: CaseContext, charge: Charge, ev: Evidence): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `You are the defense counsel for the author of a code change. The prosecutor has produced a witness test that fails on the change and passes on the original code.
Argue honestly. Valid defenses: the witness asserts behaviour that is unspecified or wrong; the behaviour change is intentional and announced by the PR title; the failure comes from the test itself, not the code. If the witness demonstrates a real unintended regression, concede.
Reply with only JSON: {"argument":"2-4 sentences","concedes":true|false}`,
    },
    {
      role: 'user',
      content: `${contextBlock(c)}\n\nCharge ${charge.id}: ${charge.claim} (${charge.file}:${charge.line ?? '?'})\nWitness:\n${charge.witnessCode}\n\nEvidence: ${ev.reason}\nHead output:\n${ev.headLog.slice(-2000)}`,
    },
  ];
}

export function judgeMessages(c: CaseContext, items: { charge: Charge; evidence: Evidence; rebuttal: Rebuttal | null }[]): ChatMessage[] {
  const docket = items
    .map(
      ({ charge, evidence, rebuttal }) =>
        `## ${charge.id}: ${charge.claim}\nLocation: ${charge.file}:${charge.line ?? '?'} (${charge.severity})\nWitness:\n${charge.witnessCode}\nEvidence: ${evidence.reason}\nHead output (tail):\n${evidence.headLog.slice(-1200)}\nDefense: ${rebuttal ? `${rebuttal.concedes ? '(concedes) ' : ''}${rebuttal.argument}` : '(no defense filed)'}`,
    )
    .join('\n\n');
  return [
    {
      role: 'system',
      content: `You are the presiding judge of a code-review court. Every charge before you already has admissible executable evidence: its witness fails on the change and passes on the original.
Rule on each charge. Convict when the evidence shows an unintended behavioural regression a maintainer would want fixed before merging. Dismiss when the defense shows the witness tests unspecified or intentionally changed behaviour. Base the ruling on the evidence, not on the prosecutor's wording.
Reply with only JSON: {"rulings":[{"chargeId":"c1","decision":"convicted|dismissed","reason":"1-2 sentences"}]}`,
    },
    { role: 'user', content: `${contextBlock(c)}\n\n# Docket\n${docket}` },
  ];
}

export function baselineMessages(c: CaseContext): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `You are an expert code reviewer. Review the diff for bugs introduced by the change.
Reply with only JSON: {"findings":[{"file":"path","line":123,"severity":"critical|major|minor","message":"..."}]}`,
    },
    { role: 'user', content: contextBlock(c) },
  ];
}
