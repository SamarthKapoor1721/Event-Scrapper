import { useState } from 'react';
import { api } from '../api';
import Picker from './Picker';
import { CITY_PRESETS, ROLE_PRESETS, INDUSTRY_PRESETS, EVENT_KEYWORDS } from '../constants';

/**
 * Lead finder: pick locations + roles and discover matching LinkedIn profiles
 * (name, designation, company, URL) — anyone who fits the criteria.
 */
export default function FindPeoplePanel() {
  const [cities, setCities] = useState(['Gurgaon']);
  const [roles, setRoles] = useState(['CTO', 'CIO']);
  const [inds, setInds] = useState([]);
  const [eventOnly, setEventOnly] = useState(false);
  const [excludeJunk, setExcludeJunk] = useState(true);
  const [deep, setDeep] = useState(false);
  const [strict, setStrict] = useState(true);
  const [pages, setPages] = useState(2);
  const [rawQuery, setRawQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function run() {
    setError('');
    setResult(null);
    const usingRaw = rawQuery.trim().length > 0;
    if (!usingRaw && !cities.length && !roles.length) {
      return setError('Add a city/designation — or paste a custom query below.');
    }
    setBusy(true);
    try {
      // A pasted query (or Google search URL) overrides the filters above.
      const payload = usingRaw
        ? { query: rawQuery, pages: Number(pages) || 2, excludeJunk }
        : { locations: cities, designations: roles, industries: inds, keywords: eventOnly ? EVENT_KEYWORDS : [], pages: Number(pages) || 2, excludeJunk, deep, strict };
      const data = await api.searchProfiles(payload);
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
        <h2 className="card-title text-[15px]">Find People by Role &amp; Location</h2>
        <p className="mt-1 text-sm text-dim">
          Discover LinkedIn profiles that match your criteria — name, designation, company and profile link.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Picker label="Cities (multiple allowed)" options={CITY_PRESETS} values={cities} setValues={setCities} placeholder="Search cities or add your own…" />
          <Picker label="Designations" options={ROLE_PRESETS} values={roles} setValues={setRoles} placeholder="Search roles or add your own…" />
          <Picker label="Industries (optional)" options={INDUSTRY_PRESETS} values={inds} setValues={setInds} placeholder="Search industries or add…" />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-lime" checked={eventOnly} onChange={(e) => setEventOnly(e.target.checked)} />
              Bias toward event speakers/panelists
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-lime" checked={excludeJunk} onChange={(e) => setExcludeJunk(e.target.checked)} />
              Exclude students / interns / job-seekers
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-lime" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
              <span>
                Strict role match — only people who actually hold the role
                <span className="block text-xs text-dim">Drops unrelated profiles the search engine returned. Untick for more (looser) results.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-lime" checked={deep} onChange={(e) => setDeep(e.target.checked)} />
              <span>
                Deep search — many more results
                <span className="block text-xs text-dim">Runs each role phrasing as its own search. Slower &amp; higher CAPTCHA risk.</span>
              </span>
            </label>
          </div>
          <label className="block">
            <span className="field-label">Result pages (1–2 is best — higher risks a CAPTCHA)</span>
            <input type="number" min="1" max="3" className="input" value={pages} onChange={(e) => setPages(e.target.value)} />
          </label>
        </div>

        <label className="mt-4 block">
          <span className="field-label">Or paste your own Google query / URL (overrides the filters above)</span>
          <textarea
            className="input h-24 font-mono text-xs"
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder={'("Head of Talent Acquisition" OR "Talent Acquisition Head") (Gurgaon OR Delhi OR Noida) site:linkedin.com/in (HR summit OR conclave OR speaker)'}
          />
        </label>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button onClick={run} disabled={busy} className="btn-primary">
            {busy ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Finding…
              </>
            ) : (
              'Find People'
            )}
          </button>
          {result?.downloadUrl && <a href={result.downloadUrl} className="btn-secondary">Download Excel</a>}
          {result?.csvUrl && <a href={result.csvUrl} className="btn-secondary">Download CSV</a>}
          {busy && <span className="text-xs text-dim">Searching across result pages — this can take a minute.</span>}
        </div>

        {error && <p className="mt-3 text-sm font-medium text-[var(--danger)]">{error}</p>}
        {result?.note && (
          <p className="mt-3 rounded-lg px-3 py-2 text-sm font-medium text-[var(--warning)] bg-[var(--surface2)]">
            ⚠ {result.note}
          </p>
        )}
        {result && (
          <p className="mt-3 break-all text-xs text-dim">
            Found {result.count} profile(s). Query: <span className="font-mono">{result.query}</span>
          </p>
        )}
      </div>

      {result?.rows?.length > 0 && (
        <div className="card animate-fade-up overflow-hidden">
          <div className="nice-scroll max-h-[32rem] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 thead-bg text-xs font-semibold uppercase tracking-wide text-dim">
                <tr>
                  <th className="px-4 py-2.5">Score</th>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Designation</th>
                  <th className="px-4 py-2.5">Seniority</th>
                  <th className="px-4 py-2.5">Company</th>
                  <th className="px-4 py-2.5">LinkedIn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-token">
                {result.rows.map((r, i) => (
                  <tr key={i} className="transition row-hover">
                    <td className="px-4 py-2.5">
                      <span className="rounded-md badge-accent tabular-nums ">
                        {r['Decision Score']}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-semibold">{r.Name || '—'}</td>
                    <td className="px-4 py-2.5 text-dim">{r.Designation || '—'}</td>
                    <td className="px-4 py-2.5 text-dim">{r.Seniority || '—'}</td>
                    <td className="px-4 py-2.5 text-dim">{r.Company || '—'}</td>
                    <td className="px-4 py-2.5">
                      <a className="link-accent" href={r['LinkedIn URL']} target="_blank" rel="noreferrer">
                        {r['LinkedIn URL'].replace(/^https?:\/\/(www\.)?linkedin\.com/, '')}
                      </a>
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

