import { useEffect, useRef } from 'react';

const LEVEL_STYLES = {
  info: 'text-slate-300',
  warn: 'text-amber-300',
  error: 'text-red-300',
  success: 'text-emerald-300',
};

export default function LogPanel({ logs, live }) {
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/10 bg-slate-900 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-slate-200">Live logs</h3>
        <span className="flex items-center gap-1.5 text-xs text-slate-400">
          {live && <span className="live-dot h-2 w-2 rounded-full bg-indigo-400" />}
          {live ? 'streaming' : `${logs.length} lines`}
        </span>
      </div>
      <div className="log-scroll h-64 overflow-y-auto bg-slate-950 px-4 py-3 font-mono text-xs leading-relaxed">
        {logs.length === 0 && (
          <p className="text-slate-500">No logs yet. Start a scrape to see live output.</p>
        )}
        {logs.map((l, i) => (
          <div key={i} className={LEVEL_STYLES[l.level] || LEVEL_STYLES.info}>
            <span className="text-slate-600">{new Date(l.ts).toLocaleTimeString()} </span>
            {l.message}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
