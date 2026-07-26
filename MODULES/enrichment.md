# Enrichment And Lead Search Module

## Purpose

- Find LinkedIn profiles for known people.
- Search LinkedIn profiles by role/location/industry.
- Mine companies for points of contact.
- Discover related events.

## Important Files

- `server/src/routes/enrich.js`
- `server/src/enrich/linkedin.js`
- `server/src/enrich/cache.js`
- `client/src/components/FindPeoplePanel.jsx`
- `client/src/components/SearchPanel.jsx`
- `client/src/components/BatchPanel.jsx`
- `client/src/components/PostMinerPanel.jsx`
- `client/src/components/EventFinderPanel.jsx`

## Responsibilities

- Build X-ray search queries.
- Search providers and parse result cards.
- Score LinkedIn candidate matches.
- Validate profiles when feasible.
- Classify lead seniority/department/junk status.
- Cache person-to-profile matches.
- Export profile/event results.

## Public Interfaces

- `POST /api/enrich/batch`
- `POST /api/search-profiles`
- `POST /api/mine-posts`
- `POST /api/find-events`
- `enrichPeople()`
- `enrichSpeakers()`
- `searchProfiles()`
- `findEvents()`
- `buildXrayQuery()`
- `classifyLead()`

## Dependencies

- Playwright browser search.
- Brave Search API when `BRAVE_API_KEY` exists.
- Google CSE when `GOOGLE_CSE_KEY` and `GOOGLE_CSE_CX` exist.
- Cheerio and Axios.
- `data/linkedin-cache.json`.

## Common Modification Points

- Query generation: `buildXrayQuery()`, `roleVariants()`.
- Lead scoring: `classifyLead()`.
- Role matching strictness: `roleMatches()`.
- Search provider behavior: `searchProfiles()`.
- Cache TTL: `server/src/enrich/cache.js`.

