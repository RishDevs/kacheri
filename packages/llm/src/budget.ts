import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { MODELS, type ChatRequest, type ChatResponse, type LlmClient } from '@kacheri/shared';

// Hard spending cap for paid Token Factory calls. The ledger persists across processes so a cap holds
// for the whole hackathon, not per run. Before each call the WORST-CASE cost (full prompt + maxTokens of output)
// must fit under the cap, otherwise the call is refused and never sent.
export const DEFAULT_CAP_USD = 20; // free credits are $25; keep a margin for console/other use
export const DEFAULT_MAX_TOKENS = 8000;

export class BudgetExceededError extends Error {
  constructor(public readonly spentUsd: number, public readonly worstCaseUsd: number, public readonly capUsd: number) {
    super(`Kacheri budget cap: refusing call (spent $${spentUsd.toFixed(4)} + worst case $${worstCaseUsd.toFixed(4)} > cap $${capUsd.toFixed(2)}). Raise KACHERI_BUDGET_USD only if you have more free credits.`);
  }
}

interface Ledger {
  spentUsd: number;
  calls: number;
  updatedAt: string;
}

export function worstCaseUsd(req: ChatRequest): number {
  const m = MODELS[req.tier];
  // ~4 chars per token is typical; use 3 so the estimate errs high.
  const promptTokens = Math.ceil(req.messages.reduce((n, x) => n + x.content.length, 0) / 3) + 50;
  const outTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS;
  return (promptTokens * m.inPerM + outTokens * m.outPerM) / 1e6;
}

export function withBudget(inner: LlmClient, opts: { capUsd?: number; ledgerPath?: string } = {}): LlmClient & { spent(): number } {
  const capUsd = opts.capUsd ?? DEFAULT_CAP_USD;
  const ledgerPath = opts.ledgerPath ?? path.join(homedir(), '.kacheri', 'spend.json');
  const read = (): Ledger => {
    try {
      return JSON.parse(readFileSync(ledgerPath, 'utf8')) as Ledger;
    } catch {
      return { spentUsd: 0, calls: 0, updatedAt: new Date().toISOString() };
    }
  };
  const write = (l: Ledger) => {
    mkdirSync(path.dirname(ledgerPath), { recursive: true });
    const tmp = `${ledgerPath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(l, null, 2));
    renameSync(tmp, ledgerPath);
  };
  // Reserved worst-case cost of calls in flight in this process, so parallel calls cannot jointly overshoot.
  let reserved = 0;
  return {
    spent: () => read().spentUsd,
    async chat(req: ChatRequest): Promise<ChatResponse> {
      const worst = worstCaseUsd(req);
      const spent = read().spentUsd;
      if (spent + reserved + worst > capUsd) throw new BudgetExceededError(spent + reserved, worst, capUsd);
      reserved += worst;
      // Force an output limit so the worst-case estimate is a real bound.
      const bounded = { ...req, maxTokens: req.maxTokens ?? DEFAULT_MAX_TOKENS };
      try {
        const res = await inner.chat(bounded);
        const l = read();
        write({ spentUsd: l.spentUsd + res.usage.costUsd, calls: l.calls + 1, updatedAt: new Date().toISOString() });
        return res;
      } finally {
        reserved -= worst;
      }
    },
  };
}
