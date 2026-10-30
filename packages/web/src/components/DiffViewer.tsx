import { Fragment, useMemo } from 'react';
import type { FileChange, TaskDiff, Verdict } from '@kacheri/shared';
import {
  parsePatch,
  placeFindings,
  sortFindings,
  verdictFindings,
  type DiffLine,
  type PatchFile,
  type PlacedFinding,
} from '../diff';

export interface DiffViewerProps {
  diff: TaskDiff;
  verdicts: Verdict[];
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

const LINE_PREFIX: Record<DiffLine['kind'], string> = { add: '+', del: '-', context: ' ', meta: '' };

function FileBlock({
  file,
  change,
  byLine,
  unplaced,
}: {
  file: PatchFile;
  change: FileChange | undefined;
  byLine: Map<number, PlacedFinding[]>;
  unplaced: PlacedFinding[];
}) {
  return (
    <section className="diff-file" aria-label={file.path}>
      <header className="diff-file-head">
        <span className="diff-path">
          {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
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
                  <td colSpan={3}>{hunk.header}</td>
                </tr>
                {hunk.lines.map((line, li) => {
                  const notes = line.kind !== 'del' && line.newNo !== null ? byLine.get(line.newNo) : undefined;
                  return (
                    <Fragment key={li}>
                      <tr className={`line line-${line.kind}`}>
                        <td className="ln">{line.oldNo ?? ''}</td>
                        <td className="ln">{line.newNo ?? ''}</td>
                        <td className="code">
                          <span className="prefix">{LINE_PREFIX[line.kind]}</span>
                          {line.text}
                        </td>
                      </tr>
                      {notes && (
                        <tr className="inline-findings">
                          <td colSpan={3}>
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

export function DiffViewer({ diff, verdicts }: DiffViewerProps) {
  const files = useMemo(() => parsePatch(diff.patch), [diff.patch]);
  const placement = useMemo(() => placeFindings(files, verdictFindings(verdicts)), [files, verdicts]);
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
