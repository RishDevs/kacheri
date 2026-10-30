import { describe, expect, it } from 'vitest';
import { normalizePath, parsePatch, placeFindings, sortFindings, verdictFindings } from '../src/diff';
import { PATCH, VERDICTS } from './fixtures';

describe('parsePatch', () => {
  it('parses files, hunks and line numbers', () => {
    const files = parsePatch(PATCH);
    expect(files.map((f) => f.path)).toEqual(['src/app.ts', 'README.md']);
    const [app, readme] = files;
    expect(app.oldPath).toBeNull();
    expect(app.hunks).toHaveLength(1);
    expect(app.hunks[0].lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ['context', 1, 1],
      ['del', 2, null],
      ['add', null, 2],
      ['add', null, 3],
      ['context', 3, 4],
      ['context', 4, 5],
    ]);
    expect(readme.hunks[0].lines.map((l) => l.kind)).toEqual(['add', 'add', 'meta']);
  });

  it('handles renames, deletions and binary files', () => {
    const patch = [
      'diff --git a/old/name.ts b/new/name.ts',
      'similarity index 90%',
      'rename from old/name.ts',
      'rename to new/name.ts',
      '--- a/old/name.ts',
      '+++ b/new/name.ts',
      '@@ -1 +1 @@',
      '-x',
      '+y',
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-a',
      '-b',
      'diff --git a/logo.png b/logo.png',
      'Binary files a/logo.png and b/logo.png differ',
    ].join('\n');
    const [renamed, gone, logo] = parsePatch(patch);
    expect(renamed).toMatchObject({ path: 'new/name.ts', oldPath: 'old/name.ts' });
    expect(renamed.hunks[0].lines.map((l) => l.kind)).toEqual(['del', 'add']);
    expect(gone.path).toBe('gone.ts');
    expect(gone.hunks[0].lines).toHaveLength(2);
    expect(logo).toMatchObject({ path: 'logo.png', binary: true, hunks: [] });
  });

  it('treats content lines that look like headers as hunk content', () => {
    const patch = ['--- a/f.txt', '+++ b/f.txt', '@@ -1,2 +1,2 @@', '--- old', '+++ new', ' same'].join('\n');
    const [f] = parsePatch(patch);
    expect(f.path).toBe('f.txt');
    expect(f.hunks[0].lines.map((l) => [l.kind, l.text])).toEqual([
      ['del', '-- old'],
      ['add', '++ new'],
      ['context', 'same'],
    ]);
  });

  it('returns nothing for an empty patch', () => {
    expect(parsePatch('')).toEqual([]);
  });
});

describe('placeFindings', () => {
  it('places by line, file and orphan', () => {
    const files = parsePatch(PATCH);
    const { byFile, orphans } = placeFindings(files, verdictFindings(VERDICTS));
    expect(byFile.get('src/app.ts')?.byLine.get(3)?.[0].message).toBe('Secret committed to source');
    expect(byFile.get('README.md')?.unplaced.map((f) => f.message)).toEqual(['Readme is thin']);
    expect(orphans.map((f) => f.file)).toEqual(['src/other.ts']);
    expect(orphans[0].reviewer).toBe('codex');
  });

  it('does not place findings on deleted-only line numbers', () => {
    const files = parsePatch(['--- a/f', '+++ b/f', '@@ -5,1 +4,0 @@', '-gone'].join('\n'));
    const { byFile } = placeFindings(files, [
      { reviewer: 'claude', severity: 'minor', file: 'f', line: 5, message: 'm', suggestion: null },
    ]);
    expect(byFile.get('f')?.byLine.size).toBe(0);
    expect(byFile.get('f')?.unplaced).toHaveLength(1);
  });

  it('normalizes paths and sorts by severity', () => {
    expect(normalizePath(' ./src\\a.ts ')).toBe('src/a.ts');
    const sorted = sortFindings(verdictFindings(VERDICTS)).map((f) => f.severity);
    expect(sorted).toEqual(['critical', 'major', 'minor']);
  });
});
