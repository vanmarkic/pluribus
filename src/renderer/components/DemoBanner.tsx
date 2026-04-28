/**
 * Subtle banner shown when running as a public demo.
 *
 * Renders only if `window.__PLURIBUS_DEMO__` was set by the mock injector
 * — i.e. anywhere outside Electron. Persists a "dismissed" flag in
 * localStorage so it doesn't reappear on every reload.
 */

import { useEffect, useState } from 'react';
import { IconClose, IconSparkles } from 'obra-icons-react';

const STORAGE_KEY = 'pluribus.demoBanner.dismissed';

declare global {
  interface Window {
    __PLURIBUS_DEMO__?: boolean;
  }
}

export function DemoBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const isDemo = typeof window !== 'undefined' && window.__PLURIBUS_DEMO__ === true;
    const dismissed = (() => {
      try {
        return window.localStorage.getItem(STORAGE_KEY) === '1';
      } catch {
        return false;
      }
    })();
    setShow(isDemo && !dismissed);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // localStorage might be blocked — fall back to in-memory.
    }
    setShow(false);
  };

  return (
    <div
      className="flex items-center gap-3 px-4 py-2 text-sm shrink-0"
      style={{
        background: 'linear-gradient(90deg, #2563eb 0%, #7c3aed 100%)',
        color: 'white',
      }}
    >
      <IconSparkles className="w-4 h-4 shrink-0" />
      <span className="flex-1">
        <strong>Demo mode</strong> — all email content is fictional. The AI sort
        button calls Claude through a backend proxy and may be rate-limited.
        Press <kbd className="px-1 rounded bg-white/20 text-xs">?</kbd> for shortcuts.
      </span>
      <a
        href="https://github.com/vanmarkic/pluribus"
        target="_blank"
        rel="noopener noreferrer"
        className="px-2 py-0.5 rounded text-xs hover:bg-white/10"
        style={{ border: '1px solid rgba(255,255,255,0.3)' }}
      >
        View source
      </a>
      <button
        onClick={dismiss}
        className="p-1 rounded hover:bg-white/10 transition-colors"
        aria-label="Dismiss demo banner"
      >
        <IconClose className="w-4 h-4" />
      </button>
    </div>
  );
}
