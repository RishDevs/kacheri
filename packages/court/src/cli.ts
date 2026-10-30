#!/usr/bin/env -S npx tsx
// kacheri-court --repo . --base main --head HEAD [--title "..."] [--out case.json]
// Exit code: 0 no convictions, 1 at least one conviction (use as a CI gate), 2 case error.
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { renderVerdict, runCase } from './index';

const { values } = parseArgs({
  options: {
    repo: { type: 'string', default: '.' },
    base: { type: 'string', default: 'main' },
    head: { type: 'string', default: 'HEAD' },
    title: { type: 'string' },
    out: { type: 'string' },
    prosecutors: { type: 'string', default: '2' },
    'test-cmd': { type: 'string' }, // e.g. "node --test test.js"; re-run on the remedy
    'no-remedy': { type: 'boolean', default: false },
  },
});

const { createClientFromEnv } = await import('@kacheri/llm');
const record = await runCase({
  repoPath: values.repo!,
  baseRef: values.base!,
  headRef: values.head!,
  title: values.title,
  llm: createClientFromEnv(),
  prosecutors: Number(values.prosecutors),
  remedy: !values['no-remedy'],
  testCommand: values['test-cmd']?.split(' ').filter(Boolean),
  onEvent: (e) => {
    if (e.type === 'charge') process.stderr.write(`charge ${e.charge.id}: ${e.charge.claim}\n`);
    if (e.type === 'evidence') process.stderr.write(`evidence ${e.evidence.chargeId}: ${e.evidence.reason}\n`);
    if (e.type === 'ruling') process.stderr.write(`ruling ${e.ruling.chargeId}: ${e.ruling.decision}\n`);
    if (e.type === 'remedy') process.stderr.write(`remedy: ${e.remedy.verified ? 'verified' : 'not verified'}\n`);
  },
});
if (values.out) await writeFile(values.out, JSON.stringify(record, null, 2));
process.stdout.write(`${renderVerdict(record)}\n`);
process.exit(record.status === 'error' ? 2 : record.rulings.some((r) => r.decision === 'convicted') ? 1 : 0);
