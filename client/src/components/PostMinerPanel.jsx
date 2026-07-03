import { useState } from 'react';
import { api } from '../api';

/**
 * Company POC finder: for each company, search LinkedIn for the people who work
 * there (optionally narrowed by role/location) → Name, Company, LinkedIn URL.
 */
export default function PostMinerPanel() {
  const [companies, setCompanies] = useState('');
  const [roles, setRoles] = useState('');
  const [location, setLocation] = useState('');
  const [pages, setPages] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function run() {
    setError('');
    setResult(null);
    const companyList = companies.split(/[\n,]/).map((c) => c.trim()).filter(Boolean);
    if (!companyList.length) return setError('Add at least one company (one per line).');
    setBusy(true);
    try {
      const data = await api.minePosts({
        companies: companyList,
        designations: roles.split(',').map((r) => r.trim()).filter(Boolean),
        location: location.trim(),
        pages: Number(pages) || 2,
      });
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="card animate-fade-up p-5 sm:p-6">
        <h2 className="text-lg font-bold">Find POCs at Companies</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Paste companies and get the people who work there from LinkedIn — Name, Designation, Company, profile link.
          Optionally narrow by role and location.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block sm:row-span-3">
            <span className="field-label">Companies (one per line)</span>
            <textarea
              className="input h-40"
              value={companies}
              onChange={(e) => setCompanies(e.target.value)}
              placeholder={'Deloitte\nInterGlobe Aviation\nPolicybazaar\nGenpact'}
            />
          </label>
          <label className="block">
            <span className="field-label">Roles (optional, comma-separated)</span>
            <input className="input" value={roles} onChange={(e) => setRoles(e.target.value)} placeholder="CTO, CIO, Head of HR, VP Marketing" />
          </label>
          <label className="block">
            <span className="field-label">Location (optional)</span>
            <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Gurugram" />
          </label>
          <label className="block">
            <span className="field-label">Result pages (1–2 best)</span>
            <input type="number" min="1" max="3" className="input" value={pages} onChange={(e) => setPages(e.target.value)} />
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button onClick={run} disabled={busy} className="btn-primary">
            {busy ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Finding…
              </>
            ) : (
              'Find POCs'
            )}
          </button>
          {result?.downloadUrl && <a href={result.downloadUrl} className="btn-secondary">Download Excel</a>}
          {result?.csvUrl && <a href={result.csvUrl} className="btn-secondary">Download CSV</a>}
        </div>

        {error && <p className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>}
        {result?.note && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">⚠ {result.note}</p>
        )}
        {result && <p className="mt-3 text-xs text-slate-400">Found {result.count} POC(s).</p>}
      </div>

      {result?.rows?.length > 0 && (
        <div className="card animate-fade-up overflow-hidden">
          <div className="nice-scroll max-h-[32rem] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50/95 text-xs font-semibold uppercase tracking-wide text-slate-500 backdrop-blur dark:bg-slate-800/95">
                <tr>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Designation</th>
                  <th className="px-4 py-2.5">Company</th>
                  <th className="px-4 py-2.5">LinkedIn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {result.rows.map((r, i) => (
                  <tr key={i} className="transition hover:bg-indigo-50/40 dark:hover:bg-white/[0.04]">
                    <td className="px-4 py-2.5 font-semibold">{r.Name || '—'}</td>
                    <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{r.Designation || '—'}</td>
                    <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{r.Company || '—'}</td>
                    <td className="px-4 py-2.5">
                      {r['LinkedIn URL'] ? (
                        <a className="text-indigo-600 hover:underline dark:text-indigo-400" href={r['LinkedIn URL']} target="_blank" rel="noreferrer">
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
        </div>
      )}
    </div>
  );
}
