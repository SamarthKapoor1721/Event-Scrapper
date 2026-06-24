export default function ProgressBar({ percent = 0, label, active }) {
  const done = percent >= 100;
  return (
    <div className="card animate-fade-up px-4 py-3">
      <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5">
          {active && !done && <span className="live-dot h-2 w-2 rounded-full bg-indigo-500" />}
          {label || (active ? 'Working…' : 'Idle')}
        </span>
        <span className="font-bold tabular-nums text-slate-700 dark:text-slate-200">{Math.round(percent)}%</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-white/10">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${
            done
              ? 'bg-gradient-to-r from-emerald-500 to-teal-500'
              : `bg-gradient-to-r from-indigo-500 to-violet-500 ${active ? 'bar-stripes' : ''}`
          }`}
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </div>
    </div>
  );
}
