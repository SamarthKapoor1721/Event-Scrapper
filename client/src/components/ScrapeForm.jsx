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
      <p className="mt-2 text-xs text-dim">
        Fill any of the three — all are scraped together and merged into this year, with duplicates removed.
      </p>

      {/* LinkedIn enrichment — highlighted primary feature. */}
      <label className="mt-4 flex cursor-pointer items-start gap-3 accent-panel rounded-xl p-3.5">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-lime"
          checked={form.findLinkedIn}
          onChange={(e) => setForm((f) => ({ ...f, findLinkedIn: e.target.checked }))}
        />
        <span>
          <span className="block text-sm font-semibold">Find LinkedIn Profiles</span>
          <span className="mt-0.5 block text-xs text-dim">
            After scraping, automatically finds each speaker's most likely LinkedIn profile and scores the match.
            Free — no API key needed. Runs before Excel export; large lists take a few minutes.
          </span>
        </span>
      </label>

      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="mt-3 inline-flex items-center text-xs font-semibold link-accent transition"
      >
        {showAdvanced ? 'Hide advanced options' : 'Advanced options (crawl, scope, multi-URL, AI, selectors, fuzzy)'}
      </button>

      {showAdvanced && (
        <div className="mt-3 space-y-4 subpanel rounded-xl p-4">
          <div className="subpanel rounded-xl p-3.5">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" className="h-4 w-4 accent-lime" checked={form.crawl} onChange={(e) => setForm((f) => ({ ...f, crawl: e.target.checked }))} />
              Crawl whole site (follow same-domain links)
            </label>
            <p className="mt-1 text-xs text-dim">
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
            <p className="mt-1 text-xs text-dim">
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
              <input type="checkbox" className="h-4 w-4 accent-lime" checked={form.useAI} onChange={(e) => setForm((f) => ({ ...f, useAI: e.target.checked }))} />
              AI fallback
            </label>
            <Field label="Retries">
              <input type="number" min="0" max="5" className="input" value={form.retries} onChange={update('retries')} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-lime" checked={form.fuzzy} onChange={(e) => setForm((f) => ({ ...f, fuzzy: e.target.checked }))} />
              Fuzzy compare
            </label>
            <Field label="Threshold">
              <input type="number" step="0.01" min="0" max="1" className="input" value={form.threshold} onChange={update('threshold')} />
            </Field>
          </div>
          <Field label="Compare years (base → target)">
            <div className="flex items-center gap-2">
              <input className="input" value={form.baseYear} onChange={update('baseYear')} placeholder="2025" />
              <span className="text-dim">→</span>
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
            <div className="menu-surface absolute z-10 mt-1.5 w-48 rounded-xl p-1.5 shadow-xl">
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
      className="menu-item block w-full rounded-lg px-3 py-2 text-left text-sm"
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
