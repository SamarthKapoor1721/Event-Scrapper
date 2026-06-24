import stringSimilarity from 'string-similarity';
import { normalizeName, normalizeCompany, clean } from '../normalize/normalize.js';

/**
 * Comparison engine.
 *
 * Matches entities across two years using:
 *   - exact match on the normalized key, then
 *   - optional fuzzy match (Dice coefficient via string-similarity) above a
 *     configurable threshold.
 *
 * Produces the four logical sets the spec requires:
 *   peopleAgain, companiesAgain, peopleMissing, companiesMissing.
 */

const DEFAULT_THRESHOLD = 0.82;

function buildIndex(items, keyFn) {
  const index = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (key && !index.has(key)) index.set(key, item);
  }
  return index;
}

/** Does `key` exist in index, exactly or fuzzily? Returns the matched item or null. */
function findMatch(key, index, { fuzzy, threshold }) {
  if (index.has(key)) return index.get(key);
  if (!fuzzy || !key) return null;
  const keys = [...index.keys()];
  if (!keys.length) return null;
  const { bestMatch } = stringSimilarity.findBestMatch(key, keys);
  if (bestMatch.rating >= threshold) return index.get(bestMatch.target);
  return null;
}

export function comparePeople(people2025, people2026, options = {}) {
  const fuzzy = options.fuzzy ?? true;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const idx2026 = buildIndex(people2026, (p) => normalizeName(p.name));

  const again = [];
  const missing = [];
  for (const person of people2025) {
    const key = normalizeName(person.name);
    if (!key) continue;
    const match = findMatch(key, idx2026, { fuzzy, threshold });
    if (match) {
      again.push({
        name: clean(person.name),
        company: clean(person.company || match.company),
        designation: clean(person.designation || match.designation),
      });
    } else {
      missing.push({
        name: clean(person.name),
        company: clean(person.company),
        designation: clean(person.designation),
      });
    }
  }
  return { again, missing };
}

export function compareCompanies(companies2025, companies2026, options = {}) {
  const fuzzy = options.fuzzy ?? true;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const idx2026 = buildIndex(companies2026, (c) => normalizeCompany(c.company));

  const again = [];
  const missing = [];
  for (const comp of companies2025) {
    const key = normalizeCompany(comp.company);
    if (!key) continue;
    const match = findMatch(key, idx2026, { fuzzy, threshold });
    if (match) again.push({ company: clean(comp.company) });
    else missing.push({ company: clean(comp.company) });
  }
  return { again, missing };
}

/**
 * Full comparison between an earlier year (base) and later year (target).
 * Returns the four sheets' data plus summary counts.
 */
export function compareYears(base, target, options = {}) {
  const people = comparePeople(base.speakers || [], target.speakers || [], options);
  const companies = compareCompanies(base.companies || [], target.companies || [], options);
  const baseYear = base.meta?.year || options.baseYear || null;
  const targetYear = target.meta?.year || options.targetYear || null;
  return {
    peopleAgain: people.again,
    peopleMissing: people.missing,
    companiesAgain: companies.again,
    companiesMissing: companies.missing,
    // Full per-year company lists (with category/tier) for separate sheets.
    baseYear,
    targetYear,
    baseCompanies: (base.companies || []).map((c) => ({
      company: clean(c.company), category: clean(c.category), website: clean(c.website),
    })),
    targetCompanies: (target.companies || []).map((c) => ({
      company: clean(c.company), category: clean(c.category), website: clean(c.website),
    })),
    summary: {
      baseYear,
      targetYear,
      peopleAgain: people.again.length,
      peopleMissing: people.missing.length,
      companiesAgain: companies.again.length,
      companiesMissing: companies.missing.length,
      threshold: options.threshold ?? DEFAULT_THRESHOLD,
      fuzzy: options.fuzzy ?? true,
    },
  };
}
