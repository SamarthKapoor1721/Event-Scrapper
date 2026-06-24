function CountCard({ label, value, accent }) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-3 dark:border-white/10 dark:bg-white/5">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-extrabold ${accent}`}>{value}</div>
    </div>
  );
}

export default function ComparePanel({ comparison, downloadUrl }) {
  if (!comparison) return null;
  const s = comparison.summary;
  return (
    <div className="card animate-fade-up p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold">
          Comparison <span className="gradient-text">{s.baseYear} → {s.targetYear}</span>
        </h3>
        {downloadUrl && (
          <a
            href={downloadUrl}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500"
          >
            comparison.xlsx
          </a>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CountCard label="People again" value={s.peopleAgain} accent="text-emerald-600 dark:text-emerald-400" />
        <CountCard label="Partners again" value={s.companiesAgain} accent="text-emerald-600 dark:text-emerald-400" />
        <CountCard label="People missing" value={s.peopleMissing} accent="text-red-600 dark:text-red-400" />
        <CountCard label="Partners missing" value={s.companiesMissing} accent="text-red-600 dark:text-red-400" />
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Matching: {s.fuzzy ? `fuzzy (threshold ${s.threshold})` : 'exact'} on normalized names.
      </p>
    </div>
  );
}
