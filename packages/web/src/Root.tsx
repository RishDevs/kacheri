import { useCallback, useEffect, useState } from 'react';
import type { KacheriApi } from './api';
import { App } from './App';
import type { CourtSource } from './court/source';
import { BenchPage } from './components/court/BenchPage';
import { CourtPage } from './components/court/CourtPage';
import { TopNav, useTheme } from './components/TopNav';

export type Route = { view: 'board' } | { view: 'court'; caseId: string | null } | { view: 'bench' };

export function parseRoute(hash: string): Route {
  if (/^#\/court\/?$/.test(hash)) return { view: 'court', caseId: null };
  const m = /^#\/court\/([^/]+)$/.exec(hash);
  if (m) return { view: 'court', caseId: decodeURIComponent(m[1]) };
  if (/^#\/bench\/?$/.test(hash)) return { view: 'bench' };
  return { view: 'board' };
}

export function routeHash(route: Route): string {
  switch (route.view) {
    case 'board':
      return '#/';
    case 'bench':
      return '#/bench';
    case 'court':
      return route.caseId ? `#/court/${encodeURIComponent(route.caseId)}` : '#/court';
  }
}

export interface RootProps {
  api: KacheriApi | null; // null in static demo mode: no daemon, no task board
  court: CourtSource;
}

export function Root({ api, court }: RootProps) {
  const resolve = useCallback(
    (r: Route): Route => (r.view === 'board' && !api ? { view: 'court', caseId: null } : r),
    [api],
  );
  const [route, setRoute] = useState<Route>(() => resolve(parseRoute(window.location.hash)));
  const [theme, toggleTheme] = useTheme();

  useEffect(() => {
    const sync = () => setRoute(resolve(parseRoute(window.location.hash)));
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, [resolve]);

  const selectCase = useCallback((caseId: string | null) => {
    const next: Route = { view: 'court', caseId };
    const hash = routeHash(next);
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
    setRoute(next);
  }, []);

  const nav = <TopNav view={route.view} showBoard={api !== null} theme={theme} onToggleTheme={toggleTheme} />;

  if (route.view === 'court') {
    return <CourtPage source={court} caseId={route.caseId} onSelect={selectCase} nav={nav} />;
  }
  if (route.view === 'bench' || !api) return <BenchPage source={court} nav={nav} />;
  return <App api={api} nav={nav} />;
}
