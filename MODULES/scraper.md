# Scraper Module

## Purpose

- Extract speakers and companies from event websites.
- Supports single page, multiple URLs, and bounded same-domain crawling.

## Important Files

- `server/src/routes/scrape.js`
- `server/src/scraper/scraper.js`
- `server/src/scraper/browser.js`
- `server/src/scraper/crawler.js`
- `server/src/scraper/extractor.js`
- `server/src/config/selectors.js`
- `server/src/ai/aiFallback.js`

## Responsibilities

- Validate and normalize URLs.
- Fetch dynamic/static HTML.
- Crawl same-domain relevant links when enabled.
- Extract records via selectors and heuristics.
- Compute extraction confidence.
- Optionally invoke AI fallback for low-confidence parses.
- Deduplicate and merge partial speaker/company records.

## Public Interfaces

- `POST /api/scrape`
- `GET /api/scrape/logs/:jobId`
- `scrape(options, logger)`
- `fetchPage(url, options, logger)`
- `extract(html, baseUrl, selectors, logger, scope)`

## Dependencies

- Playwright, optional Puppeteer, Axios.
- Cheerio.
- Normalization helpers.
- Selector config.
- Optional Anthropic API.

## Common Modification Points

- Add selectors: `server/src/config/selectors.js`.
- Improve parsing: `server/src/scraper/extractor.js`.
- Change crawl priority/filtering: `server/src/scraper/crawler.js`.
- Change retry/fallback behavior: `server/src/scraper/scraper.js` or `browser.js`.

