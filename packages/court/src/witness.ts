import { execFile } from 'node:child_process';
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Charge, Evidence, WitnessOutcome } from '@kacheri/shared';

export const WITNESS_DIR = '__kacheri__';

export interface WitnessOptions {
  // `{file}` is replaced with the absolute witness path and `{root}` with the checkout root.
  // The default runs the witness file directly under Node's permission model:
  // read-only filesystem limited to the checkout, no child processes, no network, no workers.
  command?: string[];
  runs?: number;
  timeoutMs?: number;
}

export const DEFAULT_WITNESS_COMMAND = [process.execPath, '--permission', '--allow-fs-read={root}', '{file}'];

// The prosecutor chooses neither the location nor the name: a model must not be able to overwrite repo files.
export function witnessPathFor(charge: Pick<Charge, 'id'>): string {
  return `${WITNESS_DIR}/${charge.id.replace(/[^A-Za-z0-9_-]/g, '_')}.test.mjs`;
}

// A witness must exercise behaviour through the code's API. These would let it "prove" a bug by
// inspecting source text, the environment or the clock instead, so such witnesses are inadmissible.
const FORBIDDEN: [RegExp, string][] = [
  [/\b(?:node:)?(?:fs|fs\/promises|child_process|net|http|https|dgram|worker_threads|vm|module|os|process)['"]/, 'imports a system module'],
  [/\brequire\s*\(/, 'uses require()'],
  [/\bimport\s*\(/, 'uses dynamic import()'],
  [/\bprocess\s*\.\s*(?:env|argv|version|versions|cwd|platform|binding|hrtime)\b/, 'reads process state'],
  [/\bimport\.meta\b|__dirname|__filename/, 'inspects file locations'],
  [/\bDate\.now\b|\bnew Date\(\s*\)|Math\.random|performance\.now|setTimeout|setInterval/, 'depends on time or randomness'],
  [/\bfetch\s*\(|\bWebSocket\b|\beval\s*\(|\bFunction\s*\(/, 'uses network or eval'],
  [/\.toString\s*\(\s*\)\s*\.(?:includes|match|indexOf|search)|\.source\b/, 'inspects function source'],
];

export function lintWitness(code: string): string | null {
  for (const [re, why] of FORBIDDEN) if (re.test(code)) return why;
  if (!/from\s+['"]\.\.?\//.test(code)) return 'does not import the code under test';
  return null;
}

// Signs that the witness itself is broken rather than that it caught a bug. On the head side only the
// sandbox denial counts: a missing export or ReferenceError there can be the regression itself.
const BROKEN = [/SyntaxError/, /ERR_MODULE_NOT_FOUND/, /Cannot find module/, /does not provide an export named/, /ReferenceError: \w+ is not defined/, /ERR_ACCESS_DENIED/, /ERR_CHILD_PROCESS_STDIO_MAXBUFFER/, /^# tests 0$/m];

export function classify(code: number | null, timedOut: boolean, output: string): WitnessOutcome {
  if (timedOut) return 'timeout';
  if (code === 0) return /^# tests 0$/m.test(output) ? 'error' : 'pass';
  return BROKEN.some((re) => re.test(output)) ? 'error' : 'fail';
}

const SANDBOX_DENIED = /ERR_ACCESS_DENIED|ERR_CHILD_PROCESS_STDIO_MAXBUFFER/;

function runOnce(cmd: string[], cwd: string, timeoutMs: number): Promise<{ outcome: WitnessOutcome; output: string }> {
  return new Promise((resolve) => {
    const [bin, ...args] = cmd;
    // Minimal environment: the witness must not see API keys or anything else from the parent.
    execFile(bin, args, { cwd, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', NODE_OPTIONS: '' } }, (err, stdout, stderr) => {
      const output = `${stdout}\n${stderr}${err && (err as { code?: unknown }).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? '\nERR_CHILD_PROCESS_STDIO_MAXBUFFER' : ''}`;
      const timedOut = Boolean(err && (err as NodeJS.ErrnoException & { killed?: boolean }).killed);
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
      resolve({ outcome: classify(code, timedOut, output), output });
    });
  });
}

export async function runWitness(checkoutRoot: string, charge: Charge, opts: WitnessOptions = {}): Promise<{ outcomes: WitnessOutcome[]; lastOutput: string }> {
  // Node's permission model compares real paths (on macOS /var is a symlink to /private/var).
  const root = await realpath(checkoutRoot);
  const rel = witnessPathFor(charge);
  const file = path.join(root, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, charge.witnessCode);
  const cmd = (opts.command ?? DEFAULT_WITNESS_COMMAND).map((a) => a.replaceAll('{file}', file).replaceAll('{root}', root));
  const outcomes: WitnessOutcome[] = [];
  let lastOutput = '';
  try {
    for (let i = 0; i < (opts.runs ?? 3); i++) {
      const r = await runOnce(cmd, root, opts.timeoutMs ?? 20_000);
      outcomes.push(r.outcome);
      lastOutput = r.output;
      // An error on the first run will not turn into evidence; skip the repeats.
      if (r.outcome === 'error') break;
    }
  } finally {
    await rm(file, { force: true });
  }
  return { outcomes, lastOutput };
}

export function judgeAdmissibility(chargeId: string, base: WitnessOutcome[], head: WitnessOutcome[], headLog: string): Evidence {
  const n = (xs: WitnessOutcome[], o: WitnessOutcome) => xs.filter((x) => x === o).length;
  let admissible = false;
  let reason: string;
  const basePasses = base.length > 0 && n(base, 'pass') === base.length;
  if (base.includes('error')) reason = 'witness is broken (errors on base)';
  else if (head.includes('error') && SANDBOX_DENIED.test(headLog)) reason = 'witness violated the sandbox on head';
  else if (basePasses && head.length > 0 && n(head, 'error') === head.length) {
    // Works on base, cannot even load on head: e.g. a removed export. That is a breaking change.
    admissible = true;
    reason = 'passes on base, crashes on head (breaking change)';
  } else if (head.includes('error')) reason = 'witness is broken (errors on head)';
  else if (base.includes('timeout') || head.includes('timeout')) reason = 'witness timed out';
  else if (n(head, 'fail') === head.length && n(base, 'pass') === base.length) {
    admissible = true;
    reason = `fails on head ${head.length}/${head.length}, passes on base ${base.length}/${base.length}`;
  } else if (n(head, 'pass') === head.length) reason = 'witness passes on head: no bug demonstrated';
  else if (n(base, 'fail') > 0 && n(head, 'fail') === head.length) reason = 'witness also fails on base: pre-existing behaviour, not introduced by this change';
  else reason = `flaky witness (head ${n(head, 'fail')}/${head.length} fail, base ${n(base, 'pass')}/${base.length} pass)`;
  return { chargeId, base, head, admissible, reason, headLog: headLog.trim().slice(-3000) };
}
