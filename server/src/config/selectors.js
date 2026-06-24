/**
 * Configurable CSS selectors.
 *
 * The scraper works in two modes:
 *   1. Explicit selectors  - when the caller passes `selectors` in the request,
 *      or an event preset below matches, those selectors are used directly.
 *   2. Heuristic discovery - when no selectors are provided / they yield nothing,
 *      the extractor falls back to generic heuristics (see extractor.js).
 *
 * Each entry maps a logical field to a list of candidate selectors. The first
 * selector that yields a value wins. This keeps the architecture reusable for
 * any conference site, not just GFF.
 */

export const DEFAULT_SELECTORS = {
  speaker: {
    // Candidate container selectors for a single speaker card.
    card: [
      '[class*="speaker"][class*="card"]',
      '.speaker-card',
      '.speaker',
      '.card-speaker',
      '[data-speaker]',
      '.team-member',
    ],
    name: ['[class*="name"]', 'h3', 'h4', 'h5', '.title', 'a'],
    designation: ['[class*="designation"]', '[class*="role"]', '[class*="position"]', '[class*="title"]', '.subtitle', 'p'],
    company: ['[class*="company"]', '[class*="org"]', '[class*="affiliation"]', '.company-name'],
    profileUrl: ['a'],
    imageUrl: ['img'],
  },
  company: {
    card: [
      '[class*="company"][class*="card"]',
      '[class*="sponsor"][class*="card"]',
      '[class*="exhibitor"]',
      '.company-card',
      '.sponsor',
      '.partner',
      '[data-company]',
    ],
    name: ['[class*="name"]', 'h3', 'h4', 'h5', '.title', 'img[alt]', 'a'],
    category: ['[class*="category"]', '[class*="tier"]', '[class*="type"]', '.badge', '.tag'],
    website: ['a'],
    logoUrl: ['img'],
  },
};

/**
 * Per-event presets. Add new events here as their DOM is reverse-engineered.
 * Looked up case-insensitively by event name.
 */
export const EVENT_PRESETS = {
  gff: {
    // GFF historically used Swapcard / custom layouts; heuristics handle most of
    // it, but presets can be filled in here once verified against a live page.
  },
};

export function resolveSelectors(eventName, override) {
  const base = JSON.parse(JSON.stringify(DEFAULT_SELECTORS));
  const preset = eventName ? EVENT_PRESETS[String(eventName).toLowerCase().trim()] : null;
  if (preset) deepMerge(base, preset);
  if (override) deepMerge(base, override);
  return base;
}

function deepMerge(target, source) {
  for (const key of Object.keys(source || {})) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      target[key] = target[key] || {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}
