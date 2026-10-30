import { describe, expect, it } from 'vitest';
import { buildReviewPrompt } from '../src/index';

describe('buildReviewPrompt', () => {
  it('fills placeholders once and never expands placeholders inside the diff', () => {
    const p = buildReviewPrompt({ title: 'T', prompt: 'do {{diff}}', ownedPaths: ['web/**', 'api/x.ts'] }, { patch: '+ {{title}}' });
    expect(p).toContain('do {{diff}}');
    expect(p).toContain('+ {{title}}');
    expect(p).toContain('web/**, api/x.ts');
  });
  it('truncates huge diffs', () => {
    const p = buildReviewPrompt({ title: 'T', prompt: 'p', ownedPaths: [] }, { patch: 'x'.repeat(200_000) });
    expect(p).toContain('[diff truncated');
    expect(p.length).toBeLessThan(160_000);
  });
});
