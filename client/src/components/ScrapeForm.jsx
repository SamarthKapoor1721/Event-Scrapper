import { useState } from 'react';

export default function ScrapeForm({ form, setForm, busy, onScrape, onGenerateExcel, onCompare, onExport }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="card animate-fade-up p-5 sm:p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Event Name">
          <input className="input" value={form.event} onChange={update('event')} placeholder="Global Fintech Fest" />
        </Field>
        <Field label="Year">
          <input className="input" value={form.year} onChange={update('year')} placeholder="2025" />
        </Field>
        <Field label="Home page URL">
          <input className="input" value={form.url} onChange={update('url')} placeholder="https://2025.globalfintechfest.com/" />
        </Field>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Speakers page URL">
          <input className="input" value={form.speakersUrl} onChange={update('speakersUrl')} placeholder="https://…/speakers" />
        </Field>
        <Field label="Partners / Companies page URL">
          <input className="input" value={form.companiesUrl} onChange={update('companiesUrl')} placeholder="https://…/partners" />
        </Field>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Fill any of the three — all are scraped together and merged into this year, with duplicates removed.
      </p>

      {/* LinkedIn enrichment — highlighted primary feature. */}
      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-indigo-200/60 bg-indigo-50/70 p-3.5 transition hover:border-indigo-300 dark:border-indigo-500/20 dark:bg-indigo-500/10">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-indigo-600"
          checked={form.findLinkedIn}
          onChange={(e) => setForm((f) => ({ ...f, findLinkedIn: e.target.checked }))}
        />
        <span>
          <span className="block text-sm font-semibold">Find LinkedIn Profiles</span>
          <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
            After scraping, automatically finds each speaker's most likely LinkedIn profile and scores the match.
            Free — no API key needed. Runs before Excel export; large lists take a few minutes.
          </span>
        </span>
      </label>

      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="mt-3 inline-flex items-center text-xs font-semibold text-indigo-600 transition hover:text-indigo-500 dark:text-indigo-400"
      >
        {showAdvanced ? 'Hide advanced options' : 'Advanced options (crawl, scope, multi-URL, AI, selectors, fuzzy)'}
      </button>

      {showAdvanced && (
        <div className="mt-3 space-y-4 rounded-xl border border-slate-200/70 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="rounded-xl border border-slate-200/70 bg-white/70 p-3.5 dark:border-white/10 dark:bg-white/5">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={form.crawl} onChange={(e) => setForm((f) => ({ ...f, crawl: e.target.checked }))} />
              Crawl whole site (follow same-domain links)
            </label>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Starts from the URL above and follows links on the same domain. Speaker/exhibitor/sponsor pages are visited first.
            </p>
            {form.crawl && (
              <div className="mt-3 grid grid-cols-2 gap-4">
                <Field label="Max pages">
                  <input type="number" min="1" max="200" className="input" value={form.maxPages} onChange={update('maxPages')} />
                </Field>
                <Field label="Max depth">
                  <input type="number" min="0" max="5" className="input" value={form.maxDepth} onChange={update('maxDepth')} />
                </Field>
              </div>
            )}
          </div>
          <Field label="Section scope selector (optional) — extract only inside one container">
            <input className="input font-mono text-xs" value={form.scope} onChange={update('scope')} placeholder="#Indiamembers" />
            <p className="mt-1 text-xs text-slate-400">
              Limits extraction to elements inside this CSS selector — e.g. one country tab. Leave blank to scrape the whole page.
            </p>
          </Field>
          <Field label="Additional URLs (one per line — scraped & merged into this year)">
            <textarea
              className="input h-20 font-mono text-xs"
              value={form.extraUrls}
              onChange={update('extraUrls')}
              placeholder="https://example.com/speakers&#10;https://example.com/partners"
            />
          </Field>
          <Field label="Custom CSS selectors (JSON, optional)">
            <textarea
              className="input h-24 font-mono text-xs"
              value={form.selectors}
              onChange={update('selectors')}
              placeholder='{ "speaker": { "card": [".speaker-card"], "name": [".sp-name"] } }'
            />
          </Field>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={form.useAI} onChange={(e) => setForm((f) => ({ ...f, useAI: e.target.checked }))} />
              AI fallback
            </label>
            <Field label="Retries">
              <input type="number" min="0" max="5" className="input" value={form.retries} onChange={update('retries')} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={form.fuzzy} onChange={(e) => setForm((f) => ({ ...f, fuzzy: e.target.checked }))} />
              Fuzzy compare
            </label>
            <Field label="Threshold">
              <input type="number" step="0.01" min="0" max="1" className="input" value={form.threshold} onChange={update('threshold')} />
            </Field>
          </div>
          <Field label="Compare years (base → target)">
            <div className="flex items-center gap-2">
              <input className="input" value={form.baseYear} onChange={update('baseYear')} placeholder="2025" />
              <span className="text-slate-400">→</span>
              <input className="input" value={form.targetYear} onChange={update('targetYear')} placeholder="2026" />
            </div>
          </Field>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <button onClick={onScrape} disabled={busy} className="btn-primary">
          {busy ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Scraping…
            </>
          ) : (
            'Scrape'
          )}
        </button>
        <button onClick={() => onGenerateExcel()} disabled={busy} className="btn-secondary">Generate Excel</button>
        <button onClick={onCompare} disabled={busy} className="btn-secondary">Compare Years</button>
        <div className="relative">
          <details className="group">
            <summary className="btn-secondary cursor-pointer list-none">Download / Export</summary>
            <div className="absolute z-10 mt-1.5 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-slate-800">
              <DropItem onClick={() => onGenerateExcel(true)}>Excel (.xlsx)</DropItem>
              <DropItem onClick={() => onExport('csv', 'all')}>CSV (speakers+partners)</DropItem>
              <DropItem onClick={() => onExport('json', 'all')}>JSON (speakers+partners)</DropItem>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function DropItem({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      className="block w-full rounded-lg px-3 py-2 text-left text-sm transition hover:bg-slate-100 dark:hover:bg-white/10"
    >
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
