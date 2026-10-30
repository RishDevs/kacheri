import { randomUUID } from 'node:crypto';
import type {
  CaseRecord,
  Charge,
  ChatRequest,
  CourtEvent,
  Evidence,
  LlmClient,
  LlmUsage,
  ModelTier,
  Rebuttal,
  Ruling,
  Severity,
} from '@kacheri/shared';
import { checkout, git, resolveRef } from './git';
import { extractJson } from './json';
import { baselineMessages, type CaseContext, defenseMessages, judgeMessages, prosecutorMessages } from './prompts';
import { judgeAdmissibility, lintWitness, runWitness, type WitnessOptions, witnessPathFor } from './witness';

export { classify, judgeAdmissibility, lintWitness, runWitness, witnessPathFor, DEFAULT_WITNESS_COMMAND } from './witness';
export { extractJson } from './json';
export { renderVerdict } from './render';

export interface CaseOptions {
  repoPath: string;
  baseRef: string;
  headRef: string;
  title?: string; // default: head commit subject
  llm: LlmClient;
  witness?: WitnessOptions;
  prosecutors?: number; // independent prosecutor samples, default 2
  maxCharges?: number; // per prosecutor, default 4
  onEvent?: (e: CourtEvent) => void;
}

const SEVERITIES: Severity[] = ['critical', 'major', 'minor'];
const PROSECUTOR_TEMPS = [0.2, 0.7, 1.0];

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function callJson(llm: LlmClient, req: ChatRequest, onUsage: (u: LlmUsage) => void): Promise<unknown> {
  const first = await llm.chat({ ...req, json: true });
  onUsage(first.usage);
  try {
    return extractJson(first.content);
  } catch {
    const retry = await llm.chat({
      ...req,
      json: true,
      messages: [...req.messages, { role: 'assistant', content: first.content }, { role: 'user', content: 'That was not valid JSON. Reply with only the JSON object.' }],
    });
    onUsage(retry.usage);
    return extractJson(retry.content);
  }
}

export async function buildContext(repo: string, base: string, head: string, title: string): Promise<CaseContext> {
  const diff = await git(['diff', '-M', base, head], repo);
  const changed = (await git(['diff', '--name-only', '--diff-filter=AMR', base, head], repo)).split('\n').filter(Boolean);
  const files = await Promise.all(
    changed.filter((p) => !/\.(png|jpe?g|gif|lock|min\.js)$/.test(p)).slice(0, 12).map(async (p) => ({ path: p, content: await git(['show', `${head}:${p}`], repo) })),
  );
  const all = (await git(['ls-tree', '-r', '--name-only', head], repo)).split('\n');
  const tests = all.filter((p) => /(^|\/)(test|tests|__tests__)\/|\.test\.[cm]?js$|\.spec\.[cm]?js$/.test(p) && /\.[cm]?js$/.test(p));
  const near = tests.find((t) => changed.some((c) => t.includes(c.replace(/^.*\//, '').replace(/\.[cm]?js$/, '')))) ?? tests[0];
  const testExample = near ? { path: near, content: await git(['show', `${head}:${near}`], repo) } : null;
  let packageType: 'module' | 'commonjs' = 'commonjs';
  try {
    packageType = JSON.parse(await git(['show', `${head}:package.json`], repo)).type === 'module' ? 'module' : 'commonjs';
  } catch {
    // no package.json at the root: CommonJS is Node's default
  }
  return { title, diff, files, testExample, packageType };
}

function toCharges(value: unknown): Omit<Charge, 'id' | 'witnessPath'>[] {
  const raw = (value as { charges?: unknown })?.charges;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c) => {
    if (!c || typeof c !== 'object') return [];
    const r = c as Record<string, unknown>;
    if (typeof r.claim !== 'string' || typeof r.file !== 'string' || typeof r.witnessCode !== 'string' || !r.witnessCode.trim()) return [];
    const sev = typeof r.severity === 'string' && SEVERITIES.includes(r.severity as Severity) ? (r.severity as Severity) : 'major';
    const line = typeof r.line === 'number' && Number.isInteger(r.line) && r.line > 0 ? r.line : null;
    return [{ claim: r.claim.trim(), file: r.file.trim(), line, severity: sev, witnessCode: r.witnessCode }];
  });
}

export async function runCase(opts: CaseOptions): Promise<CaseRecord> {
  const emit = (e: CourtEvent) => opts.onEvent?.(e);
  const repo = opts.repoPath;
  const record: CaseRecord = {
    id: `case_${randomUUID().slice(0, 8)}`,
    title: opts.title ?? '',
    repoPath: repo,
    baseRef: opts.baseRef,
    headRef: opts.headRef,
    status: 'filing',
    charges: [],
    evidence: [],
    rebuttals: [],
    rulings: [],
    usage: [],
    error: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
  };
  const onUsage = (u: LlmUsage) => {
    record.usage.push(u);
    emit({ type: 'usage', caseId: record.id, usage: u });
  };
  const setStatus = (s: CaseRecord['status']) => {
    record.status = s;
    emit({ type: 'case', record: structuredClone(record) });
  };

  try {
    const base = await resolveRef(repo, opts.baseRef);
    const head = await resolveRef(repo, opts.headRef);
    record.baseRef = base;
    record.headRef = head;
    if (!record.title) record.title = (await git(['log', '-1', '--format=%s', head], repo)).trim();
    setStatus('filing');
    const ctx = await buildContext(repo, base, head, record.title);

    // 1. Filing: independent Nano prosecutors, merged and de-duplicated.
    const n = Math.max(1, Math.min(opts.prosecutors ?? 2, PROSECUTOR_TEMPS.length));
    const filings = await Promise.all(
      PROSECUTOR_TEMPS.slice(0, n).map((temperature) =>
        callJson(opts.llm, { tier: 'nano', role: 'prosecutor', reasoning: true, temperature, maxTokens: 8000, messages: prosecutorMessages(ctx, opts.maxCharges ?? 4) }, onUsage).then(toCharges, () => []),
      ),
    );
    const seen = new Set<string>();
    for (const c of filings.flat()) {
      const key = `${c.file}:${c.line ?? ''}:${c.claim.toLowerCase().slice(0, 40)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const id = `c${record.charges.length + 1}`;
      const charge: Charge = { ...c, id, witnessPath: witnessPathFor({ id }) };
      record.charges.push(charge);
      emit({ type: 'charge', caseId: record.id, charge });
    }

    // 2. Trial: every witness runs on both sides; the outcome decides admissibility, not a model.
    setStatus('trial');
    if (record.charges.length) {
      const [baseWt, headWt] = await Promise.all([checkout(repo, base), checkout(repo, head)]);
      try {
        // Sequential on purpose: concurrent witnesses could share ports or temp files and fake a head-only failure.
        for (const charge of record.charges) {
          const lint = lintWitness(charge.witnessCode);
          if (lint) {
            const ev: Evidence = { chargeId: charge.id, base: [], head: [], admissible: false, reason: `witness rejected before running: ${lint}`, headLog: '' };
            record.evidence.push(ev);
            emit({ type: 'evidence', caseId: record.id, evidence: ev });
            continue;
          }
          const b = await runWitness(baseWt.path, charge, opts.witness);
          const h = await runWitness(headWt.path, charge, opts.witness);
          const ev = judgeAdmissibility(charge.id, b.outcomes, h.outcomes, h.lastOutput);
          record.evidence.push(ev);
          emit({ type: 'evidence', caseId: record.id, evidence: ev });
        }
      } finally {
        await Promise.all([baseWt.dispose(), headWt.dispose()]);
      }
    }
    record.evidence.sort((a, b) => Number(a.chargeId.slice(1)) - Number(b.chargeId.slice(1)));

    const byId = new Map(record.charges.map((c) => [c.id, c]));
    const admitted = record.evidence.filter((e) => e.admissible);
    for (const e of record.evidence.filter((x) => !x.admissible)) {
      const r: Ruling = { chargeId: e.chargeId, decision: 'dismissed', reason: `Inadmissible: ${e.reason}.` };
      record.rulings.push(r);
      emit({ type: 'ruling', caseId: record.id, ruling: r });
    }

    // 3. Defense (Super) on admissible charges only.
    setStatus('deliberation');
    await mapLimit(admitted, 4, async (ev) => {
      const charge = byId.get(ev.chargeId)!;
      try {
        const v = (await callJson(opts.llm, { tier: 'super', role: 'defense', reasoning: false, temperature: 0.3, maxTokens: 1200, messages: defenseMessages(ctx, charge, ev) }, onUsage)) as Record<string, unknown>;
        const r: Rebuttal = { chargeId: charge.id, argument: typeof v.argument === 'string' ? v.argument : '', concedes: v.concedes === true };
        record.rebuttals.push(r);
        emit({ type: 'rebuttal', caseId: record.id, rebuttal: r });
      } catch {
        // A defense that cannot answer leaves the charge to the judge.
      }
    });

    // 4. Ruling (Ultra, reasoning on) over the evidence log.
    if (admitted.length) {
      const items = admitted.map((evidence) => ({ charge: byId.get(evidence.chargeId)!, evidence, rebuttal: record.rebuttals.find((r) => r.chargeId === evidence.chargeId) ?? null }));
      let rulings: unknown[] = [];
      for (let attempt = 0; attempt < 2 && !rulings.length; attempt++) {
        try {
          const v = (await callJson(opts.llm, { tier: 'ultra', role: 'judge', reasoning: true, temperature: 0.1, maxTokens: 6000, messages: judgeMessages(ctx, items) }, onUsage)) as { rulings?: unknown };
          if (Array.isArray(v.rulings)) rulings = v.rulings;
        } catch {
          // Retry once; after that every admitted charge gets the default below.
        }
      }
      for (const { charge, rebuttal } of items) {
        const raw = rulings.find((x) => (x as { chargeId?: unknown })?.chargeId === charge.id) as Record<string, unknown> | undefined;
        let r: Ruling;
        if (raw && (raw.decision === 'convicted' || raw.decision === 'dismissed')) {
          r = { chargeId: charge.id, decision: raw.decision, reason: typeof raw.reason === 'string' ? raw.reason : '' };
        } else {
          // The evidence already proves a regression; without a ruling, conviction requires the defense to concede.
          r = rebuttal?.concedes
            ? { chargeId: charge.id, decision: 'convicted', reason: 'No ruling returned; the defense conceded the evidence.' }
            : { chargeId: charge.id, decision: 'dismissed', reason: 'The judge was unavailable; admissible evidence stands but no conviction was entered. Re-run the case.' };
        }
        record.rulings.push(r);
        emit({ type: 'ruling', caseId: record.id, ruling: r });
      }
    }
    record.rulings.sort((a, b) => Number(a.chargeId.slice(1)) - Number(b.chargeId.slice(1)));
    record.endedAt = new Date().toISOString();
    setStatus('closed');
  } catch (err) {
    record.error = err instanceof Error ? err.message : String(err);
    record.endedAt = new Date().toISOString();
    setStatus('error');
  }
  return record;
}

export interface BaselineFinding {
  file: string;
  line: number | null;
  severity: Severity;
  message: string;
}

export interface BaselineResult {
  findings: BaselineFinding[];
  usage: LlmUsage[];
}

// What most AI reviewers do: one strong model, one pass, no evidence requirement.
export async function runBaseline(opts: Pick<CaseOptions, 'repoPath' | 'baseRef' | 'headRef' | 'title' | 'llm'> & { tier?: ModelTier }): Promise<BaselineResult> {
  const base = await resolveRef(opts.repoPath, opts.baseRef);
  const head = await resolveRef(opts.repoPath, opts.headRef);
  const title = opts.title ?? (await git(['log', '-1', '--format=%s', head], opts.repoPath)).trim();
  const ctx = await buildContext(opts.repoPath, base, head, title);
  const usage: LlmUsage[] = [];
  let findings: BaselineFinding[] = [];
  try {
    const v = (await callJson(opts.llm, { tier: opts.tier ?? 'super', role: 'baseline', reasoning: true, temperature: 0.2, maxTokens: 6000, messages: baselineMessages(ctx) }, (u) => usage.push(u))) as { findings?: unknown };
    if (Array.isArray(v.findings)) {
      findings = v.findings.flatMap((f) => {
        const r = f as Record<string, unknown>;
        if (!r || typeof r.file !== 'string' || typeof r.message !== 'string') return [];
        return [{ file: r.file, line: typeof r.line === 'number' ? r.line : null, severity: SEVERITIES.includes(r.severity as Severity) ? (r.severity as Severity) : 'major', message: r.message }];
      });
    }
  } catch {
    findings = [];
  }
  return { findings, usage };
}

export function caseCost(record: Pick<CaseRecord, 'usage'>): number {
  return record.usage.reduce((s, u) => s + u.costUsd, 0);
}
