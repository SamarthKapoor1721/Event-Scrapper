# Storage And Exports Module

## Purpose

- Persist scraped year data.
- Save generated downloads.
- Build Excel, CSV, and JSON artifacts.

## Important Files

- `server/src/storage/storage.js`
- `server/src/export/excel.js`
- `server/src/export/csv.js`
- `server/src/routes/excel.js`
- `server/src/routes/download.js`

## Responsibilities

- Store year data under `data/<year>/`.
- List/delete/load stored years.
- Sanitize output filenames.
- Generate workbooks for years, generic rows, profiles, and comparisons.
- Generate CSV exports.
- Serve downloads from `server/output/`.

## Public Interfaces

- `POST /api/generate-excel`
- `POST /api/export`
- `GET /api/download/:filename`
- `saveYear()`
- `loadYear()`
- `listYears()`
- `deleteYear()`
- `saveOutput()`
- `outputPath()`

## Dependencies

- Node filesystem APIs.
- ExcelJS.
- CSV helper functions.

## Common Modification Points

- Add workbook columns: `server/src/export/excel.js`.
- Add CSV fields: `server/src/export/csv.js`.
- Change storage layout: avoid unless requested; many routes assume current layout.
- Add new downloadable artifacts: use `saveOutput()` and return `/api/download/:filename`.

