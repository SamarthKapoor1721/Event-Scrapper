/**
 * Normalization & cleaning helpers shared by the extractor, comparison engine
 * and exporters. Keep these pure and dependency-free.
 */

/** Collapse whitespace, trim, and coerce non-strings to ''. */
export function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

/** Strip common corporate suffixes used when matching company names. */
const COMPANY_SUFFIXES = [
  'inc', 'incorporated', 'llc', 'l l c', 'ltd', 'limited', 'plc', 'corp',
  'corporation', 'co', 'company', 'gmbh', 'pvt', 'private', 'pte', 'llp',
  'group', 'holdings', 'technologies', 'technology', 'solutions', 'labs',
  'global', 'international', 'india', 'systems', 'sa', 'ag', 'bv', 'nv',
];

/**
 * Normalize a key for matching: lowercase, remove punctuation/diacritics,
 * collapse spaces. Used for both names and companies.
 */
export function normalizeKey(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // diacritics
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Aggressive company normalization: drop legal suffixes so "Google LLC" == "Google". */
export function normalizeCompany(value) {
  let key = normalizeKey(value);
  if (!key) return '';
  let tokens = key.split(' ');
  // Trim trailing legal/descriptor suffixes (but never drop the whole name).
  while (tokens.length > 1 && COMPANY_SUFFIXES.includes(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(' ');
}

// Honorifics/titles stripped before matching so "Mr. John Smith" == "John Smith".
const HONORIFICS = new Set([
  'mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof', 'professor', 'sir', 'madam',
  'shri', 'smt', 'sri', 'kumari', 'hon', 'honble', 'rev', 'capt', 'col', 'gen', 'lt',
]);

/**
 * Normalize a person's name for matching. Strips leading honorifics and middle
 * initials so "Mr. John A. Smith" -> "john smith".
 */
export function normalizeName(value) {
  const key = normalizeKey(value);
  if (!key) return '';
  let tokens = key.split(' ').filter((t) => t.length > 1); // drop single-letter initials
  // Drop leading honorific(s).
  while (tokens.length > 1 && HONORIFICS.has(tokens[0])) tokens.shift();
  return tokens.length ? tokens.join(' ') : key;
}

/**
 * Split a combined "Role, Company" designation into separate parts.
 *
 * Conference sites usually pack both into one string, e.g.
 *   "Founder & CEO, FirstHive"  ->  designation "Founder & CEO", company "FirstHive"
 *   "Chief Executive Officer at Pine Labs" -> "Chief Executive Officer" + "Pine Labs"
 *
 * Only fills `company` when it's currently empty so we never overwrite a value
 * the scraper already found. Returns a new { designation, company } pair.
 */
export function splitDesignationCompany(designation, company = '') {
  const desig = clean(designation);
  const comp = clean(company);
  if (comp || !desig) return { designation: desig, company: comp };

  // A trailing "(Company)" parenthetical is common ("VP, Talent Acquisition
  // (TaskUs)") — pull it out as the company and keep the rest as the role.
  const parenMatch = desig.match(/^(.*?)[\s,]*\(([^()]+)\)\s*$/);
  if (parenMatch && parenMatch[1] && parenMatch[2]) {
    return { designation: clean(parenMatch[1]), company: clean(parenMatch[2]) };
  }

  // Prefer an explicit "… at/@ Company" separator.
  const atMatch = desig.match(/^(.*?)\s+(?:at|@)\s+(.+)$/i);
  if (atMatch && atMatch[1] && atMatch[2]) {
    return { designation: clean(atMatch[1]), company: clean(atMatch[2]) };
  }

  // Otherwise split on the first comma: "Title, Company".
  const comma = desig.indexOf(',');
  if (comma > 0 && comma < desig.length - 1) {
    return { designation: clean(desig.slice(0, comma)), company: clean(desig.slice(comma + 1)) };
  }

  // No separator found — leave company empty.
  return { designation: desig, company: '' };
}

/** Resolve a possibly-relative URL against a base. Returns '' on failure. */
export function absoluteUrl(href, base) {
  const v = clean(href);
  if (!v) return '';
  try {
    return new URL(v, base).toString();
  } catch {
    return v.startsWith('http') ? v : '';
  }
}

/**
 * Deduplicate + merge records by a key function. When two records share a key,
 * non-empty fields from later records fill gaps in the first ("merge duplicates").
 */
export function dedupeMerge(records, keyFn) {
  const map = new Map();
  for (const rec of records) {
    const key = keyFn(rec);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, { ...rec });
    } else {
      const existing = map.get(key);
      for (const [k, v] of Object.entries(rec)) {
        if (!existing[k] && v) existing[k] = v;
      }
    }
  }
  return [...map.values()];
}
