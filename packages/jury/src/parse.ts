import type { AgentId, Finding, ParseVerdictResult, Severity, Verdict } from '@kacheri/shared';

const MAX_INPUT = 5 * 1024 * 1024;
const SEVERITIES: readonly Severity[] = ['critical', 'major', 'minor'];
const FENCE = /```[ \t]*([A-Za-z0-9_-]*)[^\n]*\n([\s\S]*?)```/g;

type Validated = { ok: true; verdict: Verdict } | { ok: false; error: string };

// Agents often emit trailing commas; strip them only outside string literals.
function stripTrailingCommas(src: string): string {
  let out = '';
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      out += c;
      if (c === '\\') out += src[++i] ?? '';
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    if (c === ',') {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (src[j] === '}' || src[j] === ']') continue;
    }
    out += c;
  }
  return out;
}

function parseJson(src: string): unknown {
  try {
    return JSON.parse(src);
  } catch {
    try {
      return JSON.parse(stripTrailingCommas(src));
    } catch {
      return undefined;
    }
  }
}

function validate(value: unknown, reviewer: AgentId): Validated {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'verdict must be a JSON object' };
  const v = value as Record<string, unknown>;
  const status = typeof v.status === 'string' ? v.status.trim().toUpperCase() : '';
  if (status !== 'PASS' && status !== 'FAIL') return { ok: false, error: `status must be PASS or FAIL, got ${JSON.stringify(v.status)}` };
  if (v.summary !== undefined && v.summary !== null && typeof v.summary !== 'string') return { ok: false, error: 'summary must be a string' };
  const rawFindings = v.findings ?? [];
  if (!Array.isArray(rawFindings)) return { ok: false, error: 'findings must be an array' };

  const findings: Finding[] = [];
  for (const [i, f] of rawFindings.entries()) {
    if (!f || typeof f !== 'object' || Array.isArray(f)) return { ok: false, error: `findings[${i}] must be an object` };
    const r = f as Record<string, unknown>;
    const severity = typeof r.severity === 'string' ? (r.severity.trim().toLowerCase() as Severity) : undefined;
    if (!severity || !SEVERITIES.includes(severity)) return { ok: false, error: `findings[${i}].severity must be one of ${SEVERITIES.join('/')}` };
    if (typeof r.file !== 'string' || !r.file.trim()) return { ok: false, error: `findings[${i}].file must be a non-empty string` };
    if (typeof r.message !== 'string' || !r.message.trim()) return { ok: false, error: `findings[${i}].message must be a non-empty string` };
    let line: number | null = null;
    if (r.line !== undefined && r.line !== null) {
      if (typeof r.line !== 'number' || !Number.isInteger(r.line) || r.line < 1) return { ok: false, error: `findings[${i}].line must be a positive integer or null` };
      line = r.line;
    }
    if (r.suggestion !== undefined && r.suggestion !== null && typeof r.suggestion !== 'string') return { ok: false, error: `findings[${i}].suggestion must be a string or null` };
    findings.push({ severity, file: r.file.trim(), line, message: r.message.trim(), suggestion: (r.suggestion as string | null | undefined) ?? null });
  }

  // A reviewer cannot pass a change it found a critical problem in.
  const finalStatus = status === 'PASS' && findings.some((f) => f.severity === 'critical') ? 'FAIL' : status;
  return { ok: true, verdict: { reviewer, status: finalStatus, summary: ((v.summary as string | undefined) ?? '').trim(), findings } };
}

export function parseVerdict(raw: string, reviewer: AgentId): ParseVerdictResult {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, error: 'empty review output' };
  if (raw.length > MAX_INPUT) return { ok: false, error: `review output exceeds ${MAX_INPUT} bytes` };

  const candidates: string[] = [];
  for (const m of raw.matchAll(FENCE)) {
    const lang = m[1].toLowerCase();
    if (lang === '' || lang === 'json' || lang === 'jsonc') candidates.push(m[2]);
  }
  const trimmed = raw.trim();
  if (candidates.length === 0) {
    candidates.push(trimmed);
    // Bare object embedded in prose.
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start > 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  }

  // Last valid block wins: reviewers often show an example before their real answer.
  let lastError = 'no JSON verdict found';
  for (let i = candidates.length - 1; i >= 0; i--) {
    const value = parseJson(candidates[i].trim());
    if (value === undefined) {
      lastError = 'verdict block is not valid JSON';
      continue;
    }
    const r = validate(value, reviewer);
    if (r.ok) return r;
    lastError = r.error;
  }
  return { ok: false, error: lastError };
}
