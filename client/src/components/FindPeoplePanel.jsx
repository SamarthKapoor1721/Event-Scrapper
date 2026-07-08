import { useState } from 'react';
import { api } from '../api';

const CITY_PRESETS = [
  'Gurgaon', 'Gurugram', 'Delhi', 'New Delhi', 'Noida', 'Greater Noida',
  'Ghaziabad', 'Faridabad', 'NCR', 'Mumbai', 'Navi Mumbai', 'Thane', 'Pune',
  'Bengaluru', 'Bangalore', 'Hyderabad', 'Chennai', 'Kolkata', 'Ahmedabad',
  'Jaipur', 'Chandigarh', 'Indore', 'Lucknow', 'Kochi', 'India',
  'Dubai', 'Singapore', 'London', 'New York',
];

const ROLE_PRESETS = [
  'HR Head', 'CHRO', 'Head of HR', 'HR Director', 'VP HR', 'People Head',
  'Talent Acquisition Head', 'Head of Talent Acquisition', 'VP Talent Acquisition',
  'Director Talent Acquisition', 'Senior Director Talent Acquisition',
  'AVP Talent Acquisition', 'Talent Acquisition Lead', 'Talent Acquisition Manager',
  'Global TA Head', 'TA Head', 'Recruitment Head', 'Head of Recruitment',
  'Recruitment Director', 'Head of Hiring', 'Talent Acquisition Partner',
  'Campus Recruitment Head', 'Chief People Officer',
  'L&D Head', 'Head of L&D', 'VP L&D', 'L&D Director', 'Chief Learning Officer',
  'Head of Learning', 'Training Head', 'Capability Development Head', 'Head of OD',
  'CMO', 'Chief Growth Officer', 'Head of Marketing', 'VP Marketing', 'Marketing Director',
  'Head of Digital Marketing', 'Head of Growth', 'Head of Brand', 'Brand Director',
  'Head of Product Marketing', 'Head of Demand Generation', 'Head of Performance Marketing',
  'Head of Content', 'Head of Communications', 'Head of Social Media', 'Marketing Manager',
  'CTO', 'CIO', 'VP Engineering', 'Head of Product',
  'CEO', 'CFO', 'COO', 'VP Sales', 'Head of Procurement',
];

const INDUSTRY_PRESETS = [
  'Healthcare', 'Real Estate', 'Fintech', 'Insurance', 'IT Services', 'SaaS',
  'Manufacturing', 'Ecommerce', 'EdTech', 'Logistics', 'Automotive', 'Telecom',
  'Energy', 'Hospitality', 'Media', 'Consulting', 'Cybersecurity', 'AI', 'FMCG',
];

const EVENT_KEYWORDS = ['summit', 'speaker', 'panel', 'conference', 'roundtable'];

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
        : { locations: cities, designations: roles, industries: inds, keywords: eventOnly ? EVENT_KEYWORDS : [], pages: Number(pages) || 2, excludeJunk };
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
        <h2 className="text-lg font-bold">Find People by Role &amp; Location</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Discover LinkedIn profiles that match your criteria — name, designation, company and profile link.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Picker label="Cities (multiple allowed)" options={CITY_PRESETS} values={cities} setValues={setCities} placeholder="Add a city…" addPlaceholder="Other city" />
          <Picker label="Designations" options={ROLE_PRESETS} values={roles} setValues={setRoles} placeholder="Add a designation…" addPlaceholder="Custom role" />
          <Picker label="Industries (optional)" options={INDUSTRY_PRESETS} values={inds} setValues={setInds} placeholder="Add an industry…" addPlaceholder="Custom industry" />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={eventOnly} onChange={(e) => setEventOnly(e.target.checked)} />
              Bias toward event speakers/panelists
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={excludeJunk} onChange={(e) => setExcludeJunk(e.target.checked)} />
              Exclude students / interns / job-seekers
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
          {busy && <span className="text-xs text-slate-400">Searching across result pages — this can take a minute.</span>}
        </div>

        {error && <p className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>}
        {result?.note && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            ⚠ {result.note}
          </p>
        )}
        {result && (
          <p className="mt-3 break-all text-xs text-slate-400">
            Found {result.count} profile(s). Query: <span className="font-mono">{result.query}</span>
          </p>
        )}
      </div>

      {result?.rows?.length > 0 && (
        <div className="card animate-fade-up overflow-hidden">
          <div className="nice-scroll max-h-[32rem] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50/95 text-xs font-semibold uppercase tracking-wide text-slate-500 backdrop-blur dark:bg-slate-800/95">
                <tr>
                  <th className="px-4 py-2.5">Score</th>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Designation</th>
                  <th className="px-4 py-2.5">Seniority</th>
                  <th className="px-4 py-2.5">Company</th>
                  <th className="px-4 py-2.5">LinkedIn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {result.rows.map((r, i) => (
                  <tr key={i} className="transition hover:bg-indigo-50/40 dark:hover:bg-white/[0.04]">
                    <td className="px-4 py-2.5">
                      <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-bold tabular-nums text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
                        {r['Decision Score']}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-semibold">{r.Name || '—'}</td>
                    <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{r.Designation || '—'}</td>
                    <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{r.Seniority || '—'}</td>
                    <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{r.Company || '—'}</td>
                    <td className="px-4 py-2.5">
                      <a className="text-indigo-600 hover:underline dark:text-indigo-400" href={r['LinkedIn URL']} target="_blank" rel="noreferrer">
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

/** Dropdown + free-text add, with the chosen values shown as removable chips. */
function Picker({ label, options, values, setValues, placeholder, addPlaceholder }) {
  const [custom, setCustom] = useState('');
  const add = (v) => {
    const t = (v || '').trim();
    if (t && !values.some((x) => x.toLowerCase() === t.toLowerCase())) setValues([...values, t]);
  };
  const remove = (v) => setValues(values.filter((x) => x !== v));
  const available = options.filter((o) => !values.some((x) => x.toLowerCase() === o.toLowerCase()));

  return (
    <div>
      <span className="field-label">{label}</span>
      <div className="flex gap-2">
        <select
          className="input"
          value=""
          onChange={(e) => {
            add(e.target.value);
            e.target.value = '';
          }}
        >
          <option value="">{placeholder}</option>
          {available.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex gap-2">
        <input
          className="input text-sm"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(custom);
              setCustom('');
            }
          }}
          placeholder={addPlaceholder}
        />
        <button
          type="button"
          onClick={() => {
            add(custom);
            setCustom('');
          }}
          className="btn-secondary shrink-0 px-3 py-2"
        >
          Add
        </button>
      </div>
      {values.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white dark:bg-indigo-500"
            >
              {v}
              <button type="button" onClick={() => remove(v)} className="text-white/80 hover:text-white" title={`Remove ${v}`}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
