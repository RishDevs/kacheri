import type { AgentId, FileChange, FileChangeKind, Finding, TaskDiff, Verdict } from '@kacheri/shared';

export type DiffLineKind = 'context' | 'add' | 'del' | 'meta';

export interface DiffLine {
  kind: DiffLineKind;
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface PatchFile {
  path: string;
  oldPath: string | null;
  hunks: DiffHunk[];
  binary: boolean;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const GIT_HEADER_RE = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/;

function unquote(p: string): string {
  const s = p.replace(/\t.*$/, '');
  return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

function stripPrefix(p: string): string | null {
  const s = unquote(p.trim());
  if (s === '/dev/null') return null;
  return s.replace(/^[ab]\//, '');
}

export function parsePatch(patch: string): PatchFile[] {
  const files: PatchFile[] = [];
  let file: PatchFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let oldLeft = 0;
  let newLeft = 0;

  const lines = patch.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();

  const startFile = (path: string, oldPath: string | null): PatchFile => {
    const f: PatchFile = { path, oldPath, hunks: [], binary: false };
    files.push(f);
    hunk = null;
    return f;
  };

  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const inHunk = hunk !== null && (oldLeft > 0 || newLeft > 0);

    if (inHunk && hunk) {
      const h: DiffHunk = hunk;
      const tag = line[0];
      if (tag === '+') {
        h.lines.push({ kind: 'add', oldNo: null, newNo, text: line.slice(1) });
        newNo++;
        newLeft--;
        continue;
      }
      if (tag === '-') {
        h.lines.push({ kind: 'del', oldNo, newNo: null, text: line.slice(1) });
        oldNo++;
        oldLeft--;
        continue;
      }
      if (tag === ' ' || line === '') {
        h.lines.push({ kind: 'context', oldNo, newNo, text: line.slice(1) });
        oldNo++;
        newNo++;
        oldLeft--;
        newLeft--;
        continue;
      }
      if (tag === '\\') {
        h.lines.push({ kind: 'meta', oldNo: null, newNo: null, text: line });
        continue;
      }
      // malformed hunk: fall through and treat as a header line
    }

    if (line.startsWith('\\') && hunk) {
      (hunk as DiffHunk).lines.push({ kind: 'meta', oldNo: null, newNo: null, text: line });
      continue;
    }

    if (line.startsWith('diff --git ')) {
      const m = GIT_HEADER_RE.exec(line);
      const a = m ? m[1] : '';
      const b = m ? m[2] : line.slice('diff --git '.length);
      file = startFile(b, a !== b ? a : null);
      continue;
    }

    const hm = HUNK_RE.exec(line);
    if (hm) {
      if (!file) file = startFile('(unknown)', null);
      oldNo = Number(hm[1]);
      newNo = Number(hm[3]);
      oldLeft = hm[2] === undefined ? 1 : Number(hm[2]);
      newLeft = hm[4] === undefined ? 1 : Number(hm[4]);
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
      continue;
    }

    if (line.startsWith('--- ')) {
      const p = stripPrefix(line.slice(4));
      if (!file || file.hunks.length > 0) file = startFile(p ?? '(unknown)', null);
      if (p !== null && p !== file.path) file.oldPath = p;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const p = stripPrefix(line.slice(4));
      if (!file) file = startFile(p ?? '(unknown)', null);
      if (p !== null) {
        file.path = p;
        if (file.oldPath === p) file.oldPath = null;
      }
      continue;
    }
    if (!file) continue;
    if (line.startsWith('rename from ')) file.oldPath = unquote(line.slice('rename from '.length));
    else if (line.startsWith('rename to ')) file.path = unquote(line.slice('rename to '.length));
    else if (line.startsWith('Binary files ') || line === 'GIT binary patch') file.binary = true;
  }

  return files;
}

const NEW_FILE_HUNK_RE = /^@@ -0,0 /;
const DELETED_FILE_HUNK_RE = /^@@ -\d+(?:,\d+)? \+0,0 @@/;

// Builds a TaskDiff (file stats included) from a bare unified diff.
export function patchToDiff(patch: string, baseRef: string, headRef: string): TaskDiff {
  const files: FileChange[] = parsePatch(patch).map((f) => {
    const lines = f.hunks.flatMap((h) => h.lines);
    const headers = f.hunks.map((h) => h.header);
    let kind: FileChangeKind = 'modified';
    if (f.oldPath) kind = 'renamed';
    else if (headers.length > 0 && headers.every((h) => NEW_FILE_HUNK_RE.test(h))) kind = 'added';
    else if (headers.length > 0 && headers.every((h) => DELETED_FILE_HUNK_RE.test(h))) kind = 'deleted';
    return {
      path: f.path,
      ...(f.oldPath ? { oldPath: f.oldPath } : {}),
      kind,
      additions: lines.filter((l) => l.kind === 'add').length,
      deletions: lines.filter((l) => l.kind === 'del').length,
    };
  });
  return { baseRef, headRef, files, patch };
}

export interface PlacedFinding extends Finding {
  reviewer: AgentId;
}

export interface FileFindings {
  byLine: Map<number, PlacedFinding[]>;
  // findings for this file whose line is null or outside the diff hunks
  unplaced: PlacedFinding[];
}

export interface FindingPlacement {
  byFile: Map<string, FileFindings>;
  // findings for files not present in the patch
  orphans: PlacedFinding[];
}

export function normalizePath(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function matchFile(files: PatchFile[], findingPath: string): PatchFile | undefined {
  const p = normalizePath(findingPath);
  const exact = files.find((f) => f.path === p || f.oldPath === p);
  if (exact) return exact;
  const stripped = p.replace(/^[ab]\//, '');
  const byStripped = files.find((f) => f.path === stripped || f.oldPath === stripped);
  if (byStripped) return byStripped;
  return files.find((f) => f.path.endsWith(`/${p}`) || p.endsWith(`/${f.path}`));
}

export interface LineLocation {
  path: string; // path as it appears in the patch
  line: number | null; // null when the line is not shown in the diff (file-level)
}

export function locateLine(files: PatchFile[], file: string, line: number | null): LineLocation | null {
  const match = matchFile(files, file);
  if (!match) return null;
  const visible =
    line !== null &&
    match.hunks.some((h) => h.lines.some((l) => l.newNo === line && (l.kind === 'add' || l.kind === 'context')));
  return { path: match.path, line: visible ? line : null };
}

// Key carried by `data-anchor` on diff rows (and file sections when line is null).
export function anchorKey(path: string, line: number | null): string {
  return `${path}#${line === null ? 'file' : line}`;
}

export function verdictFindings(verdicts: Verdict[]): PlacedFinding[] {
  return verdicts.flatMap((v) => v.findings.map((f) => ({ ...f, reviewer: v.reviewer })));
}

export function placeFindings(files: PatchFile[], findings: PlacedFinding[]): FindingPlacement {
  const byFile = new Map<string, FileFindings>();
  const orphans: PlacedFinding[] = [];

  for (const f of findings) {
    const file = matchFile(files, f.file);
    if (!file) {
      orphans.push(f);
      continue;
    }
    let entry = byFile.get(file.path);
    if (!entry) {
      entry = { byLine: new Map(), unplaced: [] };
      byFile.set(file.path, entry);
    }
    const line = f.line;
    const visible =
      line !== null &&
      file.hunks.some((h) => h.lines.some((l) => l.newNo === line && (l.kind === 'add' || l.kind === 'context')));
    if (visible && line !== null) {
      const list = entry.byLine.get(line) ?? [];
      list.push(f);
      entry.byLine.set(line, list);
    } else {
      entry.unplaced.push(f);
    }
  }
  return { byFile, orphans };
}

const SEVERITY_RANK: Record<Finding['severity'], number> = { critical: 0, major: 1, minor: 2 };

export function sortFindings<T extends Finding>(list: T[]): T[] {
  return list.slice().sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
