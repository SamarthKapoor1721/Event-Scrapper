import { useEffect, useRef, useState } from 'react';
import { api, newJobId } from './api';
import ScrapeForm from './components/ScrapeForm';
import StatsPanel from './components/StatsPanel';
import ProgressBar from './components/ProgressBar';
import LogPanel from './components/LogPanel';
import ResultsTable from './components/ResultsTable';
import ComparePanel from './components/ComparePanel';
import BatchPanel from './components/BatchPanel';
import SearchPanel from './components/SearchPanel';
import FindPeoplePanel from './components/FindPeoplePanel';
import DedupePanel from './components/DedupePanel';
import PostMinerPanel from './components/PostMinerPanel';
import EventFinderPanel from './components/EventFinderPanel';
import CleanListPanel from './components/CleanListPanel';

const DEFAULT_FORM = {
  event: 'Global Fintech Fest',
  year: '2025',
  url: '',
  speakersUrl: '',
  companiesUrl: '',
  extraUrls: '',
  selectors: '',
  scope: '',
  findLinkedIn: false,
  useAI: false,
  retries: 1,
  crawl: false,
  maxPages: 25,
  maxDepth: 2,
  fuzzy: true,
  threshold: 0.82,
  baseYear: '2025',
  targetYear: '2026',
};

export default function App() {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [view, setView] = useState('scraper'); // 'scraper' | 'people'
  const [dark, setDark] = useState(true);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState({ percent: 0, label: 'Idle' });
  const [result, setResult] = useState(null);
  const [compare, setCompare] = useState(null);
  const [toast, setToast] = useState(null);
  const [years, setYears] = useState([]);
  const esRef = useRef(null);

  useEffect(() => {
    // Dark is the design's default; `light` flips the CSS custom properties.
    document.documentElement.classList.toggle('light', !dark);
  }, [dark]);

  useEffect(() => {
    refreshYears();
    return () => esRef.current?.close();
  }, []);

  function flash(message, type = 'info') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  async function refreshYears() {
    try {
      const { years } = await api.years();
      setYears(years);
    } catch {
      /* ignore */
    }
  }

  function buildPayload() {
    const extra = form.extraUrls.split('\n').map((s) => s.trim()).filter(Boolean);
    const urls = [
      form.url.trim(),
      form.speakersUrl.trim(),
      form.companiesUrl.trim(),
      ...extra,
    ].filter(Boolean);
    let selectors;
    if (form.selectors.trim()) {
      try {
        selectors = JSON.parse(form.selectors);
      } catch {
        throw new Error('Custom selectors are not valid JSON.');
      }
    }
    return {
      event: form.event,
      year: form.year,
      urls,
      selectors,
      scope: form.scope.trim() || undefined,
      findLinkedIn: form.findLinkedIn,
      useAI: form.useAI,
      retries: Number(form.retries) || 0,
      crawl: form.crawl,
      maxPages: Number(form.maxPages) || 25,
      maxDepth: Number(form.maxDepth) || 2,
    };
  }

  function openLogStream(jobId) {
    esRef.current?.close();
    const es = new EventSource(api.logStreamUrl(jobId));
    esRef.current = es;
    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'log') setLogs((prev) => [...prev, data]);
      else if (data.type === 'progress') setProgress({ percent: data.percent, label: data.label });
      else if (data.type === 'error') setLogs((prev) => [...prev, { ...data, level: 'error', message: data.message }]);
      else if (data.type === 'done') es.close();
    };
    es.onerror = () => es.close();
  }

  async function handleScrape(urlOverride) {
    let payload;
    try {
      payload = buildPayload();
    } catch (err) {
      return flash(err.message, 'error');
    }
    // When launched from the Event Finder, scrape just that one event URL.
    if (typeof urlOverride === 'string' && urlOverride) {
      payload = { ...payload, urls: [urlOverride], crawl: true, maxPages: 40 };
    }
    if (!payload.urls.length) return flash('Enter a website URL first.', 'error');
    if (!payload.year) return flash('Enter a year.', 'error');

    const jobId = newJobId();
    setBusy(true);
    setLogs([]);
    setProgress({ percent: 2, label: 'Starting' });
    openLogStream(jobId);

    try {
      const data = await api.scrape({ ...payload, jobId });
      setResult(data);
      flash(`Found ${data.count.speakers} speakers & ${data.count.companies} companies.`, 'success');
      refreshYears();
    } catch (err) {
      flash(err.message, 'error');
      setProgress({ percent: 0, label: 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  // Launched from the Event Finder: show the URL in the Scraper form, switch to
  // that tab, and immediately scrape (whole-site crawl) that event page.
  function handleScrapeEvent(url) {
    setForm((f) => ({ ...f, url, speakersUrl: '', companiesUrl: '', extraUrls: '', crawl: true }));
    setView('scraper');
    handleScrape(url);
  }

  // Manual edit/replace of a speaker's LinkedIn URL before export. A user-set
  // URL is treated as confirmed (Matched / 100%); clearing it reverts to Not Found.
  function handleEditLinkedIn(index, url) {
    setResult((prev) => {
      if (!prev) return prev;
      const speakers = prev.speakers.map((s, i) => {
        if (i !== index) return s;
        const trimmed = (url || '').trim();
        if (!trimmed) {
          return { ...s, linkedinUrl: '', linkedinConfidence: 0, linkedinLevel: '', linkedinStatus: 'Not Found' };
        }
        // A human-supplied URL is treated as confirmed.
        return { ...s, linkedinUrl: trimmed, linkedinConfidence: 1, linkedinLevel: 'High', linkedinStatus: 'Found' };
      });
      return { ...prev, speakers };
    });
  }

  async function handleGenerateExcel(download = false) {
    try {
      // Send the (possibly edited) enriched speakers so manual LinkedIn changes
      // are persisted and reflected in the workbook.
      const enriched = result?.speakers?.some((s) => 'linkedinStatus' in s) ? result.speakers : undefined;
      const data = await api.generateExcel({ year: form.year, event: form.event, speakers: enriched });
      flash(`Generated ${data.filename}.`, 'success');
      if (download) window.location.href = api.downloadUrl(data.filename);
      else triggerDownload(data.downloadUrl);
    } catch (err) {
      flash(err.message, 'error');
    }
  }

  async function handleCompare() {
    try {
      const data = await api.compare({
        baseYear: form.baseYear,
        targetYear: form.targetYear,
        fuzzy: form.fuzzy,
        threshold: Number(form.threshold),
        event: form.event,
      });
      setCompare(data);
      flash('Comparison generated.', 'success');
    } catch (err) {
      flash(err.message, 'error');
    }
  }

  async function handleExport(format, kind) {
    try {
      const data = await api.exportData({ year: form.year, event: form.event, format, kind });
      flash(`Exported ${data.files.length} ${format.toUpperCase()} file(s).`, 'success');
      data.files.forEach((f) => triggerDownload(f.downloadUrl));
    } catch (err) {
      flash(err.message, 'error');
    }
  }

  async function handleDeleteYear(year) {
    if (!window.confirm(`Delete all stored data for ${year}? This cannot be undone.`)) return;
    try {
      await api.deleteYear(year);
      flash(`Deleted data for ${year}.`, 'success');
      if (result?.meta?.year === String(year)) setResult(null);
      refreshYears();
    } catch (err) {
      flash(err.message, 'error');
    }
  }

  function triggerDownload(url) {
    const a = document.createElement('a');
    a.href = url;
    a.click();
  }

  const NAV = [
    ['scraper', 'Conference Scraper', 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 5a4 4 0 100 8 4 4 0 000-8z'],
    ['people', 'Find People', 'M9 11a3 3 0 100-6 3 3 0 000 6zm-5.5 9c0-3.6 2.8-6 5.5-6s5.5 2.4 5.5 6M18 11.4a2.4 2.4 0 100-4.8 2.4 2.4 0 000 4.8zM15.5 20c.2-2.6 1.7-4.4 3.7-4.7'],
    ['posts', 'Company POC Miner', 'M4 9h7v11H4zM13 4h7v16h-7zM6.5 12h2M15.5 7h2M15.5 11h2'],
    ['events', 'Event Finder', 'M12 3a9 9 0 100 18 9 9 0 000-18zm3 6l-2 4-4 2 2-4z'],
    ['clean', 'Dedupe & Clean', 'M7 7h12v12H7zM5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1'],
  ];
  const TITLES = {
    scraper: ['Conference Scraper', 'Extract speakers & companies from an event site'],
    people: ['Find People & LinkedIn Enrichment', 'Match extracted speakers to verified LinkedIn profiles'],
    posts: ['Company POC Miner', 'Mine company posts to surface points of contact'],
    events: ['Event Finder', 'Discover related events to source new leads'],
    clean: ['Dedupe & Clean List', 'Subtract and clean contact lists'],
  };
  const [screenTitle, screenSubtitle] = TITLES[view] || TITLES.scraper;

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside
        className="flex w-[250px] flex-shrink-0 flex-col px-3.5 pb-4 pt-[22px]"
        style={{ background: 'var(--surface)', borderRight: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2.5 px-2 pb-[22px]">
          <div
            className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-[7px]"
            style={{ background: 'var(--accent)' }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--accent-ink)" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.2" y2="16.2" />
            </svg>
          </div>
          <div>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--text)', letterSpacing: '-.01em' }}>
              EventScout
            </div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '.04em' }}>
              scraper ops
            </div>
          </div>
        </div>

        <div className="eyebrow px-2.5 pb-2">WORKFLOWS</div>

        {NAV.map(([key, label, d]) => {
          const active = view === key;
          return (
            <button
              key={key}
              onClick={() => setView(key)}
              aria-current={active ? 'page' : undefined}
              className="nav-btn mb-0.5 flex w-full items-center gap-[11px] rounded-lg px-3 py-2.5 text-left text-[13px]"
              style={{
                background: active ? 'var(--surface2)' : 'transparent',
                color: active ? 'var(--text)' : 'var(--text-dim)',
                fontWeight: active ? 600 : 500,
                borderLeft: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
              }}
            >
              <svg
                className="nav-icon"
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
              >
                <path d={d} />
              </svg>
              <span>{label}</span>
            </button>
          );
        })}

        <div className="flex-1" />

        <div
          className="flex items-center justify-between px-2.5 py-2.5"
          style={{ borderTop: '1px solid var(--border)', marginTop: 10 }}
        >
          <span className="text-xs" style={{ color: 'var(--text-dim)' }}>Theme</span>
          <button
            onClick={() => setDark((v) => !v)}
            className="relative h-[22px] w-[38px] rounded-full border-none p-0"
            style={{ background: dark ? 'var(--border)' : 'var(--accent)', cursor: 'pointer' }}
            title="Toggle theme"
          >
            <div
              className="absolute h-4 w-4 rounded-full transition-all"
              style={{ background: dark ? 'var(--text-dim)' : 'var(--accent-ink)', top: 3, left: dark ? 3 : 19 }}
            />
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex h-16 flex-shrink-0 items-center justify-between px-7"
          style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}
        >
          <div>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 19, color: 'var(--text)' }}>
              {screenTitle}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 1 }}>{screenSubtitle}</div>
          </div>
        </header>

        <div className="flex-1 overflow-auto">
      {view === 'people' ? (
        <main className="space-y-5 p-7">
          <FindPeoplePanel />
          <DedupePanel />
        </main>
      ) : view === 'posts' ? (
        <main className="p-7">
          <PostMinerPanel />
        </main>
      ) : view === 'events' ? (
        <main className="p-7">
          <EventFinderPanel onScrapeEvent={handleScrapeEvent} />
        </main>
      ) : view === 'clean' ? (
        <main className="p-7">
          <CleanListPanel />
        </main>
      ) : (
      <main className="space-y-5 p-7">
        <ScrapeForm
          form={form}
          setForm={setForm}
          busy={busy}
          onScrape={handleScrape}
          onGenerateExcel={handleGenerateExcel}
          onCompare={handleCompare}
          onExport={handleExport}
        />

        <ProgressBar percent={progress.percent} label={progress.label} active={busy} />

        <StatsPanel result={result} />

        {years.length > 0 && (
          <div className="card animate-fade-up p-4">
            <div className="field-label mb-3">Stored years</div>
            <div className="flex flex-wrap gap-2.5">
              {years.map((y) => (
                <div key={y.year} className="year-chip flex items-center gap-3 rounded-xl py-2 pl-3 pr-2">
                  <span className="mono text-base font-bold tracking-tight text-main">{y.year}</span>
                  <span className="flex gap-1.5 text-[11px] font-semibold">
                    <span className="badge-accent">{y.speakers} speakers</span>
                    <span
                      className="rounded-md px-2 py-0.5"
                      style={{
                        background: 'color-mix(in srgb, var(--info) 16%, transparent)',
                        color: 'var(--info)',
                      }}
                    >
                      {y.companies} partners
                    </span>
                  </span>
                  <button
                    onClick={() => handleDeleteYear(y.year)}
                    title={`Delete ${y.year}`}
                    className="chip-remove rounded-lg px-2 py-1 text-xs font-medium"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <LogPanel logs={logs} live={busy} />
          <ComparePanel comparison={compare?.comparison} downloadUrl={compare?.downloadUrl} />
        </div>

        <ResultsTable result={result} onEditLinkedIn={handleEditLinkedIn} />

        <SearchPanel />

        <BatchPanel />

        <footer className="pt-4 text-center text-xs text-dim">
          Playwright → Puppeteer → Axios fallback · heuristic + optional AI extraction · free LinkedIn enrichment
        </footer>
      </main>
      )}
        </div>
      </div>

      {toast && (
        <div
          className="animate-fade-up fixed bottom-5 right-5 z-50 max-w-sm rounded-lg px-4 py-3 text-[13px] font-medium"
          style={{
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            color:
              toast.type === 'error'
                ? 'var(--danger)'
                : toast.type === 'success'
                  ? 'var(--success)'
                  : 'var(--text)',
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
