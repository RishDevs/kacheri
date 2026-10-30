import { withBudget } from './budget';
export { BudgetExceededError, DEFAULT_CAP_USD, withBudget, worstCaseUsd } from './budget';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MODELS, type ChatRequest, type ChatResponse, type LlmClient } from '@kacheri/shared';

export function createTokenFactoryClient(options: { apiKey?: string; baseUrl?: string; fetch?: typeof fetch } = {}): LlmClient {
  const apiKey = options.apiKey ?? process.env.NEBIUS_API_KEY;
  const endpoint = `${(options.baseUrl ?? 'https://api.tokenfactory.nebius.com/v1/').replace(/\/+$/, '')}/chat/completions`;
  const request = options.fetch ?? globalThis.fetch;
  return { async chat(req) {
    if (!apiKey) throw new Error('NEBIUS_API_KEY is required for live LLM requests');
    const started = Date.now();
    const signal = AbortSignal.timeout(180_000);
    const model = MODELS[req.tier];
    for (let attempt = 0; ; attempt++) {
      const response = await request(endpoint, {
        method: 'POST', signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.id, messages: req.messages, max_tokens: req.maxTokens ?? 4096,
          temperature: req.temperature ?? 0.7,
          ...(req.json ? { response_format: { type: 'json_object' } } : {}),
          ...(req.reasoning !== undefined ? { chat_template_kwargs: { enable_thinking: req.reasoning } } : {}),
        }),
      });
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < 4) {
          const retry = response.headers.get('Retry-After');
          const delay = retry === null ? 1000 * 2 ** attempt : Math.max(0, Number.isFinite(Number(retry)) ? Number(retry) * 1000 : Date.parse(retry) - Date.now());
          await response.body?.cancel();
          await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(signal.reason); };
            const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, Number.isFinite(delay) ? delay : 1000 * 2 ** attempt);
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
          });
          continue;
        }
        throw new Error(`Token Factory HTTP ${response.status}: ${(await response.text()).slice(0, 1000)}`);
      }
      const data = await response.json() as { choices?: { message?: { content?: string | null } }[]; usage?: { prompt_tokens: number; completion_tokens: number } };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !data.usage || !Number.isFinite(data.usage.prompt_tokens) || !Number.isFinite(data.usage.completion_tokens)) throw new Error('Invalid Token Factory response: expected content and token usage');
      return { content: content.replace(/<think\b[^>]*>[\s\S]*?(?:<\/think>|$)/gi, '').trim(), usage: {
        tier: req.tier, model: model.id, role: req.role, promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens,
        costUsd: (data.usage.prompt_tokens * model.inPerM + data.usage.completion_tokens * model.outPerM) / 1_000_000,
        latencyMs: Date.now() - started,
      } };
    }
  } };
}

export function replayKey(req: ChatRequest): string {
  return createHash('sha256').update(JSON.stringify({ tier: req.tier, messages: req.messages, json: req.json, reasoning: req.reasoning, temperature: req.temperature })).digest('hex');
}
export function createReplayClient({ dir, live, mode }: { dir: string; live?: LlmClient; mode: 'replay' | 'record' }): LlmClient {
  return { async chat(req) {
    const key = replayKey(req);
    const path = join(dir, `${key}.json`);
    if (mode === 'replay') {
      try {
        const result = JSON.parse(await readFile(path, 'utf8')) as ChatResponse;
        return { ...result, usage: { ...result.usage, role: req.role } };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Missing LLM replay fixture ${key}: ${path}`);
        throw error;
      }
    }
    if (!live) throw new Error('Record mode requires a live LLM client');
    const result = await live.chat(req);
    await mkdir(dir, { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(result, null, 2));
    await rename(temporary, path);
    return result;
  } };
}
export function createClientFromEnv(): LlmClient {
  const mode = process.env.KACHERI_LLM ?? (process.env.NEBIUS_API_KEY ? 'live' : 'replay');
  if (!['live', 'record', 'replay'].includes(mode)) throw new Error(`Invalid KACHERI_LLM mode: ${mode}`);
  // Every paid client is wrapped in the spending cap; replay mode never calls the API.
  const budget = { capUsd: process.env.KACHERI_BUDGET_USD ? Number(process.env.KACHERI_BUDGET_USD) : undefined };
  if (mode === 'live') return withBudget(createTokenFactoryClient(), budget);
  return createReplayClient({ dir: process.env.KACHERI_FIXTURES ?? './fixtures/llm', mode: mode as 'record' | 'replay', ...(mode === 'record' ? { live: withBudget(createTokenFactoryClient(), budget) } : {}) });
}
