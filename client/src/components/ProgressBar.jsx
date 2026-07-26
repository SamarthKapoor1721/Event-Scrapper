export default function ProgressBar({ percent = 0, label, active }) {
  const done = percent >= 100;
  return (
    <div className="card animate-fade-up px-4 py-3">
      <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-dim">
        <span className="flex items-center gap-1.5">
          {active && !done && (
            <span
              className="live-dot h-2 w-2 rounded-full"
              style={{ background: 'var(--accent)' }}
            />
          )}
          {label || (active ? 'Working…' : 'Idle')}
        </span>
        <span className="mono font-semibold tabular-nums text-main">{Math.round(percent)}%</span>
      </div>
      <div className="progress-track">
        <div
          className={`progress-fill ${active && !done ? 'progress-active' : ''}`}
          style={{
            width: `${Math.max(2, percent)}%`,
            background: done ? 'var(--success)' : 'var(--accent)',
          }}
        />
      </div>
    </div>
  );
}
