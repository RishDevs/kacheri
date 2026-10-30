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

// Signs that the witness itself is broken rather than that it caught a bug.
const BROKEN = [
  /SyntaxError/,
  /ERR_MODULE_NOT_FOUND/,
  /Cannot find module/,
  /does not provide an export named/,
  /ReferenceError: \w+ is not defined/,
  /ERR_ACCESS_DENIED/,
  /^# tests 0$/m,
];

export function classify(code: number | null, timedOut: boolean, output: string): WitnessOutcome {
  if (timedOut) return 'timeout';
  if (code === 0) return /^# tests 0$/m.test(output) ? 'error' : 'pass';
  return BROKEN.some((re) => re.test(output)) ? 'error' : 'fail';
}

function runOnce(cmd: string[], cwd: string, timeoutMs: number): Promise<{ outcome: WitnessOutcome; output: string }> {
  return new Promise((resolve) => {
    const [bin, ...args] = cmd;
    execFile(bin, args, { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NODE_OPTIONS: '' } }, (err, stdout, stderr) => {
      const output = `${stdout}\n${stderr}`;
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
  if (base.includes('error') || head.includes('error')) reason = `witness is broken (${base.includes('error') ? 'base' : 'head'} run errored)`;
  else if (base.includes('timeout') || head.includes('timeout')) reason = 'witness timed out';
  else if (n(head, 'fail') === head.length && n(base, 'pass') === base.length) {
    admissible = true;
    reason = `fails on head ${head.length}/${head.length}, passes on base ${base.length}/${base.length}`;
  } else if (n(head, 'pass') === head.length) reason = 'witness passes on head: no bug demonstrated';
  else if (n(base, 'fail') > 0 && n(head, 'fail') === head.length) reason = 'witness also fails on base: pre-existing behaviour, not introduced by this change';
  else reason = `flaky witness (head ${n(head, 'fail')}/${head.length} fail, base ${n(base, 'pass')}/${base.length} pass)`;
  return { chargeId, base, head, admissible, reason, headLog: headLog.trim().slice(-3000) };
}
