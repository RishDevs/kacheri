import { Fragment, useMemo } from 'react';
import type { FileChange, TaskDiff, Verdict } from '@kacheri/shared';
import {
  anchorKey,
  locateLine,
  parsePatch,
  placeFindings,
  sortFindings,
  verdictFindings,
  type DiffLine,
  type PatchFile,
  type PlacedFinding,
} from '../diff';

export type DiffMarkerTone = 'convicted' | 'dismissed' | 'pending';

// A charge pinned to a diff line; rendered as a gutter marker.
export interface DiffMarker {
  id: string;
  file: string;
  line: number | null;
  label: string;
  tone: DiffMarkerTone;
  title: string;
}

export interface DiffViewerProps {
  diff: TaskDiff;
  verdicts: Verdict[];
  markers?: DiffMarker[];
  activeMarkerId?: string | null;
  onMarkerClick?(id: string): void;
}

interface FileMarkers {
  byLine: Map<number, DiffMarker[]>;
  fileLevel: DiffMarker[];
}

const NO_MARKERS: FileMarkers = { byLine: new Map(), fileLevel: [] };

function placeMarkers(files: PatchFile[], markers: DiffMarker[]): Map<string, FileMarkers> {
  const byFile = new Map<string, FileMarkers>();
  for (const m of markers) {
    const loc = locateLine(files, m.file, m.line);
    if (!loc) continue;
    let entry = byFile.get(loc.path);
    if (!entry) {
      entry = { byLine: new Map(), fileLevel: [] };
      byFile.set(loc.path, entry);
    }
    if (loc.line === null) {
      entry.fileLevel.push(m);
    } else {
      const list = entry.byLine.get(loc.line) ?? [];
      list.push(m);
      entry.byLine.set(loc.line, list);
    }
  }
  return byFile;
}

function FindingNote({ finding }: { finding: PlacedFinding }) {
  return (
    <div className={`finding severity-${finding.severity}`} role="note" data-severity={finding.severity}>
      <span className="finding-head">
        <strong>{finding.severity}</strong> · {finding.reviewer}
        {finding.line !== null && <> · {finding.file}:{finding.line}</>}
      </span>
      <span className="finding-message">{finding.message}</span>
      {finding.suggestion && <span className="finding-suggestion">Suggestion: {finding.suggestion}</span>}
    </div>
  );
}

function FindingList({ findings }: { findings: PlacedFinding[] }) {
  return (
    <>
      {sortFindings(findings).map((f, i) => (
        <FindingNote key={i} finding={f} />
      ))}
    </>
  );
}

function MarkerButtons({
  markers,
  activeId,
  onClick,
}: {
  markers: DiffMarker[];
  activeId: string | null;
  onClick?(id: string): void;
}) {
  return (
    <>
      {markers.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`gutter-mark mark-${m.tone}${m.id === activeId ? ' mark-active' : ''}`}
          aria-label={`Go to charge ${m.id}`}
          aria-pressed={m.id === activeId}
          title={m.title}
          onClick={() => onClick?.(m.id)}
        >
          {m.label}
        </button>
      ))}
    </>
  );
}

const LINE_PREFIX: Record<DiffLine['kind'], string> = { add: '+', del: '-', context: ' ', meta: '' };
const COLS = 4;

function FileBlock({
  file,
  change,
  byLine,
  unplaced,
  marks,
  activeId,
  onMarkerClick,
}: {
  file: PatchFile;
  change: FileChange | undefined;
  byLine: Map<number, PlacedFinding[]>;
  unplaced: PlacedFinding[];
  marks: FileMarkers;
  activeId: string | null;
  onMarkerClick?(id: string): void;
}) {
  const fileActive = activeId !== null && marks.fileLevel.some((m) => m.id === activeId);
  return (
    <section
      className={`diff-file${fileActive ? ' file-active' : ''}`}
      aria-label={file.path}
      data-anchor={marks.fileLevel.length > 0 ? anchorKey(file.path, null) : undefined}
    >
      <header className="diff-file-head">
        <span className="diff-path">
          {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
        {marks.fileLevel.length > 0 && (
          <span className="file-marks">
            <MarkerButtons markers={marks.fileLevel} activeId={activeId} onClick={onMarkerClick} />
          </span>
        )}
        {change && (
          <span className="diff-stats">
            <span className="kind">{change.kind}</span> <span className="adds">+{change.additions}</span>{' '}
            <span className="dels">-{change.deletions}</span>
          </span>
        )}
      </header>
      {unplaced.length > 0 && (
        <div className="file-findings">
          <FindingList findings={unplaced} />
        </div>
      )}
      {file.binary && <p className="muted">Binary file not shown.</p>}
      {file.hunks.length > 0 && (
        <table className="diff-table">
          <tbody>
            {file.hunks.map((hunk, hi) => (
              <Fragment key={hi}>
                <tr className="hunk-header">
                  <td colSpan={COLS}>{hunk.header}</td>
                </tr>
                {hunk.lines.map((line, li) => {
                  const onNew = line.kind !== 'del' && line.newNo !== null;
                  const notes = onNew && line.newNo !== null ? byLine.get(line.newNo) : undefined;
                  const lineMarks = onNew && line.newNo !== null ? marks.byLine.get(line.newNo) : undefined;
                  const active = activeId !== null && lineMarks !== undefined && lineMarks.some((m) => m.id === activeId);
                  return (
                    <Fragment key={li}>
                      <tr
                        className={`line line-${line.kind}${lineMarks ? ' line-charged' : ''}${active ? ' line-active' : ''}`}
                        data-anchor={lineMarks ? anchorKey(file.path, line.newNo) : undefined}
                      >
                        <td className="gutter">
                          {lineMarks && <MarkerButtons markers={lineMarks} activeId={activeId} onClick={onMarkerClick} />}
                        </td>
                        <td className="ln">{line.oldNo ?? ''}</td>
                        <td className="ln">{line.newNo ?? ''}</td>
                        <td className="code">
                          <span className="prefix">{LINE_PREFIX[line.kind]}</span>
                          {line.text}
                        </td>
                      </tr>
                      {notes && (
                        <tr className="inline-findings">
                          <td colSpan={COLS}>
                            <FindingList findings={notes} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function DiffViewer({ diff, verdicts, markers, activeMarkerId = null, onMarkerClick }: DiffViewerProps) {
  const files = useMemo(() => parsePatch(diff.patch), [diff.patch]);
  const placement = useMemo(() => placeFindings(files, verdictFindings(verdicts)), [files, verdicts]);
  const markerPlacement = useMemo(() => placeMarkers(files, markers ?? []), [files, markers]);
  const changes = useMemo(() => new Map(diff.files.map((f) => [f.path, f])), [diff.files]);
  const patchPaths = new Set(files.map((f) => f.path));
  const missing = diff.files.filter((f) => !patchPaths.has(f.path));

  return (
    <div className="diff-viewer">
      <p className="diff-refs muted">
        {diff.baseRef.slice(0, 10)}…{diff.headRef.slice(0, 10)} · {diff.files.length} file
        {diff.files.length === 1 ? '' : 's'} changed
      </p>
      {placement.orphans.length > 0 && (
        <section className="orphan-findings" aria-label="Findings outside the diff">
          <h4>Findings on files outside the diff</h4>
          {sortFindings(placement.orphans).map((f, i) => (
            <div key={i}>
              <code>{f.file}</code>
              <FindingNote finding={f} />
            </div>
          ))}
        </section>
      )}
      {files.length === 0 && diff.files.length === 0 && <p className="muted">No changes.</p>}
      {files.map((file) => {
        const entry = placement.byFile.get(file.path);
        return (
          <FileBlock
            key={file.path}
            file={file}
            change={changes.get(file.path)}
            byLine={entry?.byLine ?? new Map()}
            unplaced={entry?.unplaced ?? []}
            marks={markerPlacement.get(file.path) ?? NO_MARKERS}
            activeId={activeMarkerId}
            onMarkerClick={onMarkerClick}
          />
        );
      })}
      {missing.map((f) => (
        <section key={f.path} className="diff-file" aria-label={f.path}>
          <header className="diff-file-head">
            <span className="diff-path">{f.path}</span>
            <span className="diff-stats">
              <span className="kind">{f.kind}</span> <span className="adds">+{f.additions}</span>{' '}
              <span className="dels">-{f.deletions}</span>
            </span>
          </header>
          <p className="muted">No patch content.</p>
        </section>
      ))}
    </div>
  );
}
