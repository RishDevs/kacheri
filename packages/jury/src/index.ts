import { readFileSync } from 'node:fs';
import type { Task, TaskDiff } from '@kacheri/shared';

export { parseVerdict } from './parse';

const MAX_DIFF_CHARS = 150_000;

// Used when prompts/review.md is missing; the file is the source of truth.
const FALLBACK_TEMPLATE = `You are reviewing a change made by another coding agent. Do not edit any files.

Task: {{title}}
Instructions given to the author:
{{prompt}}

The author may only change: {{ownedPaths}}

Check correctness, security, and whether the change stays in scope. Diff:
{{diff}}

End your reply with exactly one fenced json block:
\`\`\`json
{"status":"PASS"|"FAIL","summary":"...","findings":[{"severity":"critical"|"major"|"minor","file":"path","line":1,"message":"...","suggestion":null}]}
\`\`\``;

function loadTemplate(): string {
  try {
    return readFileSync(new URL('../prompts/review.md', import.meta.url), 'utf8');
  } catch {
    return FALLBACK_TEMPLATE;
  }
}

export function buildReviewPrompt(task: Pick<Task, 'title' | 'prompt' | 'ownedPaths'>, diff: Pick<TaskDiff, 'patch'>): string {
  let patch = diff.patch;
  if (patch.length > MAX_DIFF_CHARS) patch = `${patch.slice(0, MAX_DIFF_CHARS)}\n... [diff truncated at ${MAX_DIFF_CHARS} characters]`;
  const values: Record<string, string> = {
    title: task.title,
    prompt: task.prompt,
    ownedPaths: task.ownedPaths.join(', '),
    diff: patch,
  };
  // Single pass so placeholder-like text inside the diff is never expanded.
  return loadTemplate().replace(/\{\{(title|prompt|ownedPaths|diff)\}\}/g, (_, k: string) => values[k]);
}
