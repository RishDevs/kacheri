import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const THEME_KEY = 'kacheri-theme';

function initialTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // storage unavailable (private mode, sandboxed iframe)
  }
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);
  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  return [theme, toggle];
}

export interface TopNavProps {
  view: 'board' | 'court' | 'bench';
  showBoard: boolean;
  theme: Theme;
  onToggleTheme(): void;
}

export function TopNav({ view, showBoard, theme, onToggleTheme }: TopNavProps) {
  const link = (target: TopNavProps['view'], href: string, label: string) => (
    <a href={href} className="top-link" aria-current={view === target ? 'page' : undefined}>
      {label}
    </a>
  );
  return (
    <nav className="top-nav" aria-label="Sections">
      {showBoard && link('board', '#/', 'Board')}
      {link('court', '#/court', 'Court')}
      {link('bench', '#/bench', 'Benchmark')}
      <button
        type="button"
        className="theme-toggle"
        onClick={onToggleTheme}
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      >
        {theme === 'dark' ? 'Light' : 'Dark'}
      </button>
    </nav>
  );
}
