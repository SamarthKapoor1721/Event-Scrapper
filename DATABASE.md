# Database

## Storage Type

- No relational database, NoSQL database, or ORM detected during repository analysis.
- Persistence is JSON-on-disk via `server/src/storage/storage.js`.

## Stored Data

| Location | Contents |
| --- | --- |
| `data/<year>/speakers.json` | Scraped/enriched speaker records. |
| `data/<year>/companies.json` | Scraped company records. |
| `data/<year>/meta.json` | Scrape metadata. |
| `data/linkedin-cache.json` | Cached LinkedIn matching results. |
| `server/output/` | Generated XLSX/CSV/JSON downloads. |

## Record Summaries

### Speaker

- `name`
- `designation`
- `company`
- `profileUrl`
- `imageUrl`
- Optional LinkedIn fields:
  - `linkedinUrl`
  - `linkedinConfidence`
  - `linkedinLevel`
  - `linkedinStatus`

### Company

- `company`
- `category`
- `website`
- `logoUrl`

### Meta

- Includes scrape context such as year, event, URLs, confidence, crawl/fetch details, and timestamp.
- Exact fields may vary by workflow.

## Relationships

- No formal constraints.
- Year folder groups speaker/company/meta files.
- Compare workflow reads two year folders and computes relationships in memory.
- LinkedIn cache keys are derived from name + company.

## Migrations

- Not detected during repository analysis.

## Seed Data

- `data/2025/companies.json`
- `data/2025/speakers.json`

## Indexes

- Not applicable to JSON file storage.

## Constraints

- Enforced in code only:
  - Year/output path names are sanitized with `path.basename`.
  - Duplicate speakers/companies are merged by normalized keys.
  - LinkedIn cache uses a TTL of 30 days.

