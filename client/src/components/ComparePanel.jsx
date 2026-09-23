function CountCard({ label, value, accent }) {
  return (
    <div className="subpanel rounded-xl p-3">
      <div className="text-xs text-dim">{label}</div>
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
            download
            target="_blank"
            rel="noreferrer"
            className="btn-primary !px-3 !py-1.5 !text-xs"
          >
            comparison.xlsx
          </a>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CountCard label="People again" value={s.peopleAgain} accent="text-[var(--success)]" />
        <CountCard label="Partners again" value={s.companiesAgain} accent="text-[var(--success)]" />
        <CountCard label="People missing" value={s.peopleMissing} accent="text-[var(--danger)]" />
        <CountCard label="Partners missing" value={s.companiesMissing} accent="text-[var(--danger)]" />
      </div>
      <p className="mt-3 text-xs text-dim">
        Matching: {s.fuzzy ? `fuzzy (threshold ${s.threshold})` : 'exact'} on normalized names.
      </p>
    </div>
  );
}
