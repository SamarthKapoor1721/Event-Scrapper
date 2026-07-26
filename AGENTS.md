# EventScout Agent Context

## Project Overview

- Full-stack conference/event scraping and lead discovery app.
- Primary workflows:
  - Scrape event websites for speakers and companies.
  - Optionally enrich speakers with LinkedIn profile matches.
  - Find LinkedIn leads by X-ray search filters.
  - Mine company lists for points of contact.
  - Find related events.
  - Dedupe/subtract contact lists.
  - Export JSON, CSV, and Excel reports.

## Tech Stack

- Frontend: React 18, Vite, Tailwind CSS, plain component state.
- Backend: Node.js ESM, Express, Playwright, optional Puppeteer, Axios, Cheerio.
- Exports: ExcelJS, xlsx, CSV helpers.
- Matching/search: string-similarity, Fuse.js, custom heuristics.
- Python script: Playwright-based LinkedIn lead scraper in `scripts/`.
- Persistence: JSON files under `data/`; generated files under `server/output/`.

## Folder Structure

- `client/`: Vite React single-page app.
- `client/src/components/`: Workflow panels and reusable UI pieces.
- `server/src/routes/`: Express route modules.
- `server/src/scraper/`: Browser fetching, crawling, extraction, scrape orchestration.
- `server/src/enrich/`: LinkedIn search/enrichment, event finding, lead classification, cache.
- `server/src/storage/`: JSON persistence and generated artifact paths.
- `server/src/export/`: CSV/Excel workbook generation.
- `server/src/compare/`: Year-over-year matching.
- `server/src/normalize/`: Shared cleanup, normalization, dedupe helpers.
- `server/src/config/`: Default and event-specific CSS selectors.
- `server/src/ai/`: Optional Anthropic extraction fallback.
- `scripts/`: Standalone Python lead scraper.
- `data/`: Stored scrape data; currently includes `data/2025/*.json`.

## Coding Standards

- JavaScript uses ES modules (`import`/`export`).
- Backend functions are mostly small, file-scoped helpers plus named exports.
- API errors return `{ error: string }` with appropriate HTTP status.
- Frontend API calls go through `client/src/api.js`.
- UI state is local React `useState`/`useEffect`; no router or global state library.
- CSS uses Tailwind utility classes plus shared classes and CSS variables in `client/src/index.css`.
- Keep comments short and useful; existing code already has concise operational comments.

## Architecture Summary

- React app calls `/api/*` through Vite proxy.
- Express mounts route modules from `server/src/index.js`.
- Scraping flow:
  - `POST /api/scrape`
  - `scraper/scraper.js`
  - fetch via Playwright/Puppeteer/Axios
  - parse via Cheerio selectors and heuristics
  - optional AI fallback
  - optional LinkedIn enrichment
  - save JSON to `data/<year>/`.
- Live logs/progress use Server-Sent Events at `GET /api/scrape/logs/:jobId`.
- Exports read stored JSON and write downloadable files into `server/output/`.

## Development Rules

- Prefer existing helpers in `normalize/`, `storage/`, `export/`, `enrich/`, and `client/src/api.js`.
- Add endpoints in route modules by workflow, not in `server/src/index.js`.
- Keep route handlers thin; put reusable logic in service modules.
- Preserve JSON persistence layout: `data/<year>/speakers.json`, `companies.json`, `meta.json`.
- Preserve output path sanitization via `saveOutput()` and `outputPath()`.
- Use `jobLogger(jobId)` for long-running backend workflows.
- Keep client workflow panels independent; route all HTTP through `api.js`.

## Editing Rules

- Do not modify app source when only documentation is requested.
- Make minimal scoped edits.
- Do not rename files or folders unless explicitly requested.
- Do not reformat unrelated files.
- Do not introduce dependencies unless requested or clearly necessary.
- Ask before changing more than 5 source files.
- Preserve existing architecture and conventions.

## Things AI Agents Should Never Do

- Never delete or overwrite `data/` unless the user explicitly asks.
- Never run destructive git commands.
- Never bypass `storage.js` path sanitization for downloads.
- Never hardcode API keys or secrets.
- Never scrape aggressively by default; search engines and LinkedIn workflows can trigger rate limits.
- Never assume AI fallback is enabled; it requires `ANTHROPIC_API_KEY`.
- Never move frontend API calls out of `client/src/api.js` without a reason.

## Common Commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install root tooling. |
| `npm run install:all` | Install server and client deps. |
| `npm run dev` | Run server on `:4000` and client on `:5173`. |
| `npm run dev:server` | Run backend only. |
| `npm run dev:client` | Run frontend only. |
| `npm run build` | Build client. |
| `npm run start` | Start backend. |
| `python scripts/lead_scraper.py --help` | Inspect standalone Python scraper usage. |

## High-Level Workflow

- Start from `README.md` for product behavior.
- Inspect `client/src/App.jsx` for visible workflow wiring.
- Inspect `client/src/api.js` for frontend/backend contract.
- Inspect `server/src/routes/*.js` for endpoint bodies.
- Inspect module docs in `MODULES/` before exploring source.
- Use `rg` for targeted search.

## Testing

- Automated test suite not detected during repository analysis.
- No lint script detected during repository analysis.

