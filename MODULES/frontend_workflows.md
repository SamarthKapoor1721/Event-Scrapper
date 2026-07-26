# Frontend Workflows Module

## Purpose

- Provide the single-page UI for scraping, enrichment, event discovery, exports, and list cleaning.

## Important Files

- `client/src/App.jsx`
- `client/src/api.js`
- `client/src/components/*.jsx`
- `client/src/index.css`

## Responsibilities

- Coordinate navigation between workflow views.
- Manage form/result/toast/progress state.
- Open scrape SSE stream before starting scrape request.
- Trigger downloads from backend-provided URLs.
- Keep workflow panels self-contained.

## Public Interfaces

- User-facing views in `App.jsx`.
- API wrapper methods in `client/src/api.js`.
- Component props, especially:
  - `ScrapeForm`
  - `ResultsTable`
  - `EventFinderPanel`

## Dependencies

- React hooks.
- Browser `fetch`.
- Browser `EventSource`.
- Tailwind and shared CSS classes.

## Common Modification Points

- Add a backend endpoint call: update `client/src/api.js`.
- Add a new workflow tab: update `NAV`, `TITLES`, and render branch in `App.jsx`.
- Change scrape options: update `DEFAULT_FORM`, `buildPayload()`, and `ScrapeForm`.
- Change results display: `ResultsTable`.

