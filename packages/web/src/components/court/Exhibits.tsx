import type { WitnessOutcome } from '@kacheri/shared';
import type { ExcerptKind, ExcerptLine } from '../../court/judgment';
import { OUTCOME_LABEL } from '../../court/summary';

export function ExhibitLabel({ n, title }: { n: number; title: string }) {
  return (
    <figcaption className="exhibit-head">
      <span className="exhibit">{`EXHIBIT ${n}`}</span>
      <span className="exhibit-title">{title}</span>
    </figcaption>
  );
}

export interface RunRow {
  label: string;
  outcomes: readonly WitnessOutcome[];
}

const MIN_RUNS = 3;

export function RunsExhibit({ n, rows }: { n: number; rows: readonly RunRow[] }) {
  const runs = Math.max(MIN_RUNS, ...rows.map((r) => r.outcomes.length));
  const cols = Array.from({ length: runs }, (_, i) => i);
  return (
    <figure className="exhibit-block">
      <ExhibitLabel n={n} title="Record of trial runs" />
      <div className="runs-wrap">
        <table className="runs" aria-label={`Exhibit ${n}: record of trial runs`}>
          <thead>
            <tr>
              <th scope="col" className="runs-label">
                <span className="sr-only">Code tested</span>
              </th>
              {cols.map((i) => (
                <th key={i} scope="col">{`Run ${i + 1}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {cols.map((i) => {
                  const o: WitnessOutcome | undefined = row.outcomes[i];
                  if (o === undefined) {
                    return (
                      <td key={i} className="cell cell-empty">
                        —
                      </td>
                    );
                  }
                  return (
                    <td key={i} className={`cell ${o === 'pass' ? 'pass' : 'fail'}`}>
                      {OUTCOME_LABEL[o]}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

export function CodeExhibit({ n, title, code }: { n: number; title: string; code: string }) {
  return (
    <figure className="exhibit-block">
      <ExhibitLabel n={n} title={title} />
      <pre className="exhibit-code" tabIndex={0}>
        {code.replace(/\n$/, '')}
      </pre>
    </figure>
  );
}

const ISSUE_NOTE: Partial<Record<ExcerptKind, string>> = {
  del: '← removed by this change',
  add: '← added by this change',
};

const FIX_PREFIX: Record<ExcerptKind, string> = { add: '+ ', del: '- ', context: '  ', gap: '  ', file: '' };

// mode "issue": the charged lines of the diff, changes struck or annotated; mode "fix": the remedy patch.
export function ExcerptLines({ lines, mode }: { lines: readonly ExcerptLine[]; mode: 'issue' | 'fix' }) {
  return (
    <pre className={`exhibit-code exhibit-lines ${mode === 'fix' ? 'fix-patch' : 'lines-at-issue'}`} tabIndex={0}>
      {lines.map((line, i) => {
        const note = mode === 'issue' ? ISSUE_NOTE[line.kind] : undefined;
        const prefix = mode === 'issue' ? (line.kind === 'file' ? '' : '  ') : FIX_PREFIX[line.kind];
        return (
          <span key={i} className={`xl xl-${line.kind}`}>
            <span className="xl-code">{prefix + line.text}</span>
            {note && (
              <>
                {'     '}
                <span className="xl-note">{note}</span>
              </>
            )}
            {i < lines.length - 1 ? '\n' : null}
          </span>
        );
      })}
    </pre>
  );
}
