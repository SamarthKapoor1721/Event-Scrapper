# Backend

## Overview

- Express API in `server/src/index.js`.
- Route modules are mounted under `/api`.
- Long-running jobs use `jobLogger()` and `logBus`.
- Data is persisted as JSON files, not through a database server.

## Entry Point

- `server/src/index.js`
  - Loads `dotenv/config`.
  - Enables CORS.
  - Parses JSON up to `25mb`.
  - Adds concise request logging.
  - Registers routes:
    - `scrapeRoutes`
    - `excelRoutes`
    - `compareRoutes`
    - `downloadRoutes`
    - `enrichRoutes`

## APIs

- See `API.md` for endpoint summary.
- Public surface is local app API under `/api`.
- Authentication not detected during repository analysis.

## Routes

| File | Responsibilities |
| --- | --- |
| `routes/scrape.js` | `/scrape`, `/scrape/logs/:jobId`; scrape orchestration and storage. |
| `routes/enrich.js` | LinkedIn batch enrichment, profile search, POC mining, event finding, dedupe, subtract lists. |
| `routes/excel.js` | Generate Excel; export JSON/CSV. |
| `routes/compare.js` | Compare years; list/load/delete stored year data. |
| `routes/download.js` | Download generated files. |

## Services

### Scraper

- `scraper/browser.js`
  - `fetchPage()` tries Playwright, optional Puppeteer, then Axios.
  - Handles auto-scroll and challenge detection.
- `scraper/crawler.js`
  - Same-domain crawl helpers.
  - Prioritizes event-relevant links.
  - Skips static assets and off-domain URLs.
- `scraper/extractor.js`
  - Cheerio extraction.
  - Combines configured selectors with heuristic speaker/company discovery.
  - Produces confidence score.
- `scraper/scraper.js`
  - Validates URL(s).
  - Handles retries, multi-URL merge, optional crawl, optional AI fallback.
  - Dedupes/normalizes final records.

### Enrichment

- `enrich/linkedin.js`
  - LinkedIn profile matching for known people.
  - X-ray lead searches.
  - Company POC mining.
  - Event discovery.
  - Role variants, role matching, lead classification.
  - Provider support: Brave API, Google CSE, keyless browser search.
- `enrich/cache.js`
  - 30-day LinkedIn match cache at `data/linkedin-cache.json`.

### Export

- `export/excel.js`
  - Year workbook, rows workbook, profiles workbook, comparison workbook.
- `export/csv.js`
  - Generic CSV plus speaker/company CSV helpers.

### Storage

- `storage/storage.js`
  - `saveYear()`, `loadYear()`, `deleteYear()`, `listYears()`.
  - `saveOutput()`, `outputPath()`.
  - Sanitizes year/output filenames with `path.basename`.

### Compare

- `compare/compare.js`
  - Exact and fuzzy matching for people and companies.
  - Default fuzzy threshold: `0.82`.

### Normalization

- `normalize/normalize.js`
  - `clean()`, `normalizeName()`, `normalizeCompany()`, `absoluteUrl()`, `dedupeMerge()`.

## Models

- No ORM models detected during repository analysis.
- Data shapes are plain JS objects:
  - Speaker: `name`, `designation`, `company`, `profileUrl`, `imageUrl`, optional LinkedIn fields.
  - Company: `company`, `category`, `website`, `logoUrl`.
  - Meta: year/event/source URLs/confidence/scraped timestamp.

## Database

- No database server or ORM detected during repository analysis.
- JSON persistence only.

## Authentication

- Not detected during repository analysis.

## Middleware

- `cors()`.
- `express.json({ limit: '25mb' })`.
- Request log middleware.
- `/api` 404 handler.
- Generic error handler.

## Jobs / Workers

- No external job queue detected during repository analysis.
- Long-running work runs in request handlers.
- Progress/logs are emitted through in-memory `LogBus`.

## Utilities

- `utils/logger.js`: per-job logging, progress, SSE backlog.
- `config/selectors.js`: default/event/override selector resolution.
- `ai/aiFallback.js`: optional Anthropic fallback.

