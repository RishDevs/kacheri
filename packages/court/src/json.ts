// Models wrap JSON in prose or fences; take the last object that parses.
export function extractJson(text: string): unknown {
  const candidates: string[] = [];
  for (const m of text.matchAll(/```[a-zA-Z]*\s*\n([\s\S]*?)```/g)) candidates.push(m[1]);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));
  candidates.push(text.trim());
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(candidates[i]);
    } catch {
      // try the next candidate
    }
  }
  throw new Error('model reply contained no parseable JSON');
}
