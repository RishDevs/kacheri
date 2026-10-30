import type { CaseRecord } from '@kacheri/shared';

export function renderVerdict(r: CaseRecord): string {
  const convicted = r.rulings.filter((x) => x.decision === 'convicted');
  const cost = r.usage.reduce((s, u) => s + u.costUsd, 0);
  const lines = [
    `# Kacheri Court: ${r.title}`,
    '',
    `**${convicted.length ? `GUILTY on ${convicted.length} charge${convicted.length > 1 ? 's' : ''}` : 'NO CONVICTIONS'}**: ${r.charges.length} filed, ${r.evidence.filter((e) => e.admissible).length} with admissible evidence. Cost $${cost.toFixed(4)}.`,
    '',
    '| Charge | Location | Evidence | Ruling |',
    '|---|---|---|---|',
  ];
  for (const c of r.charges) {
    const ev = r.evidence.find((e) => e.chargeId === c.id);
    const ru = r.rulings.find((x) => x.chargeId === c.id);
    lines.push(`| ${c.id}: ${c.claim.replace(/\|/g, '\\|')} | \`${c.file}:${c.line ?? '?'}\` | ${ev?.reason ?? 'not run'} | **${ru?.decision ?? 'pending'}**: ${(ru?.reason ?? '').replace(/\|/g, '\\|')} |`);
  }
  for (const c of r.charges.filter((x) => convicted.some((v) => v.chargeId === x.id))) {
    lines.push('', `## ${c.id} witness (fails on head, passes on base)`, '', '```js', c.witnessCode.trim(), '```');
  }
  if (r.remedy) {
    const m = r.remedy;
    lines.push('', `## Remedy: ${m.verified ? 'VERIFIED' : 'NOT VERIFIED'} (${m.attempts} attempt${m.attempts > 1 ? 's' : ''})`, '', m.explanation, '', `Witnesses on head+fix: ${m.witnesses.map((w) => `${w.chargeId} ${w.outcomes.join('/')}`).join(', ')}. Existing suite: ${m.suite}.`, '', '```diff', m.patch.trim(), '```');
  }
  if (r.error) lines.push('', `> Case error: ${r.error}`);
  return lines.join('\n');
}
