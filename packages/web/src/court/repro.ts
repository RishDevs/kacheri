import type { CaseRecord, Charge } from '@kacheri/shared';

export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Shell commands that check out head, write the witness byte-for-byte and run it (expected to fail).
// Same shape as the PR comment repro in packages/ci, so both stay copy-paste compatible.
export function reproCommand(record: Pick<CaseRecord, 'headRef'>, charge: Pick<Charge, 'witnessPath' | 'witnessCode'>): string {
  const path = charge.witnessPath;
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.';
  const script =
    `require('node:fs').mkdirSync(${JSON.stringify(dir)}, { recursive: true }); ` +
    `require('node:fs').writeFileSync(${JSON.stringify(path)}, Buffer.from('${base64Utf8(charge.witnessCode)}', 'base64'));`;
  return [
    '# Run in a clean checkout with dependencies installed.',
    `git checkout --detach ${shellQuote(record.headRef)}`,
    `node -e ${shellQuote(script)}`,
    `node --test ${shellQuote(path)} # expected: FAIL on head`,
  ].join('\n');
}

// A shell command that applies the remedy patch to the current checkout.
export function applyCommand(patch: string): string {
  const body = patch.endsWith('\n') ? patch : `${patch}\n`;
  return `git apply <<'KACHERI_FIX'\n${body}KACHERI_FIX`;
}
