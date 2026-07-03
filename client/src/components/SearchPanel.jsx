import { useState } from 'react';
import { api } from '../api';

/**
 * LinkedIn X-ray search → Excel. Paste a search query (or a Google search URL)
 * and collect the matching LinkedIn profiles with name, designation and link.
 */
export default function SearchPanel() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pages, setPages] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function run() {
    setError('');
    setResult(null);
    if (!query.trim()) return setError('Paste a search query or a Google search URL.');
    setBusy(true);
    try {
      const data = await api.searchProfiles({ query, pages: Number(pages) || 3 });
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card animate-fade-up p-5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <span>
          <span className="text-sm font-bold">Find Profiles by Search</span>
          <span className="ml-2 text-xs text-slate-400">LinkedIn X-ray query → Name, Designation, Link → Excel</span>
        </span>
        <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">{open ? 'Hide' : 'Open'}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          <textarea
            className="input h-24 font-mono text-xs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={'site:linkedin.com/in ("CIO" OR "CTO") Gurgaon ("summit" OR "speaker")\n\n…or paste a full Google search URL — the query is extracted automatically.'}
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-500">
              Result pages
              <input
                type="number"
                min="1"
                max="10"
                className="input w-20"
                value={pages}
                onChange={(e) => setPages(e.target.value)}
              />
            </label>
            <button onClick={run} disabled={busy} className="btn-primary">
              {busy ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Searching…
                </>
              ) : (
                'Search Profiles'
              )}
            </button>
            {result?.downloadUrl && <a href={result.downloadUrl} className="btn-secondary">Download Excel</a>}
            {result?.csvUrl && <a href={result.csvUrl} className="btn-secondary">Download CSV</a>}
          </div>

          {error && <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>}
          {result && <p className="text-xs text-slate-400">Found {result.count} profile(s).</p>}

          {result?.rows?.length > 0 && (
            <div className="nice-scroll max-h-80 overflow-auto rounded-xl border border-slate-200/70 dark:border-white/10">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50/95 text-xs font-semibold uppercase tracking-wide text-slate-500 backdrop-blur dark:bg-slate-800/95">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Designation</th>
                    <th className="px-3 py-2">Company</th>
                    <th className="px-3 py-2">LinkedIn</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {result.rows.map((r, i) => (
                    <tr key={i} className="hover:bg-indigo-50/40 dark:hover:bg-white/[0.04]">
                      <td className="px-3 py-2 font-medium">{r.Name || '—'}</td>
                      <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{r.Designation || '—'}</td>
                      <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{r.Company || '—'}</td>
                      <td className="px-3 py-2">
                        <a className="text-indigo-600 hover:underline dark:text-indigo-400" href={r['LinkedIn URL']} target="_blank" rel="noreferrer">
                          {r['LinkedIn URL'].replace(/^https?:\/\/(www\.)?linkedin\.com/, '')}
                        </a>
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
