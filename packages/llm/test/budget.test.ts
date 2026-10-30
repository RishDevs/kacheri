import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChatRequest, LlmClient } from '@kacheri/shared';
import { BudgetExceededError, withBudget, worstCaseUsd } from '../src/budget';

const req = (maxTokens = 1000): ChatRequest => ({ tier: 'ultra', role: 'judge', messages: [{ role: 'user', content: 'x'.repeat(3000) }], maxTokens });
const fake = (cost: number): LlmClient & { n: number } => {
  const c = { n: 0, async chat(r: ChatRequest) { c.n++; return { content: '{}', usage: { tier: r.tier, role: r.role, model: 'm', promptTokens: 1, completionTokens: 1, costUsd: cost, latencyMs: 1 } }; } };
  return c;
};

describe('budget cap', () => {
  it('estimates worst case from prompt size and output limit', () => {
    expect(worstCaseUsd(req(1000))).toBeCloseTo((1050 * 1 + 1000 * 3) / 1e6, 6);
  });
  it('persists spend across clients and refuses calls that could exceed the cap', async () => {
    const ledgerPath = path.join(mkdtempSync(path.join(tmpdir(), 'kb-')), 'spend.json');
    const inner = fake(0.007);
    const a = withBudget(inner, { capUsd: 0.01, ledgerPath });
    await a.chat(req());
    // A new process (new client) sees the same ledger.
    const b = withBudget(inner, { capUsd: 0.01, ledgerPath });
    expect(b.spent()).toBeCloseTo(0.007);
    await expect(b.chat(req())).rejects.toBeInstanceOf(BudgetExceededError);
    expect(inner.n).toBe(1); // the refused call never reached the API
  });
  it('counts in-flight reservations so parallel calls cannot jointly overshoot', async () => {
    const ledgerPath = path.join(mkdtempSync(path.join(tmpdir(), 'kb-')), 'spend.json');
    const c = withBudget(fake(0), { capUsd: worstCaseUsd(req()) * 1.5, ledgerPath });
    const results = await Promise.allSettled([c.chat(req()), c.chat(req())]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
  });
});
