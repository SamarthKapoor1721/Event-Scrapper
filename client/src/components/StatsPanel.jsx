function Stat({ label, value, accent }) {
  return (
    <div className="card stat-card animate-fade-up p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-dim">{label}</div>
      <div className={`stat-value mt-2 text-3xl font-extrabold tracking-tight ${accent || ''}`}>{value}</div>
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
      <Stat label="Speakers" value={speakers} accent="link-accent" />
      <Stat label="Partners" value={companies} accent="text-[var(--info)]" />
      <Stat label="Confidence" value={confidence} accent="text-[var(--success)]" />
      <Stat
        label="Last scrape"
        value={<span className="text-sm font-bold text-dim">{ts}</span>}
      />
    </div>
  );
}
