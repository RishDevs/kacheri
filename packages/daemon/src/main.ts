// @ts-ignore -- Court workspace is supplied by the parallel T6 implementation.
import { runCase, runBaseline } from '@kacheri/court';
import { createClientFromEnv } from '@kacheri/llm';
import { resolve } from 'node:path';
// Implemented by the parallel git-engine task; resolved at integration.
// @ts-ignore -- workspace package is not present until integration
import { createGitEngine } from '@kacheri/git-engine';
// Implemented by the parallel jury task; resolved at integration.
// @ts-ignore -- workspace package is not present until integration
import { parseVerdict, buildReviewPrompt } from '@kacheri/jury';
import { createServer, createStore, createAdapters } from './index.js';
const repoRoot = resolve(process.env.KACHERI_REPO_ROOT ?? process.cwd());
const store = createStore(process.env.KACHERI_DB_PATH ?? resolve(repoRoot, 'kacheri.sqlite'));
const server = createServer({ engine: createGitEngine(repoRoot), store, adapters: createAdapters(), repoRoot, parseVerdict, buildReviewPrompt, runCase, llm: createClientFromEnv() });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void server.close().then(() => store.close()); });
await server.listen({ host: '127.0.0.1', port: 4317 });
