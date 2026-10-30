import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CaseRecord, Charge } from '@kacheri/shared';

export const COMMENT_MARKER = '<!-- kacheri-court -->';

const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;').replace(/\r?\n/g, ' ').replace(/`/g, '&#96;');
const quote = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;
function fence(code: string, language: string): string {
  const ticks = '`'.repeat(Math.max(3, ...(code.match(/`+/g) ?? []).map(s => s.length + 1)));
  return `${ticks}${language}\n${code}\n${ticks}`;
}

function reproduction(record: CaseRecord, charge: Charge): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(charge.id)) throw new Error('Unsafe charge id');
  const path = `__kacheri__/${charge.id}.test.mjs`;
  // Encode the exact bytes: no shell interpolation, heredoc delimiter collisions, or added newline.
  const encoded = Buffer.from(charge.witnessCode).toString('base64');
  const write = `node -e ${quote(`require('node:fs').mkdirSync('__kacheri__', { recursive: true }); require('node:fs').writeFileSync(${JSON.stringify(path)}, Buffer.from('${encoded}', 'base64'));`)}`;
  return [
    '# Run in a clean checkout with dependencies installed.',
    `git checkout --detach ${quote(record.headRef)}`,
    write,
    `node --test ${quote(path)} # expected: FAIL on head`,
    `git checkout --detach ${quote(record.baseRef)}`,
    write,
    `node --test ${quote(path)} # expected: PASS on base`,
  ].join('\n');
}

export function renderComment(record: CaseRecord): string {
  const convicted = record.rulings.filter(r => r.decision === 'convicted');
  const dismissed = record.rulings.filter(r => r.decision === 'dismissed');
  const verdict = record.status === 'error' ? 'ERROR' : record.status !== 'closed' ? 'INCOMPLETE' : convicted.length ? 'CONVICTED' : 'DISMISSED';
  const lines = [COMMENT_MARKER, `## Kacheri Court: ${verdict}`, '', escape(record.title), ''];
  if (record.error) lines.push(`Case error: ${escape(record.error)}`, '');
  lines.push('| Charge | Severity | Location | Claim | Verdict | Reason |', '| --- | --- | --- | --- | --- | --- |');
  for (const charge of record.charges) {
    const ruling = record.rulings.find(r => r.chargeId === charge.id);
    lines.push(`| ${escape(charge.id)} | ${escape(charge.severity)} | ${escape(charge.file)}${charge.line === null ? '' : `:${charge.line}`} | ${escape(charge.claim)} | ${ruling?.decision.toUpperCase() ?? 'PENDING'} | ${escape(ruling?.reason ?? '')} |`);
  }
  if (!record.charges.length) lines.push('| — | — | — | No charges filed | — | — |');
  lines.push('', `Dismissed charges: ${dismissed.length}${dismissed.length ? ` (${dismissed.map(r => escape(r.chargeId)).join(', ')})` : ''}.`, '');
  for (const ruling of convicted) {
    const charge = record.charges.find(c => c.id === ruling.chargeId);
    if (!charge) throw new Error(`Missing charge for conviction: ${ruling.chargeId}`);
    lines.push(`### ${escape(charge.id)}: CONVICTED`, '', '<details>', '<summary>Executable witness</summary>', '', fence(charge.witnessCode, 'javascript'), '', '</details>', '', 'Copy-paste reproduction (head fails, base passes):', '', fence(reproduction(record, charge), 'sh'), '');
  }
  const tiers = [...new Set(record.usage.map(u => u.tier))].map(t => t[0].toUpperCase() + t.slice(1));
  const cost = record.usage.reduce((sum, u) => sum + u.costUsd, 0);
  lines.push(`Nemotron tiers used: ${tiers.join(', ') || 'none'}. Total cost: $${cost.toFixed(6)} USD.`, '');
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2);
  if (!input) throw new Error('Usage: tsx packages/ci/src/comment.ts case.json [comment.md]');
  const markdown = renderComment(JSON.parse(await readFile(input, 'utf8')) as CaseRecord);
  if (output) await writeFile(output, markdown);
  else process.stdout.write(markdown);
}
