import { useState } from 'react';
import { api } from '../api';

/**
 * Batch LinkedIn discovery from a CSV of Name / Designation / Company.
 * Processes every row and offers the enriched CSV for download.
 */
export default function BatchPanel() {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result || ''));
    reader.readAsText(file);
  }

  async function run() {
    setError('');
    setResult(null);
    if (!csv.trim()) return setError('Paste CSV rows or upload a .csv file first.');
    setBusy(true);
    try {
      const data = await api.enrichBatch({ csv });
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card animate-fade-up p-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span>
          <span className="text-sm font-bold">Batch LinkedIn from CSV</span>
          <span className="ml-2 text-xs text-dim">Name, Designation, Company → LinkedIn URL + confidence</span>
        </span>
        <span className="text-xs font-semibold link-accent">{open ? 'Hide' : 'Open'}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="btn-secondary cursor-pointer">
              Upload CSV
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
            </label>
            <span className="text-xs text-dim">or paste below — a header row is auto-detected.</span>
          </div>
          <textarea
            className="input h-28 font-mono text-xs"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={'Name,Designation,Company\nSarah Chen,Director AI,NVIDIA\nJohn Doe,VP Sales,Acme'}
          />
          <div className="flex items-center gap-3">
            <button onClick={run} disabled={busy} className="btn-primary">
              {busy ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Finding…
                </>
              ) : (
                'Find LinkedIn Profiles'
              )}
            </button>
            {result?.downloadUrl && (
              <a href={result.downloadUrl} download target="_blank" rel="noreferrer" className="btn-secondary">Download results CSV</a>
            )}
            {busy && <span className="text-xs text-dim">This can take a few minutes for large lists.</span>}
          </div>

          {error && <p className="text-sm font-medium text-[var(--danger)]">{error}</p>}

          {result?.rows?.length > 0 && (
            <div className="nice-scroll max-h-80 overflow-auto rounded-xl border border-token">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 thead-bg text-xs font-semibold uppercase tracking-wide text-dim">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Company</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Conf.</th>
                    <th className="px-3 py-2">LinkedIn</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-token">
                  {result.rows.map((r, i) => (
                    <tr key={i} className="row-hover">
                      <td className="px-3 py-2 font-medium">{r.Name}</td>
                      <td className="px-3 py-2 text-dim">{r.Company || '—'}</td>
                      <td className="px-3 py-2">
                        <StatusPill status={r.Status} />
                      </td>
                      <td className="px-3 py-2 tabular-nums text-dim">{r.Confidence || '—'}</td>
                      <td className="px-3 py-2">
                        {r['LinkedIn URL'] ? (
                          <a className="link-accent" href={r['LinkedIn URL']} target="_blank" rel="noreferrer">
                            {r['LinkedIn URL'].replace(/^https?:\/\/(www\.)?linkedin\.com/, '')}
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }) {
  const cls =
    status === 'Found' ? 'pill-success' : status === 'Not Found' ? 'pill-muted' : 'pill-warning';
  return <span className={`pill ${cls}`}>{status}</span>;
}
