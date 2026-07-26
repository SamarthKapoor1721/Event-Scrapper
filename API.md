# API

## Conventions

- Base path: `/api`.
- JSON request/response bodies.
- Error responses generally use `{ "error": "message" }`.
- Download endpoints return files.
- Authentication not detected during repository analysis.

## Health

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Returns `{ ok, aiFallback, time }`. |

## Scraping

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/scrape` | Scrape one or more event URLs and save year data. |
| `GET` | `/api/scrape/logs/:jobId` | SSE stream of scrape logs/progress. |

### `POST /api/scrape`

- Body:
  - `year`
  - `url` or `urls`
  - `event` or `eventName`
  - `selectors`
  - `scope`
  - `useAI`
  - `findLinkedIn`
  - `retries`
  - `crawl`
  - `maxPages`
  - `maxDepth`
  - `jobId`
- Response:
  - `jobId`
  - `speakers`
  - `companies`
  - `count`
  - `confidence`
  - `meta`

## Stored Data

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/years` | List stored years and speaker/company counts. |
| `GET` | `/api/data/:year` | Return stored speakers, companies, and meta. |
| `DELETE` | `/api/data/:year` | Delete stored year folder. |

## Exports

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/generate-excel` | Build year workbook from stored data. |
| `POST` | `/api/export` | Export stored data as CSV or JSON. |
| `GET` | `/api/download/:filename` | Download generated artifact. |

### `POST /api/generate-excel`

- Body: `year`, optional `event`, optional edited `speakers`.
- Persists manual LinkedIn edits before generating workbook.
- Response: `filename`, `downloadUrl`, `counts`.

### `POST /api/export`

- Body:
  - `year`
  - `format`: `csv` or `json`
  - `kind`: `speakers`, `companies`, or `all`
  - `event`
- Response: `files[]` with `filename` and `downloadUrl`.

## Compare

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/compare` | Compare two stored years and generate comparison workbook. |

- Body: `baseYear`, `targetYear`, `threshold`, `fuzzy`, `event`.
- Response: `filename`, `downloadUrl`, `summary`, `comparison`.

## Enrichment / Leads

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/enrich/batch` | Enrich CSV/rows with LinkedIn profile URLs. |
| `POST` | `/api/search-profiles` | Run raw or structured LinkedIn X-ray searches. |
| `POST` | `/api/mine-posts` | Find POC leads for companies. |
| `POST` | `/api/find-events` | Find events related to roles/industries/location. |
| `POST` | `/api/subtract-lists` | Remove master contacts from incoming lists. |
| `POST` | `/api/dedupe` | Dedupe uploaded CSV/XLSX/JSON/text data. |

## Request Flow

- Client calls `client/src/api.js`.
- Route validates minimal required fields.
- Service modules perform work.
- Outputs are saved through `storage.js`.
- Route returns JSON plus download URLs when relevant.

## Error Handling

- Bad input returns `400`.
- Missing stored data returns `404`.
- Unhandled workflow failures usually return `500`.
- Error message is surfaced to frontend toast/panel through `Error(data.error || status)`.

