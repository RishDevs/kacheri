import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatRequest } from '@kacheri/shared';
import { createTokenFactoryClient, createReplayClient, replayKey, createClientFromEnv } from '../src/index.js';
const req: ChatRequest = { tier: 'nano', role: 'prosecutor', messages: [{ role: 'user', content: 'Return JSON' }], json: true, reasoning: false, temperature: 0.2, maxTokens: 100 };
const payload = { choices: [{ message: { content: '<think>secret</think> {"ok":true}', reasoning_content: 'private' } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } };
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it('sends documented request fields and strips reasoning while accounting for tokens', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(payload));
  const result = await createTokenFactoryClient({ apiKey: 'test', baseUrl: 'https://example.test/v1/', fetch }).chat(req);
  expect(fetch.mock.calls[0][0]).toBe('https://example.test/v1/chat/completions');
  const init = fetch.mock.calls[0][1]!;
  expect(JSON.parse(init.body as string)).toEqual({ model: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B', messages: req.messages, max_tokens: 100, temperature: 0.2, response_format: { type: 'json_object' }, chat_template_kwargs: { enable_thinking: false } });
  expect(init.signal).toBeInstanceOf(AbortSignal);
  expect(result.content).toBe('{"ok":true}');
  expect(result.usage.costUsd).toBeCloseTo(0.00018);
});
it('honours Retry-After and retries 429', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '2' } })).mockResolvedValue(Response.json(payload));
  const result = createTokenFactoryClient({ apiKey: 'test', fetch }).chat(req);
  await vi.advanceTimersByTimeAsync(1999); expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); await result; expect(fetch).toHaveBeenCalledTimes(2);
});
it('limits retries and fails immediately on non-retryable errors', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response('busy', { status: 503, headers: { 'Retry-After': '0' } }));
  await expect(createTokenFactoryClient({ apiKey: 'test', fetch }).chat(req)).rejects.toThrow('503');
  expect(fetch).toHaveBeenCalledTimes(5);
  fetch.mockClear().mockImplementation(async () => new Response('bad', { status: 400 }));
  await expect(createTokenFactoryClient({ apiKey: 'test', fetch }).chat(req)).rejects.toThrow('400');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('records fixtures, replays without live access, and names missing keys', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kacheri-llm-'));
  try {
    const live = createTokenFactoryClient({ apiKey: 'test', fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload)) });
    const result = await createReplayClient({ dir, live, mode: 'record' }).chat(req);
    const replay = createReplayClient({ dir, mode: 'replay' });
    expect(await replay.chat(req)).toEqual(result);
    const missing = { ...req, temperature: 1 };
    await expect(replay.chat(missing)).rejects.toThrow(replayKey(missing));
    expect((await replay.chat({ ...req, role: 'judge' })).usage.role).toBe('judge');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it('validates environment selection', () => {
  vi.stubEnv('KACHERI_LLM', 'invalid');
  expect(createClientFromEnv).toThrow('Invalid KACHERI_LLM');
});
