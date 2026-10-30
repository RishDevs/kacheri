import type { ReactNode } from 'react';

export type View = 'board' | 'court' | 'bench';

export interface TopNavProps {
  view: View;
  showBoard: boolean;
}

export function TopNav({ view, showBoard }: TopNavProps) {
  const link = (target: View, href: string, label: string) => (
    <a href={href} className="nav-link" aria-current={view === target ? 'page' : undefined}>
      {label}
    </a>
  );
  return (
    <nav className="site-nav" aria-label="Sections">
      {link('court', '#/court', 'Docket')}
      {link('bench', '#/bench', 'Court record')}
      {showBoard && link('board', '#/', 'Board')}
    </nav>
  );
}

export interface MastheadProps {
  nav?: ReactNode;
  status?: ReactNode;
}

export function Masthead({ nav, status }: MastheadProps) {
  return (
    <header className="masthead">
      <div className="masthead-inner">
        <span className="wordmark">Kacheri</span>
        {nav}
        <p className="masthead-aside">
          <span>Judges: NVIDIA Nemotron on Nebius Token Factory</span>
          {status}
        </p>
      </div>
    </header>
  );
}
