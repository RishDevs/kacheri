import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CaseRecord, Charge, Evidence, LlmUsage, Remedy } from '@kacheri/shared';

const DEMO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'demo');

// The hand-written sample case lives with the tests; the shipped demo only contains recorded live runs.
export function readDemo<T>(relPath: string): T {
  const path = relPath === 'cases/demo-1.json' ? join(__dirname, 'fixtures', 'demo-1.json') : join(DEMO_DIR, relPath);
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function makeCharge(id: string, overrides: Partial<Charge> = {}): Charge {
  return {
    id,
    claim: `claim ${id}`,
    file: 'src/a.js',
    line: 3,
    severity: 'major',
    witnessCode: `import { test } from 'node:test';\ntest('${id}', () => {});\n`,
    witnessPath: `__kacheri__/${id}.test.mjs`,
    ...overrides,
  };
}

export function makeEvidence(chargeId: string, admissible: boolean, overrides: Partial<Evidence> = {}): Evidence {
  return {
    chargeId,
    base: ['pass', 'pass', 'pass'],
    head: admissible ? ['fail', 'fail', 'fail'] : ['pass', 'pass', 'pass'],
    admissible,
    reason: admissible ? 'fails on head 3/3, passes on base 3/3' : 'passes on head 3/3',
    headLog: 'not ok 1',
    ...overrides,
  };
}

export function makeUsage(overrides: Partial<LlmUsage> = {}): LlmUsage {
  return {
    tier: 'nano',
    model: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B',
    role: 'prosecutor',
    promptTokens: 1000,
    completionTokens: 500,
    costUsd: 0.00018,
    latencyMs: 1200,
    ...overrides,
  };
}

export function makeRemedy(overrides: Partial<Remedy> = {}): Remedy {
  return {
    chargeIds: ['c1'],
    explanation: 'Restore the original bound.',
    patch: [
      'diff --git a/src/a.js b/src/a.js',
      '--- a/src/a.js',
      '+++ b/src/a.js',
      '@@ -3,1 +3,1 @@',
      '-const end = n - 1;',
      '+const end = n;',
      '',
    ].join('\n'),
    attempts: 1,
    witnesses: [{ chargeId: 'c1', outcomes: ['pass', 'pass', 'pass'] }],
    suite: 'pass',
    suiteLog: 'ℹ tests 4\nℹ pass 4\nℹ fail 0\n',
    verified: true,
    ...overrides,
  };
}

export function makeCase(overrides: Partial<CaseRecord> = {}): CaseRecord {
  return {
    id: 'case1',
    title: 'Add range support',
    repoPath: '/repo',
    baseRef: 'a'.repeat(40),
    headRef: 'b'.repeat(40),
    status: 'filing',
    charges: [],
    evidence: [],
    rebuttals: [],
    rulings: [],
    usage: [],
    error: null,
    startedAt: '2026-10-30T07:00:00.000Z',
    endedAt: null,
    ...overrides,
  };
}
