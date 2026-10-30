import { useEffect, useState } from 'react';

type CopyState = 'idle' | 'copied' | 'failed';

export interface CopyButtonProps {
  text: string;
  label: string;
  className: string;
  copiedLabel?: string;
  copiedNote: string;
  failedNote: string;
}

export function CopyButton({ text, label, className, copiedLabel = 'Copied', copiedNote, failedNote }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 2500);
    return () => clearTimeout(t);
  }, [state]);

  async function copy() {
    try {
      const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
      if (!clip) throw new Error('clipboard unavailable');
      await clip.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={() => void copy()}>
        {state === 'copied' ? copiedLabel : state === 'failed' ? 'Copy failed' : label}
      </button>
      <span className="sr-only" aria-live="polite">
        {state === 'copied' ? copiedNote : state === 'failed' ? failedNote : ''}
      </span>
    </>
  );
}
