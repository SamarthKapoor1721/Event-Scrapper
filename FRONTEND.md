# Frontend

## Overview

- React single-page app in `client/src`.
- Vite dev server proxies `/api` to backend.
- No React Router detected; `App.jsx` uses local `view` state for tabs.
- Styling uses Tailwind classes plus shared CSS component classes.

## Entry Points

- `client/src/main.jsx`: React mount.
- `client/src/App.jsx`: main layout, navigation, app state, scrape/export handlers.
- `client/src/api.js`: all HTTP calls and download/log URL builders.
- `client/src/index.css`: design tokens, dark/light theme, shared classes.

## Pages / Views

| View Key | UI | Components |
| --- | --- | --- |
| `scraper` | Conference scraper | `ScrapeForm`, `ProgressBar`, `StatsPanel`, `LogPanel`, `ComparePanel`, `ResultsTable`, `SearchPanel`, `BatchPanel` |
| `people` | Find people and dedupe | `FindPeoplePanel`, `DedupePanel` |
| `posts` | Company POC miner | `PostMinerPanel` |
| `events` | Event finder | `EventFinderPanel` |
| `clean` | Dedupe/subtract list workflow | `CleanListPanel` |

## Routing

- Not detected during repository analysis.
- Sidebar buttons set `view` in `App.jsx`.

## Components

| Component | Purpose |
| --- | --- |
| `ScrapeForm` | Main scrape form, advanced options, export/compare buttons. |
| `ResultsTable` | Speakers/companies table; editable LinkedIn URLs. |
| `StatsPanel` | Count/confidence/scrape timestamp summary. |
| `ProgressBar` | Scrape progress display. |
| `LogPanel` | SSE log display. |
| `ComparePanel` | Compare summary and download. |
| `BatchPanel` | CSV LinkedIn enrichment. |
| `SearchPanel` | Raw LinkedIn X-ray search. |
| `FindPeoplePanel` | Structured people search by city/role/industry. |
| `PostMinerPanel` | Company-to-POC lead mining. |
| `EventFinderPanel` | Event discovery plus one-click scrape handoff. |
| `CleanListPanel` | Master/incoming list subtraction. |
| `DedupePanel` | File dedupe workflow. |
| `Picker` | Reusable multi-select/add input. |

## Hooks / State

- Uses built-in React hooks only.
- Main app state:
  - `form`
  - `view`
  - `dark`
  - `busy`
  - `logs`
  - `progress`
  - `result`
  - `compare`
  - `toast`
  - `years`
- EventSource reference stored in `esRef`.

## API Layer

- All calls live in `client/src/api.js`.
- `postJson()`, `getJson()`, and `del()` normalize errors.
- `newJobId()` creates client-side IDs so SSE can open before `POST /scrape`.

## Forms

- Most components own local form state.
- File upload panels convert files to text/base64 payloads before POSTing.
- `ScrapeForm` passes changes up to `App.jsx` through `setForm`.

## Styling

- Tailwind utility classes are used directly in JSX.
- Theme variables live in `:root` and `html.light`.
- Shared classes include `.card`, `.btn-primary`, `.btn-secondary`, `.input`, badges/pills, etc.
- Dark theme is default; toggled by adding/removing `light` on `document.documentElement`.

## UI Architecture

- Workflow panels are independent and call `api.js`.
- `App.jsx` coordinates shared scrape state, stored years, downloads, and toasts.
- Avoid adding global state unless workflows become genuinely cross-cutting.

## Testing

- Frontend test framework not detected during repository analysis.

