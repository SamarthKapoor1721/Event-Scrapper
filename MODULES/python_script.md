# Python Lead Scraper Script

## Purpose

- Standalone CLI for scraping LinkedIn profile leads from search prompts.
- Mirrors parts of the Node lead search/classification workflow.

## Important Files

- `scripts/lead_scraper.py`
- `scripts/requirements.txt`

## Responsibilities

- Accept one or more search prompts.
- Drive Chromium through Playwright.
- Parse LinkedIn profile URLs from Google/Brave/Bing result pages.
- Extract name/designation/company from result titles.
- Classify seniority and department.
- Write CSV and optional XLSX.

## Public Interfaces

- CLI:
  - `python scripts/lead_scraper.py "query"`
  - `python scripts/lead_scraper.py --query-file prompt.txt --xlsx`

## Dependencies

- Python Playwright.
- Optional `openpyxl` for XLSX output.

## Common Modification Points

- Search engine list: `ENGINES`.
- Result parsing JavaScript: `JS_EXTRACT`.
- Classification patterns: `SENIORITY`, `DEPARTMENT`, `JUNK`.
- Output fields: `HEADERS`.

