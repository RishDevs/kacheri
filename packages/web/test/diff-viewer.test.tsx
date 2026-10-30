// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DiffViewer, type DiffMarker } from '../src/components/DiffViewer';
import { DIFF, VERDICTS } from './fixtures';

afterEach(cleanup);

describe('DiffViewer', () => {
  it('renders each file with stats and added/removed lines', () => {
    const { container } = render(<DiffViewer diff={DIFF} verdicts={[]} />);
    const app = screen.getByRole('region', { name: 'src/app.ts' });
    expect(within(app).getByText('+2')).toBeTruthy();
    expect(within(app).getByText('-1')).toBeTruthy();
    expect(container.querySelectorAll('.line-add')).toHaveLength(4);
    expect(container.querySelectorAll('.line-del')).toHaveLength(1);
    expect(within(app).getByText('const b = 2;').closest('tr')?.className).toContain('line-del');
    expect(within(app).getByText('const b = 3;').closest('tr')?.className).toContain('line-add');
    expect(screen.getByRole('region', { name: 'README.md' })).toBeTruthy();
    expect(screen.queryAllByRole('note')).toHaveLength(0);
  });

  it('places line findings inline directly after the referenced line', () => {
    render(<DiffViewer diff={DIFF} verdicts={VERDICTS} />);
    const app = screen.getByRole('region', { name: 'src/app.ts' });
    const note = within(app).getByText('Secret committed to source').closest('[role="note"]') as HTMLElement;
    expect(note.getAttribute('data-severity')).toBe('critical');
    expect(within(note).getByText(/Read it from env/)).toBeTruthy();
    const noteRow = note.closest('tr')!;
    const lineRow = noteRow.previousElementSibling as HTMLElement;
    expect(lineRow.className).toContain('line-add');
    expect(lineRow.textContent).toContain('const secret = "hunter2";');
    expect(within(lineRow).getAllByText('3').length).toBeGreaterThan(0);
  });

  it('shows line-less findings at the file level and unknown files separately', () => {
    render(<DiffViewer diff={DIFF} verdicts={VERDICTS} />);
    const readme = screen.getByRole('region', { name: 'README.md' });
    const thin = within(readme).getByText('Readme is thin').closest('[role="note"]') as HTMLElement;
    expect(thin.closest('tr')).toBeNull();
    const orphans = screen.getByRole('region', { name: 'Findings outside the diff' });
    expect(within(orphans).getByText('Touches unrelated file')).toBeTruthy();
    expect(within(orphans).getByText('src/other.ts')).toBeTruthy();
    expect(screen.getAllByRole('note')).toHaveLength(3);
  });

  it('falls back to file-level when the finding line is not in the diff', () => {
    const verdicts = [
      {
        ...VERDICTS[0],
        findings: [{ severity: 'major' as const, file: './src/app.ts', line: 99, message: 'Far away', suggestion: null }],
      },
    ];
    render(<DiffViewer diff={DIFF} verdicts={verdicts} />);
    const app = screen.getByRole('region', { name: 'src/app.ts' });
    const note = within(app).getByText('Far away').closest('[role="note"]') as HTMLElement;
    expect(note.closest('tr')).toBeNull();
  });

  it('pins markers to charged lines in the gutter, file-level when the line is not shown', () => {
    const onMarkerClick = vi.fn();
    const markers: DiffMarker[] = [
      { id: 'c1', file: './src/app.ts', line: 3, label: 'c1', tone: 'convicted', title: 'c1' },
      { id: 'c2', file: 'README.md', line: 40, label: 'c2', tone: 'dismissed', title: 'c2' },
      { id: 'c3', file: 'src/missing.ts', line: 1, label: 'c3', tone: 'pending', title: 'c3' },
    ];
    render(<DiffViewer diff={DIFF} verdicts={[]} markers={markers} activeMarkerId="c1" onMarkerClick={onMarkerClick} />);
    const app = screen.getByRole('region', { name: 'src/app.ts' });
    const mark = within(app).getByRole('button', { name: 'Go to charge c1' });
    const row = mark.closest('tr')!;
    expect(row.textContent).toContain('const secret = "hunter2";');
    expect(row.className).toContain('line-charged');
    expect(row.className).toContain('line-active');
    expect(row.getAttribute('data-anchor')).toBe('src/app.ts#3');
    fireEvent.click(mark);
    expect(onMarkerClick).toHaveBeenCalledWith('c1');

    const readme = screen.getByRole('region', { name: 'README.md' });
    expect(within(readme).getByRole('button', { name: 'Go to charge c2' }).closest('tr')).toBeNull();
    expect(readme.getAttribute('data-anchor')).toBe('README.md#file');
    expect(screen.queryByRole('button', { name: 'Go to charge c3' })).toBeNull();
  });

  it('renders files listed without patch content', () => {
    render(
      <DiffViewer
        diff={{ ...DIFF, patch: '', files: [{ path: 'img.png', kind: 'added', additions: 0, deletions: 0 }] }}
        verdicts={[]}
      />,
    );
    const img = screen.getByRole('region', { name: 'img.png' });
    expect(within(img).getByText('No patch content.')).toBeTruthy();
  });
});
