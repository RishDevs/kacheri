import type { Task, TaskDiff, Verdict } from '@kacheri/shared';

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't_abc123',
    title: 'Add widget',
    prompt: 'Build the widget',
    agent: 'cursor',
    reviewers: ['codex'],
    ownedPaths: ['packages/web/**'],
    status: 'queued',
    branch: null,
    worktreePath: null,
    error: null,
    createdAt: '2026-10-30T07:00:00.000Z',
    updatedAt: '2026-10-30T07:00:00.000Z',
    ...overrides,
  };
}

export const PATCH = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,4 +1,5 @@',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  '+const secret = "hunter2";',
  ' const c = 4;',
  ' export { a, b, c };',
  'diff --git a/README.md b/README.md',
  'new file mode 100644',
  'index 0000000..3333333',
  '--- /dev/null',
  '+++ b/README.md',
  '@@ -0,0 +1,2 @@',
  '+# Title',
  '+text',
  '\\ No newline at end of file',
  '',
].join('\n');

export const DIFF: TaskDiff = {
  baseRef: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  headRef: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  files: [
    { path: 'src/app.ts', kind: 'modified', additions: 2, deletions: 1 },
    { path: 'README.md', kind: 'added', additions: 2, deletions: 0 },
  ],
  patch: PATCH,
};

export const VERDICTS: Verdict[] = [
  {
    reviewer: 'codex',
    status: 'FAIL',
    summary: 'Hardcoded secret',
    findings: [
      {
        severity: 'critical',
        file: 'src/app.ts',
        line: 3,
        message: 'Secret committed to source',
        suggestion: 'Read it from env',
      },
      { severity: 'minor', file: 'README.md', line: null, message: 'Readme is thin', suggestion: null },
      { severity: 'major', file: 'src/other.ts', line: 10, message: 'Touches unrelated file', suggestion: null },
    ],
  },
];
