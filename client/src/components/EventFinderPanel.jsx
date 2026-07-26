import { useState } from 'react';
import { api } from '../api';
import Picker from './Picker';

const ROLE_PRESETS = ['CIO', 'CTO', 'CISO', 'CHRO', 'HR Head', 'CMO', 'CFO', 'CEO', 'Marketing', 'Digital', 'Data & AI', 'Cybersecurity', 'Supply Chain'];
const INDUSTRY_PRESETS = ['Healthcare', 'Real Estate', 'Fintech', 'IT', 'SaaS', 'Manufacturing', 'Retail', 'BFSI', 'EdTech'];

/**
 * Event finder: search for summits / roundtables / conferences by role/topic +
 * location, and surface the event pages (to scrape) plus any LinkedIn leads.
 */
export default function EventFinderPanel({ onScrapeEvent }) {
  const [topics, setTopics] = useState(['CIO']);
  const [inds, setInds] = useState([]);
  const [location, setLocation] = useState('India');
  const [year, setYear] = useState('');
  const [pages, setPages] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [tab, setTab] = useState('events');

  async function run() {
    setError('');
    setResult(null);
    if (!topics.length && !inds.length) return setError('Add at least one role/topic or industry.');
    setBusy(true);
    try {
      const data = await api.findEvents({ designations: topics, industries: inds, location: location.trim(), year: year.trim(), pages: Number(pages) || 2 });
      setResult(data);
      setTab((data.events?.length ? 'events' : 'profiles'));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="card animate-fade-up p-5 sm:p-6">
        <h2 className="card-title text-[15px]">Find Events, Summits &amp; Roundtables</h2>
        <p className="mt-1 text-sm text-dim">
          Discover summits / conferences / roundtables for specific roles or industries in a location — then scrape
          their speaker pages (via the Scraper tab) or use the LinkedIn leads found directly.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Picker label="Roles / topics" options={ROLE_PRESETS} values={topics} setValues={setTopics} placeholder="Search roles or add…" />
          <Picker label="Industries (optional)" options={INDUSTRY_PRESETS} values={inds} setValues={setInds} placeholder="Search industries or add…" />
          <div className="space-y-4">
            <label className="block">
              <span className="field-label">Location</span>
              <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="India, Gurugram, Mumbai…" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="field-label">Year (optional)</span>
                <input className="input" value={year} onChange={(e) => setYear(e.target.value)} placeholder="2024" />
              </label>
              <label className="block">
                <span className="field-label">Pages (1–2)</span>
                <input type="number" min="1" max="3" className="input" value={pages} onChange={(e) => setPages(e.target.value)} />
              </label>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button onClick={run} disabled={busy} className="btn-primary">
            {busy ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Searching…
              </>
            ) : (
              'Find Events'
            )}
          </button>
          {result?.eventsUrl && <a href={result.eventsUrl} className="btn-secondary">Download events</a>}
          {result?.leadsUrl && <a href={result.leadsUrl} className="btn-secondary">Download leads</a>}
        </div>

        {error && <p className="mt-3 text-sm font-medium text-[var(--danger)]">{error}</p>}
        {result?.note && (
          <p className="mt-3 rounded-lg px-3 py-2 text-sm font-medium text-[var(--warning)] bg-[var(--surface2)]">⚠ {result.note}</p>
        )}
        {result && <p className="mt-3 text-xs text-dim">{result.events?.length || 0} events · {result.profiles?.length || 0} LinkedIn leads.</p>}
      </div>

      {result && (result.events?.length > 0 || result.profiles?.length > 0) && (
        <div className="card animate-fade-up overflow-hidden">
          <div className="flex gap-1 border-b border-token p-2">
            {[['events', `Events (${result.events?.length || 0})`], ['profiles', `LinkedIn leads (${result.profiles?.length || 0})`]].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition ${tab === key ? 'tab-active' : 'text-dim hover:bg-[var(--surface2)]'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="nice-scroll max-h-[30rem] overflow-auto">
            {tab === 'events' ? (
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 thead-bg text-xs font-semibold uppercase tracking-wide text-dim">
                  <tr><th className="px-4 py-2.5">Event</th><th className="px-4 py-2.5">Link</th><th className="px-4 py-2.5"></th></tr>
                </thead>
                <tbody className="divide-y divide-token">
                  {result.events.map((e, i) => (
                    <tr key={i} className="transition row-hover">
                      <td className="px-4 py-2.5">
                        <div className="font-semibold">{e.Event || '—'}</div>
                        {e.About && <div className="text-xs text-dim line-clamp-2">{e.About}</div>}
                      </td>
                      <td className="px-4 py-2.5">
                        <a className="link-accent" href={e.URL} target="_blank" rel="noreferrer">{hostOf(e.URL)}</a>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => onScrapeEvent?.(e.URL)}
                          className="btn-primary !px-3 !py-1.5 !text-xs"
                          title="Scrape this event's speakers"
                        >
                          Scrape speakers
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 thead-bg text-xs font-semibold uppercase tracking-wide text-dim">
                  <tr><th className="px-4 py-2.5">Name</th><th className="px-4 py-2.5">Designation</th><th className="px-4 py-2.5">Company</th><th className="px-4 py-2.5">LinkedIn</th></tr>
                </thead>
                <tbody className="divide-y divide-token">
                  {result.profiles.map((r, i) => (
                    <tr key={i} className="transition row-hover">
                      <td className="px-4 py-2.5 font-semibold">{r.Name}</td>
                      <td className="px-4 py-2.5 text-dim">{r.Designation || '—'}</td>
                      <td className="px-4 py-2.5 text-dim">{r.Company || '—'}</td>
                      <td className="px-4 py-2.5">
                        <a className="link-accent" href={r['LinkedIn URL']} target="_blank" rel="noreferrer">{r['LinkedIn URL'].replace(/^https?:\/\/(www\.)?linkedin\.com/, '')}</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

