# Comparison Module

## Purpose

- Compare stored speaker/company datasets across years.
- Identify recurring and missing people/companies.

## Important Files

- `server/src/routes/compare.js`
- `server/src/compare/compare.js`
- `server/src/export/excel.js`
- `client/src/components/ComparePanel.jsx`

## Responsibilities

- Load base and target years.
- Normalize names and companies.
- Match exact or fuzzy keys.
- Build comparison summary.
- Generate `comparison.xlsx`.

## Public Interfaces

- `POST /api/compare`
- `GET /api/years`
- `GET /api/data/:year`
- `DELETE /api/data/:year`
- `compareYears()`
- `comparePeople()`
- `compareCompanies()`

## Dependencies

- Stored JSON data in `data/<year>/`.
- `normalizeName()` and `normalizeCompany()`.
- `string-similarity`.
- Excel export builder.

## Common Modification Points

- Change fuzzy threshold default: `server/src/compare/compare.js`.
- Change comparison sheets: `buildComparisonWorkbook()` in `server/src/export/excel.js`.
- Change UI summary: `client/src/components/ComparePanel.jsx`.

