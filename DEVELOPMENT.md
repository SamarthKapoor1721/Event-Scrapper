# Development

## Local Setup

```bash
npm install
npm run install:all
```

- `npm run install:all` installs server and client dependencies.
- Server postinstall attempts `playwright install chromium`.

## Running

```bash
npm run dev
```

- Backend: `http://localhost:4000`
- Frontend: `http://localhost:5173`
- Vite proxies `/api` to the backend.

Run separately:

```bash
npm run dev:server
npm run dev:client
```

## Build

```bash
npm run build
```

- Builds the Vite client.

## Start

```bash
npm run start
```

- Starts backend from `server/src/index.js`.

## Environment

- Copy `server/.env.example` to `server/.env` when needed.

| Variable | Purpose |
| --- | --- |
| `PORT` | Backend port; defaults to `4000`. |
| `ANTHROPIC_API_KEY` | Enables optional AI extraction fallback. |
| `ANTHROPIC_MODEL` | Anthropic model name; default is set in code/example. |
| `BRAVE_API_KEY` | Preferred provider for LinkedIn/profile search. |
| `GOOGLE_CSE_KEY` | Google Custom Search API key. |
| `GOOGLE_CSE_CX` | Google Custom Search engine ID. |
| `HEADFUL` | Shows browser for manual CAPTCHA solving when truthy. |

## Testing

- Automated tests not detected during repository analysis.
- Lint script not detected during repository analysis.
- Formatting script not detected during repository analysis.

## Debugging

- Use `/api/health` to confirm backend and AI fallback status.
- Scrape progress streams through `/api/scrape/logs/:jobId`.
- Backend logs request method/path except `/api/health`.
- Generated files live in `server/output/`.
- Stored scrape data lives in `data/<year>/`.

## Common Issues

- Browser install missing:
  - Re-run dependency install in `server/`.
  - Scraper can fall back to Puppeteer/Axios, but dynamic sites may fail.
- Search engines rate-limit/CAPTCHA:
  - Keep pages low.
  - Use `BRAVE_API_KEY` or Google CSE credentials.
  - Use `HEADFUL=1` only when manual solving is needed.
- No data for export/compare:
  - Scrape and save the relevant year first.
- Invalid custom selectors:
  - Frontend expects JSON in advanced selector field.

## Common Workflows

- Add scrape behavior:
  - Update scraper/extractor modules.
  - Keep route payload stable if possible.
- Add frontend endpoint usage:
  - Add method to `client/src/api.js`.
  - Call it from the relevant panel.
- Add export field:
  - Update export builders and ensure stored data contains the field.
- Add search/enrichment behavior:
  - Prefer extending `server/src/enrich/linkedin.js` helpers.

