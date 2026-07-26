import { useEffect, useRef } from 'react';

const LEVEL_STYLES = {
  info: 'text-dim',
  warn: 'text-[var(--warning)]',
  error: 'text-[var(--danger)]',
  success: 'text-[var(--success)]',
};

export default function LogPanel({ logs, live }) {
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-token bg-[var(--surface2)] px-4 py-2.5">
        <h3 className="card-title">Live logs</h3>
        <span className="flex items-center gap-1.5 text-xs text-dim">
          {live && <span className="live-dot h-2 w-2 rounded-full bg-[var(--accent)]" />}
          {live ? 'streaming' : `${logs.length} lines`}
        </span>
      </div>
      <div className="log-scroll h-64 overflow-y-auto bg-[var(--bg)] px-4 py-3 font-mono text-xs leading-relaxed">
        {logs.length === 0 && (
          <p className="text-dim">No logs yet. Start a scrape to see live output.</p>
        )}
        {logs.map((l, i) => (
          <div key={i} className={LEVEL_STYLES[l.level] || LEVEL_STYLES.info}>
            <span className="text-dim">{new Date(l.ts).toLocaleTimeString()} </span>
            {l.message}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
