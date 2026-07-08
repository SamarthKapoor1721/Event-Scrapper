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
  const [dark, setDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState({ percent: 0, label: 'Idle' });
  const [result, setResult] = useState(null);
  const [compare, setCompare] = useState(null);
  const [toast, setToast] = useState(null);
  const [years, setYears] = useState([]);
  const esRef = useRef(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
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

  return (
    <div className="min-h-screen">
      <header className="sticky top-4 z-50 mx-auto max-w-5xl rounded-[1.5rem] border border-white/40 bg-white/60 px-2 py-2 shadow-[0_8px_30px_rgb(0,0,0,0.06)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/60 dark:shadow-[0_8px_30px_rgb(0,0,0,0.2)]">
        <div className="flex items-center justify-between px-3">
          <div className="flex items-center gap-6">
            <h1 className="flex items-center gap-1.5 text-xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
              <svg className="h-6 w-6 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Event<span className="gradient-text font-extrabold">Scout</span>
            </h1>
            <nav className="hidden items-center gap-1.5 rounded-2xl bg-white/50 p-1.5 shadow-sm dark:bg-black/20 md:flex">
              {[
                ['scraper', 'Scraper'],
                ['people', 'Find People'],
                ['posts', 'Company POCs'],
                ['events', 'Event Finder'],
                ['clean', 'Dedupe'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setView(key)}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-300 ${
                    view === key
                      ? 'bg-white text-indigo-600 shadow-md dark:bg-indigo-500/20 dark:text-indigo-300'
                      : 'text-slate-500 hover:bg-white/40 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>
          <button
            onClick={() => setDark((d) => !d)}
            className="flex items-center justify-center rounded-xl bg-white/50 p-2.5 text-slate-600 shadow-sm transition hover:bg-white hover:text-indigo-600 dark:bg-black/20 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-indigo-400"
            title="Toggle dark mode"
          >
            {dark ? (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {view === 'people' ? (
        <main className="mx-auto max-w-6xl space-y-5 px-4 py-7">
          <FindPeoplePanel />
          <DedupePanel />
        </main>
      ) : view === 'posts' ? (
        <main className="mx-auto max-w-6xl px-4 py-7">
          <PostMinerPanel />
        </main>
      ) : view === 'events' ? (
        <main className="mx-auto max-w-6xl px-4 py-7">
          <EventFinderPanel onScrapeEvent={handleScrapeEvent} />
        </main>
      ) : view === 'clean' ? (
        <main className="mx-auto max-w-6xl px-4 py-7">
          <CleanListPanel />
        </main>
      ) : (
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-7">
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
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Stored years</div>
            <div className="flex flex-wrap gap-2.5">
              {years.map((y) => (
                <div
                  key={y.year}
                  className="group flex items-center gap-3 rounded-xl border border-slate-200/70 bg-slate-50/70 py-2 pl-3 pr-2 transition hover:border-indigo-300/70 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                >
                  <span className="text-base font-extrabold tracking-tight text-slate-800 dark:text-slate-100">{y.year}</span>
                  <span className="flex gap-1.5 text-[11px] font-semibold">
                    <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
                      {y.speakers} speakers
                    </span>
                    <span className="rounded-md bg-violet-50 px-2 py-0.5 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
                      {y.companies} partners
                    </span>
                  </span>
                  <button
                    onClick={() => handleDeleteYear(y.year)}
                    title={`Delete ${y.year}`}
                    className="rounded-lg px-2 py-1 text-xs font-medium text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
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

        <footer className="pt-4 text-center text-xs text-slate-400">
          Playwright → Puppeteer → Axios fallback · heuristic + optional AI extraction · free LinkedIn enrichment
        </footer>
      </main>
      )}

      {toast && (
        <div
          className={`animate-fade-up fixed bottom-5 right-5 z-50 max-w-sm rounded-xl px-4 py-3 text-sm font-medium text-white shadow-xl ${
            toast.type === 'error' ? 'bg-red-600' : toast.type === 'success' ? 'bg-emerald-600' : 'bg-slate-800'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
