# Architecture

## System Architecture

```mermaid
flowchart LR
  UI[React Vite UI] --> API[Express API]
  UI <-. SSE logs .-> Logs[LogBus]
  API --> Scraper[Scraper Orchestrator]
  Scraper --> Browser[Playwright/Puppeteer/Axios Fetch]
  Scraper --> Extractor[Cheerio Extractor]
  Scraper --> AI[Optional Anthropic Fallback]
  API --> Enrich[LinkedIn/Search Enrichment]
  API --> Compare[Compare Engine]
  API --> Export[Excel/CSV Export]
  Scraper --> Storage[JSON Storage]
  Enrich --> Storage
  Compare --> Storage
  Export --> Output[server/output]
  Storage --> Data[data/year JSON]
```

## Request Flow

### Scrape

```mermaid
sequenceDiagram
  participant UI as React UI
  participant API as POST /api/scrape
  participant SSE as /api/scrape/logs/:jobId
  participant S as scraper/scraper.js
  participant E as extractor.js
  participant D as data/

  UI->>SSE: Open EventSource(jobId)
  UI->>API: POST scrape payload
  API->>S: scrape()
  S->>S: fetch/crawl URL(s)
  S->>E: extract speakers/companies
  S->>S: normalize + dedupe
  API->>D: saveYear()
  API-->>UI: JSON result
  SSE-->>UI: logs/progress/done
```

### Export

- UI calls `POST /api/generate-excel` or `POST /api/export`.
- Route loads stored year through `loadYear()`.
- Export module creates workbook/CSV/JSON.
- `saveOutput()` writes to `server/output/`.
- UI downloads through `GET /api/download/:filename`.

### Lead Search / Enrichment

- UI calls `/api/search-profiles`, `/api/enrich/batch`, `/api/mine-posts`, or `/api/find-events`.
- `server/src/enrich/linkedin.js` builds queries, searches providers, parses cards, classifies leads, and exports files.
- Provider priority for profile searches:
  - `BRAVE_API_KEY`
  - `GOOGLE_CSE_KEY` + `GOOGLE_CSE_CX`
  - keyless Playwright browser search

## Data Flow

- Input:
  - URL(s), event/year, selectors, crawl options.
  - CSV/text/manual rows for enrichment and list tools.
- Processing:
  - HTML fetch/crawl.
  - Cheerio selector and heuristic extraction.
  - Normalization and dedupe.
  - Optional LinkedIn enrichment and optional AI extraction fallback.
- Persistence:
  - `data/<year>/speakers.json`
  - `data/<year>/companies.json`
  - `data/<year>/meta.json`
  - `data/linkedin-cache.json`
- Output:
  - Download artifacts in `server/output/`.

## Module Relationships

| Module | Depends On | Used By |
| --- | --- | --- |
| `routes/scrape.js` | scraper, enrich, storage, logger | React scraper workflow |
| `scraper/scraper.js` | browser, crawler, extractor, normalize, selectors, AI | `/api/scrape` |
| `scraper/extractor.js` | Cheerio, normalize | scraper orchestration |
| `enrich/linkedin.js` | Playwright, Axios, Cheerio, cache, normalize | enrichment/search/event endpoints |
| `routes/excel.js` | export, storage, enrich manual fields | export workflow |
| `routes/compare.js` | compare, export, storage | year comparison workflow |
| `storage/storage.js` | filesystem | most backend workflows |
| `client/src/api.js` | fetch | all React panels |

## Major Services

- Scraper service: fetches/crawls pages and extracts speakers/companies.
- Enrichment service: LinkedIn matching, X-ray profile search, POC mining, event finding.
- Storage service: year data and generated artifacts.
- Export service: Excel/CSV/JSON output.
- Compare service: exact/fuzzy year comparisons.
- Logger service: per-job progress and SSE backlog.

## Important Design Decisions

- JSON file persistence instead of a database.
- No authentication detected during repository analysis.
- No frontend router; `App.jsx` switches local `view` state.
- SSE only supports scrape logs endpoint; other long-running routes use `jobLogger` but client panels generally wait for response.
- AI extraction is optional and only intended for low-confidence parsing.
- Browser search is keyless by default but can be unreliable on rate-limited IPs.

