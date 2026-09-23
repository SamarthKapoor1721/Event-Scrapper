import { useRef, useState } from 'react';
import { api, newJobId } from '../api';
import Picker from './Picker';
import LogPanel from './LogPanel';
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
  const [showRaw, setShowRaw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [logs, setLogs] = useState([]);
  const [captchaActive, setCaptchaActive] = useState(false);
  const esRef = useRef(null);

  function openLogStream(jobId) {
    esRef.current?.close();
    const es = new EventSource(api.logStreamUrl(jobId));
    esRef.current = es;
    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'log') {
        setLogs((prev) => [...prev, data]);
        if (data.level === 'captcha') setCaptchaActive(true);
        else if (data.level === 'success' && /captcha/i.test(data.message)) setCaptchaActive(false);
      } else if (data.type === 'error') {
        setLogs((prev) => [...prev, { ...data, level: 'error', message: data.message }]);
      } else if (data.type === 'done') {
        setCaptchaActive(false);
        es.close();
      }
    };
    es.onerror = () => es.close();
  }

  async function run() {
    setError('');
    setResult(null);
    const usingRaw = rawQuery.trim().length > 0;
    if (!usingRaw && !cities.length && !roles.length) {
      return setError('Add a city/designation — or paste a custom query below.');
    }
    const jobId = newJobId();
    setBusy(true);
    setLogs([]);
    setCaptchaActive(false);
    openLogStream(jobId);
    try {
      // A pasted query (or Google search URL) overrides the filters above.
      const payload = usingRaw
        ? { query: rawQuery, pages: Number(pages) || 2, excludeJunk, jobId }
        : { locations: cities, designations: roles, industries: inds, keywords: eventOnly ? EVENT_KEYWORDS : [], pages: Number(pages) || 2, excludeJunk, deep, strict, jobId };
      const data = await api.searchProfiles(payload);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      setCaptchaActive(false);
    }
  }

  const rows = result?.rows || [];
  const highConfidence = rows.filter((r) => (r['Decision Score'] || 0) >= 85).length;
  const avgScore = rows.length ? Math.round(rows.reduce((s, r) => s + (r['Decision Score'] || 0), 0) / rows.length) : 0;
  const companyCount = new Set(rows.map((r) => r.Company).filter(Boolean)).size;

  return (
    <div className="space-y-5">
      <div className="card animate-fade-up p-5 sm:p-6">
        <div className="flex items-start gap-3.5">
          <span className="icon-badge">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
          </span>
          <div>
            <h2 className="card-title heading-gradient text-[17px]">Find People by Role &amp; Location</h2>
            <p className="mt-1 text-sm text-dim">
              Discover LinkedIn profiles that match your criteria — name, designation, company and profile link.
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Picker label="Cities (multiple allowed)" options={CITY_PRESETS} values={cities} setValues={setCities} placeholder="Search cities or add your own…" />
          <Picker label="Designations" options={ROLE_PRESETS} values={roles} setValues={setRoles} placeholder="Search roles or add your own…" />
          <Picker label="Industries (optional)" options={INDUSTRY_PRESETS} values={inds} setValues={setInds} placeholder="Search industries or add…" />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            <OptionRow
              on={eventOnly}
              onToggle={() => setEventOnly((v) => !v)}
              icon={
                <path d="M8 2v4M16 2v4M3.5 9h17M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z" />
              }
              label="Bias toward event speakers/panelists"
            />
            <OptionRow
              on={excludeJunk}
              onToggle={() => setExcludeJunk((v) => !v)}
              icon={<path d="M6 6l12 12M6 18L18 6" />}
              label="Exclude students / interns / job-seekers"
            />
            <OptionRow
              on={strict}
              onToggle={() => setStrict((v) => !v)}
              icon={<path d="M9 12l2 2 4-4M20.5 12c0 4.7-3.8 8.5-8.5 8.5S3.5 16.7 3.5 12 7.3 3.5 12 3.5s8.5 3.8 8.5 8.5z" />}
              label="Strict role match"
              hint="Only people who actually hold the role. Untick for looser results."
            />
            <OptionRow
              on={deep}
              onToggle={() => setDeep((v) => !v)}
              icon={<path d="M12 2v20M2 12h20" />}
              label="Deep search"
              hint="Runs each role phrasing as its own search. Slower & higher CAPTCHA risk."
            />
          </div>

          <label className="block">
            <span className="field-label">Result pages</span>
            <input type="number" min="1" max="20" className="input" value={pages} onChange={(e) => setPages(e.target.value)} />
            <span className="mt-1.5 block text-[11px] text-dim">More pages = more CAPTCHAs to solve, but far more results</span>
          </label>
        </div>

        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold link-accent"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`transition-transform ${showRaw ? 'rotate-90' : ''}`}>
            <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Paste your own Google query / URL instead
        </button>
        {showRaw && (
          <label className="mt-3 block">
            <span className="field-label">Overrides the filters above</span>
            <textarea
              className="input h-24 font-mono text-xs"
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              placeholder={'("Head of Talent Acquisition" OR "Talent Acquisition Head") (Gurgaon OR Delhi OR Noida) site:linkedin.com/in (HR summit OR conclave OR speaker)'}
            />
          </label>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button onClick={run} disabled={busy} className="btn-primary">
            {busy ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Finding…
              </>
            ) : (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4.3-4.3" />
                </svg>
                Find People
              </>
            )}
          </button>
          {result?.downloadUrl && <a href={result.downloadUrl} download target="_blank" rel="noreferrer" className="btn-secondary">Download Excel</a>}
          {result?.csvUrl && <a href={result.csvUrl} download target="_blank" rel="noreferrer" className="btn-secondary">Download CSV</a>}
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

      {captchaActive && (
        <div className="card animate-fade-up flex items-center gap-3 border-l-4 p-4" style={{ borderLeftColor: 'var(--warning)', background: 'color-mix(in srgb, var(--warning) 10%, var(--surface))' }}>
          <span className="live-dot h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: 'var(--warning)' }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--warning)' }}>CAPTCHA needs solving</p>
            <p className="text-xs text-dim">Switch to the browser window that opened and solve it — the search will continue automatically once cleared.</p>
          </div>
        </div>
      )}

      {(busy || logs.length > 0) && <LogPanel logs={logs} live={busy} />}

      {rows.length > 0 && (
        <div className="card animate-fade-up overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-token p-4">
            <div className="stat-chip">
              <span className="stat-chip-value">{rows.length}</span>
              <span className="stat-chip-label">Profiles</span>
            </div>
            <div className="stat-chip">
              <span className="stat-chip-value" style={{ color: 'var(--success)' }}>{highConfidence}</span>
              <span className="stat-chip-label">High confidence</span>
            </div>
            <div className="stat-chip">
              <span className="stat-chip-value">{avgScore}</span>
              <span className="stat-chip-label">Avg score</span>
            </div>
            <div className="stat-chip">
              <span className="stat-chip-value">{companyCount}</span>
              <span className="stat-chip-label">Companies</span>
            </div>
          </div>
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
                {rows.map((r, i) => (
                  <tr key={i} className="transition row-hover">
                    <td className="px-4 py-2.5">
                      <ScoreBadge score={r['Decision Score']} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="avatar-ring">{initials(r.Name)}</span>
                        <span className="font-semibold">{r.Name || '—'}</span>
                      </div>
                    </td>
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

/** Toggle-switch option row (replaces a bare checkbox + label). */
function OptionRow({ on, onToggle, icon, label, hint }) {
  return (
    <div
      className="option-row"
      data-on={on}
      role="switch"
      aria-checked={on}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle())}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-dim">
        {icon}
      </svg>
      <span className="min-w-0 flex-1 text-sm">
        {label}
        {hint && <span className="mt-0.5 block text-[11px] text-dim">{hint}</span>}
      </span>
      <span className="toggle-track shrink-0" data-on={on}>
        <span className="toggle-thumb" />
      </span>
    </div>
  );
}

/** Color-coded decision-score badge (mirrors the LinkedIn confidence pill styling). */
function ScoreBadge({ score }) {
  const s = score || 0;
  const cls = s >= 85 ? 'pill-success' : s >= 65 ? 'pill-warning' : 'pill-muted';
  return <span className={`pill tabular-nums ${cls}`}>{s}</span>;
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}
