# EventScout (Conference Scraper Platform)

A production-quality full-stack app to discover events, scrape attendees, and manage conference data.

## Features

- **🌐 Conference Scraper**: Scrape event websites to extract speakers and companies. Supports whole-site crawling, custom CSS selectors, and an optional AI fallback for tough websites.
- **🔍 Find People & LinkedIn Enrichment**: Automatically find LinkedIn profiles for extracted speakers using intelligent fuzzy matching and keyless browser searches.
- **🏢 Company POCs (Post Miner)**: Mine company posts to find points of contact and key personnel.
- **📅 Event Finder**: Discover related events and conferences to source new leads, with 1-click scraping.
- **🧹 Dedupe & Clean List**: A list subtraction utility for contact management. Compare and clean lists to avoid duplicates.
- **📊 Export & Compare**: Generate Excel (`.xlsx`), CSV, or JSON reports. Compare scraped data across years to find recurring attendees vs missing ones.
- **✨ Premium UI**: Fast, responsive React UI with dark mode, live Server-Sent Event (SSE) logs, and a polished modern aesthetic.

```text
┌────────────┐   POST /scrape (SSE logs)   ┌─────────────────────────────┐
│  React UI  │ ──────────────────────────▶ │  Express API                │
│  (Vite)    │ ◀────────────────────────── │   scraper → parse →         │
└────────────┘   speakers/companies/excel  │   normalize → compare →     │
                                           │   export (xlsx/csv/json)    │
                                           └─────────────────────────────┘
```

## Quick start

```bash
# from the project root
npm install                # installs root tooling (concurrently)
npm run install:all        # installs server + client deps (also fetches Playwright Chromium)
npm run dev                # runs API on :4000 and UI on :5173
```

Open **http://localhost:5173**. The Vite dev server proxies `/api` to the
backend, so there is nothing else to configure.

> Run the server and client separately with `npm run dev:server` /
> `npm run dev:client` if you prefer.

## Using the app

1. Enter **Event Name**, **Year**, and **Website URL**.
2. Click **Scrape** — watch the progress bar and live logs stream in.
3. Click **Generate Excel** to build `gff_<year>.xlsx` (Speakers + Companies sheets).
4. Scrape a second year, then **Compare Years** to build `comparison.xlsx`.
5. Use **Download / Export** for `.xlsx`, `.csv`, or `.json`.

**Advanced options** (collapsible) add: **whole-site crawl** (follow same-domain
links), multiple URLs merged into one year, custom CSS selectors (JSON), retries,
AI fallback toggle, and configurable fuzzy-match threshold.

### Whole-site crawl

Enable **🕸️ Crawl whole site** in Advanced options to scrape beyond a single
page. Starting from the entered URL, the crawler follows links **on the same
domain only** (breadth-first), feeding every visited page through the same
extractor and merging the results. Pages whose URL looks speaker/exhibitor/
sponsor/company/agenda-related are visited first. Bounded by:

- **Max pages** (default 25, capped at 200) — total pages fetched.
- **Max depth** (default 2) — link hops away from the seed URL.

Assets (images, PDFs, CSS/JS), off-domain links, and `mailto:`/`tel:` are skipped.

### LinkedIn Profile Discovery

Enable **Find LinkedIn Profiles** to, after scraping, automatically find the most
likely **LinkedIn profile** for each speaker from their **Name, Designation and
Company**. For every person the module:

1. **Multi-query search** — runs up to four progressively looser queries, stopping
   early on a high-confidence hit:
   `site:linkedin.com/in "Name" "Company"` → `"Name" "Company" LinkedIn` →
   `Name Designation Company LinkedIn` → `site:linkedin.com/in Name`.
2. **Candidate collection** — gathers up to 5 unique `linkedin.com/in` URLs.
3. **Profile validation** *(best-effort)* — opens the top candidate pages and reads
   name / headline / company / location where LinkedIn exposes them (it gates most
   views, so this augments rather than replaces search matching; auto-skipped for
   batches > 25).
4. **Weighted fuzzy match** — **Name 50% · Company 30% · Designation 20%** (with
   acronym expansion, e.g. *Director AI* ↔ *Director of Artificial Intelligence*).

Each result has a **Confidence**, a **Confidence Level**, and a **Status**:

| Level | Score | Badge |
| --- | --- | --- |
| **High** | 90–100 | 🟢 green |
| **Medium** | 75–89 | 🟡 yellow |
| **Low** | < 75 | 🔴 red |

| Status | Meaning |
| --- | --- |
| **Found** | one clear best match |
| **Multiple Possible Matches** | two near-tied strong candidates — verify |
| **Verification Failed** | candidate found but the profile couldn't be verified |
| **Not Found** | no confident match |

Runs **automatically after scraping, before Excel export**, with live progress.
You can **edit/replace** any URL in the results table before exporting (a manual
URL is treated as confirmed → Found / High). The **Speakers** sheet gains:
**LinkedIn Profile URL · Confidence Score · Confidence Level · Match Status**.

Results are **cached** for 30 days (`data/linkedin-cache.json`) keyed by name +
company, so repeat runs are instant and don't re-hit the search engines.

**Batch from CSV** — the *Batch LinkedIn from CSV* panel (or `POST /api/enrich/batch`)
accepts a CSV of `Name, Designation, Company`, processes every row, and exports
`Name | Designation | Company | LinkedIn URL | Confidence | Status`.

> **Search provider — free, no key required.** Matches come from a web search for
> `linkedin.com/in/…`. Priority: **Brave Search API** (`BRAVE_API_KEY`, free tier
> ~2,000/mo — reliable from a server) → **keyless browser search** through the
> bundled Playwright browser (Brave → Ecosia → Bing → Startpage, with retries and
> back-off). No key is needed; keyless free engines rate-limit by IP, so on a
> deployed server set `BRAVE_API_KEY` (see `server/.env.example`).

### Deleting stored data

Each scraped year is listed under **Stored years**. Click the **✕** on a year
chip to delete its `data/<year>/` folder (with a confirmation prompt). Backed by
`DELETE /api/data/:year`.

## Architecture

Clean separation of concerns under `server/src/`:

| Module | Responsibility |
| --- | --- |
| `scraper/browser.js` | Page fetching — Playwright → Puppeteer → Axios fallback, auto-scroll, Cloudflare detection |
| `scraper/extractor.js` | Cheerio parsing: selector-driven + **heuristic discovery** of card grids; confidence scoring |
| `scraper/scraper.js` | Orchestration: multi-URL, retries, dedupe/merge, optional AI |
| `normalize/normalize.js` | Whitespace cleanup, name/company normalization, dedupe-merge |
| `compare/compare.js` | Comparison engine with exact + fuzzy (string-similarity) matching |
| `export/excel.js` · `csv.js` | Excel (xlsx) and CSV export engines |
| `config/selectors.js` | Default + per-event + request-override CSS selectors |
| `ai/aiFallback.js` | Optional Claude-based extraction, **only** when parse confidence is low |
| `storage/storage.js` | JSON persistence as `data/<year>/{speakers,companies}.json` |
| `utils/logger.js` | Per-job log/progress bus streamed to the UI over SSE |

Frontend (`client/src/`) is a single page composed of focused components:
`ScrapeForm`, `StatsPanel`, `ProgressBar`, `LogPanel`, `ResultsTable`,
`ComparePanel`.

## API

| Method & path | Purpose |
| --- | --- |
| `POST /api/scrape` | `{ year, url \| urls, event?, selectors?, scope?, findLinkedIn?, useAI?, retries?, crawl?, maxPages?, maxDepth?, jobId? }` → `{ speakers, companies, count, confidence, meta }` |
| `GET /api/scrape/logs/:jobId` | Server-Sent Events stream of live logs + progress |
| `POST /api/enrich/batch` | `{ rows \| csv }` (Name, Designation, Company) → `{ rows, results, downloadUrl }` LinkedIn discovery over a CSV |
| `POST /api/generate-excel` | `{ year, event?, speakers? }` (`speakers` overrides stored rows to persist manual LinkedIn edits) → builds `<event>_<year>.xlsx`, returns `downloadUrl` |
| `POST /api/compare` | `{ baseYear, targetYear, fuzzy?, threshold? }` → builds `comparison.xlsx` |
| `POST /api/export` | `{ year, format: csv\|json, kind: speakers\|companies\|all }` |
| `GET /api/download/:filename` | Download a generated artifact |
| `GET /api/years` | List stored years and their counts |
| `GET /api/data/:year` | Return stored speakers & companies |
| `DELETE /api/data/:year` | Delete stored data for a year (`data/<year>/`) |
| `GET /api/health` | Health + AI-fallback status |

## Data extracted

**Speaker:** name, designation, company, profile URL, image URL.
**Company:** company name, category, website, logo URL.

All strings are trimmed and whitespace-normalized; duplicates are removed and
partial records merged (non-empty fields fill gaps).

## Intelligent matching

Names and companies are normalized (lowercase, punctuation/diacritics removed,
spaces collapsed). Company legal suffixes are stripped so **`Google LLC` matches
`Google`** and **`Microsoft Corporation` matches `Microsoft`**. Person matching
drops middle initials so **`John A. Smith` matches `John Smith`**, with optional
Dice-coefficient fuzzy matching at a configurable threshold (default `0.82`).

## Comparison output (`comparison.xlsx`)

1. **People Coming Again** — Name, Company, Designation
2. **Companies Coming Again** — Company
3. **People Missing In 2026** — Name, Company, Designation
4. **Companies Missing In 2026** — Company

## Optional AI fallback

Disabled by default; **normal operation never requires AI.** When a scrape's
parse confidence is low *and* `useAI` is enabled, the extracted text blocks are
sent to Claude to identify speakers/companies. Configure in `server/.env`:

```bash
cp server/.env.example server/.env
# set ANTHROPIC_API_KEY=...   (model defaults to claude-opus-4-8)
```

## Error handling

Gracefully handles timeouts, missing selectors, Cloudflare/bot challenge pages
(escalates to a heavier engine), invalid URLs, empty pages, and duplicates —
all surfaced as color-coded live logs in the UI with retry support.

## Tech stack

- **Frontend:** React + Vite, Tailwind CSS, dark mode, SSE live logs.
- **Backend:** Node.js, Express, Playwright (Puppeteer/Axios fallback), Cheerio,
  Axios, `xlsx`, `string-similarity` + `fuse.js`.
