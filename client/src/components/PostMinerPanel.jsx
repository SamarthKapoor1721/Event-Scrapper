import { useState } from 'react';
import { api } from '../api';
import Picker from './Picker';
import { ROLE_PRESETS, CITY_PRESETS } from '../constants';

/**
 * Company POC finder: for each company, search LinkedIn for the people who work
 * there (optionally narrowed by role/location) → Name, Company, LinkedIn URL.
 */
export default function PostMinerPanel() {
  const [companies, setCompanies] = useState('');
  const [roles, setRoles] = useState([]);
  const [cities, setCities] = useState([]);
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
        designations: roles,
        locations: cities,
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
        <h2 className="card-title text-[15px]">Find POCs at Companies</h2>
        <p className="mt-1 text-sm text-dim">
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
          <Picker label="Posts / designations (optional)" options={ROLE_PRESETS} values={roles} setValues={setRoles} placeholder="Search a post e.g. CTO, HR Head…" />
          <Picker label="Location (optional)" options={CITY_PRESETS} values={cities} setValues={setCities} placeholder="Search a city…" />
          <label className="block">
            <span className="field-label">Result pages</span>
            <input type="number" min="1" max="20" className="input" value={pages} onChange={(e) => setPages(e.target.value)} />
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
          {result?.downloadUrl && <a href={result.downloadUrl} download target="_blank" rel="noreferrer" className="btn-secondary">Download Excel</a>}
          {result?.csvUrl && <a href={result.csvUrl} download target="_blank" rel="noreferrer" className="btn-secondary">Download CSV</a>}
        </div>

        {error && <p className="mt-3 text-sm font-medium text-[var(--danger)]">{error}</p>}
        {result?.note && (
          <p className="mt-3 rounded-lg px-3 py-2 text-sm font-medium text-[var(--warning)] bg-[var(--surface2)]">⚠ {result.note}</p>
        )}
        {result && <p className="mt-3 text-xs text-dim">Found {result.count} POC(s).</p>}
      </div>

      {result?.rows?.length > 0 && (
        <div className="card animate-fade-up overflow-hidden">
          <div className="nice-scroll max-h-[32rem] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 thead-bg text-xs font-semibold uppercase tracking-wide text-dim">
                <tr>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Designation</th>
                  <th className="px-4 py-2.5">Company</th>
                  <th className="px-4 py-2.5">LinkedIn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-token">
                {result.rows.map((r, i) => (
                  <tr key={i} className="transition row-hover">
                    <td className="px-4 py-2.5 font-semibold">{r.Name || '—'}</td>
                    <td className="px-4 py-2.5 text-dim">{r.Designation || '—'}</td>
                    <td className="px-4 py-2.5 text-dim">{r.Company || '—'}</td>
                    <td className="px-4 py-2.5">
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
        </div>
      )}
    </div>
  );
}
