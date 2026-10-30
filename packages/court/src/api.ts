import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Loads each changed module in the same sandbox witnesses use and describes what a test can actually import.
// Models otherwise guess at internal helpers that are not exported and lose otherwise-correct charges.
const PROBE = `
const [file, rel] = process.argv.slice(1);
const sig = (f) => { const m = /^[^(]*\\(([^)]*)\\)/.exec(Function.prototype.toString.call(f)); return m ? m[1].replace(/\\s+/g, ' ').trim() : ''; };
const kind = (v) => typeof v === 'function' ? 'function(' + sig(v) + ')' : Array.isArray(v) ? 'array' : typeof v;
const m = await import(file);
const out = [];
if ('default' in m) out.push("import x from '../" + rel + "'  // default export: " + kind(m.default));
const named = Object.keys(m).filter((k) => k !== 'default');
if (named.length) out.push("import { " + named.join(', ') + " } from '../" + rel + "'  // " + named.map((k) => k + ': ' + kind(m[k])).join('; '));
if (!out.length) out.push("../" + rel + ': no exports');
console.log(out.join('\\n'));
`;

function probe(root: string, file: string, rel: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--permission', `--allow-fs-read=${root}`, '--input-type=module', '-e', PROBE, pathToFileURL(file).href, rel],
      { cwd: root, timeout: 10_000, env: { PATH: process.env.PATH ?? '', NODE_OPTIONS: '' } },
      (err, stdout) => resolve(err ? `../${rel}: could not be loaded` : stdout.trim()),
    );
  });
}

export async function describeApi(checkoutRoot: string, files: string[]): Promise<string> {
  const root = await realpath(checkoutRoot);
  const js = files.filter((f) => /\.(m|c)?js$/.test(f) && !/(^|\/)(test|tests|__tests__)\/|\.test\.|\.spec\./.test(f));
  const lines = await Promise.all(js.slice(0, 8).map((f) => probe(root, path.join(root, f), f)));
  return lines.join('\n');
}
