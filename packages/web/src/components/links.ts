import type { MouseEvent } from 'react';

export function caseHref(caseId: string | null): string {
  return caseId ? `#/court/${encodeURIComponent(caseId)}` : '#/court';
}

// Plain clicks navigate inside the app; modified clicks (new tab, new window) keep the browser default.
export function followInApp(e: MouseEvent<HTMLAnchorElement>, go: () => void): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  go();
}
