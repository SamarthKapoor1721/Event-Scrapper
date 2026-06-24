function Stat({ label, value, accent }) {
  return (
    <div className="card card-hover animate-fade-up p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-2 text-3xl font-extrabold tracking-tight ${accent || ''}`}>{value}</div>
    </div>
  );
}

export default function StatsPanel({ result }) {
  const speakers = result?.count?.speakers ?? '—';
  const companies = result?.count?.companies ?? '—';
  const ts = result?.meta?.scrapedAt ? new Date(result.meta.scrapedAt).toLocaleString() : '—';
  const confidence =
    result?.confidence !== undefined ? `${Math.round(result.confidence * 100)}%` : '—';

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label="Speakers" value={speakers} accent="text-indigo-600 dark:text-indigo-400" />
      <Stat label="Partners" value={companies} accent="text-violet-600 dark:text-violet-400" />
      <Stat label="Confidence" value={confidence} accent="text-emerald-600 dark:text-emerald-400" />
      <Stat
        label="Last scrape"
        value={<span className="text-sm font-bold text-slate-600 dark:text-slate-300">{ts}</span>}
      />
    </div>
  );
}
