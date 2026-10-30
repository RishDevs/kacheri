import { useEffect, useRef } from 'react';
import type { RunLog } from '../state';

export function LogView({ log }: { log: RunLog | undefined }) {
  const ref = useRef<HTMLPreElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [log]);

  const onScroll = () => {
    const el = ref.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  if (!log || log.segments.length === 0) {
    return <p className="muted log-empty">No output received since this page loaded.</p>;
  }
  return (
    <pre className="log" ref={ref} onScroll={onScroll} aria-label="Run log">
      {log.truncated && <span className="muted">… earlier output truncated …{'\n'}</span>}
      {log.segments.map((s, i) => (
        <span key={i} className={`log-${s.stream}`}>
          {s.text}
        </span>
      ))}
    </pre>
  );
}
