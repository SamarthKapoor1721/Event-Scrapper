# List Tools Module

## Purpose

- Deduplicate uploaded contact lists.
- Subtract existing/master contacts from incoming lists.

## Important Files

- `server/src/routes/enrich.js`
- `client/src/components/DedupePanel.jsx`
- `client/src/components/CleanListPanel.jsx`

## Responsibilities

- Accept CSV/XLSX/JSON/text-like uploaded payloads from frontend panels.
- Normalize identity fields.
- Deduplicate rows.
- Compare incoming rows against master rows.
- Return downloadable cleaned outputs.

## Public Interfaces

- `POST /api/dedupe`
- `POST /api/subtract-lists`
- `api.dedupe()`
- `api.subtractLists()`

## Dependencies

- `xlsx` for spreadsheet parsing.
- Normalization helpers in `server/src/normalize/normalize.js`.
- Export helpers for output files.

## Common Modification Points

- Matching field behavior: route handlers in `server/src/routes/enrich.js`.
- Upload payload conversion: frontend panels.
- Output columns/files: route handler response and export helpers.

