import stringSimilarity from 'string-similarity';
import { clean, normalizeName, normalizeCompany } from '../normalize/normalize.js';
import { getCached, putCached, flushCache } from './cache.js';

/**
 * LinkedIn Profile Discovery.
 *
 * Given a person's Name, Designation and Company, finds the most likely public
 * LinkedIn profile and returns a confidence score + level + status.
 *
 * Pipeline per person:
 *   0. Cache       — return a < 30-day-old cached record if present.
 *   1. Multi-query — 4 progressively looser web searches, stop on high confidence.
 *   2. Candidates  — collect up to 5 unique linkedin.com/in URLs.
 *   3. Validate    — best-effort open the profile page (name/headline/company).
 *   4. Match       — weighted fuzzy score: name 50%, company 30%, designation 20%.
 *   5. Classify    — confidence level (High/Medium/Low) + status.
 *
 * Search provider priority:
 *   1. Brave Search API   (BRAVE_API_KEY — reliable, works from servers)
 *   2. Keyless browser    (Brave/Ecosia/Bing/Startpage via Playwright — free)
 *
 * Result shape:
 *   { linkedin_url, confidence, confidence_level, status,
 *     matched_name, matched_company, matched_title }
 */

// Below this name similarity a candidate is almost certainly a different person.
const MIN_NAME_SIM = 0.5;

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Fuzzy matching
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(['of', 'the', 'and', 'for', 'at', 'to', 'in', 'a', 'an', 'on']);

// Common title acronyms expanded so "Director AI" matches "Director of
// Artificial Intelligence", "VP HR" matches "Vice President, Human Resources".
const ACRONYMS = {
  ai: 'artificial intelligence', ml: 'machine learning', hr: 'human resources',
  ta: 'talent acquisition', vp: 'vice president', svp: 'senior vice president',
  evp: 'executive vice president', avp: 'assistant vice president',
  ceo: 'chief executive officer', cto: 'chief technology officer',
  cfo: 'chief financial officer', coo: 'chief operating officer',
  cmo: 'chief marketing officer', chro: 'chief human resources officer',
  cio: 'chief information officer', cpo: 'chief product officer',
  pr: 'public relations', bd: 'business development', it: 'information technology',
  gm: 'general manager', md: 'managing director', cx: 'customer experience',
  ux: 'user experience', hrbp: 'human resources business partner',
};

function meaningfulTokens(value) {
  return normalizeName(value)
    .split(' ')
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function hasWord(haystack, token) {
  return new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(haystack);
}

function nameScore(want, got) {
  const a = normalizeName(want);
  const b = normalizeName(got);
  if (!a || !b) return 0;
  if (a === b) return 1;
  let s = stringSimilarity.compareTwoStrings(a, b);
  if (b.includes(a) || a.includes(b)) s = Math.max(s, 0.92);
  return s;
}

function companyScore(want, text) {
  const w = normalizeCompany(want);
  const t = normalizeName(text || '');
  if (!w || !t) return 0;
  if (t.includes(w)) return 1;
  const tokens = meaningfulTokens(want);
  const overlap = tokens.length ? tokens.filter((x) => hasWord(t, x)).length / tokens.length : 0;
  return Math.max(overlap, stringSimilarity.compareTwoStrings(w, t.slice(0, 140)));
}

function designationScore(want, text) {
  const tokens = meaningfulTokens(want);
  const t = normalizeName(text || '');
  if (!tokens.length || !t) return 0;
  let matched = 0;
  for (const tok of tokens) {
    const variants = [tok, ...(ACRONYMS[tok] ? ACRONYMS[tok].split(' ') : [])];
    if (variants.some((v) => hasWord(t, v))) matched += 1;
  }
  const overlap = matched / tokens.length;
  return Math.max(overlap, stringSimilarity.compareTwoStrings(normalizeName(want), t.slice(0, 140)));
}

/**
 * Weighted fuzzy match of a candidate against the target person.
 * name 50% · company 30% · designation 20%. Uses validated profile fields when
 * available, otherwise the search result's title/snippet.
 */
function scoreCandidate(person, candidate) {
  const profile = candidate.profile || null;
  const nameText = profile?.name || candidate.name || nameFromTitle(candidate.title);
  const titleText = profile?.headline || candidate.title || '';
  const haystack =
    `${candidate.title || ''} ${candidate.snippet || ''} ` +
    (profile ? `${profile.name} ${profile.headline} ${profile.company} ${profile.location}` : '');

  const nScore = nameScore(person.name, nameText);
  const cScore = companyScore(person.company, profile?.company || haystack);
  const dScore = designationScore(person.designation, titleText || haystack);

  const confidence = 0.5 * nScore + 0.3 * cScore + 0.2 * dScore;

  const matched_company =
    clean(profile?.company) || (cScore >= 0.6 ? clean(person.company) : '');
  return {
    confidence: Math.min(1, confidence),
    nameScore: nScore,
    matched_name: clean(nameText),
    matched_company,
    matched_title: clean(titleText),
  };
}

function levelFor(pct) {
  if (pct >= 90) return 'High';
  if (pct >= 75) return 'Medium';
  return 'Low';
}

// ---------------------------------------------------------------------------
// URL / title helpers
// ---------------------------------------------------------------------------

function cleanProfileUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url, 'https://www.linkedin.com');
    if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return '';
    if (!/^\/in\//i.test(u.pathname)) return '';
    return `https://www.linkedin.com${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

function nameFromTitle(title) {
  if (!title) return '';
  return clean(String(title).split(/[-–|·]/)[0]);
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Navigate, serializing per page. Two overlapping page.goto() calls on one tab
 * throw "Navigation … interrupted by another navigation"; chaining on the page
 * guarantees one navigation at a time regardless of caller concurrency.
 */
async function gotoSafe(page, url, options) {
  const prev = page.__navChain || Promise.resolve();
  let release;
  page.__navChain = new Promise((r) => (release = r));
  try {
    await prev;
  } catch {
    /* previous nav's failure is the caller's problem, not ours */
  }
  try {
    return await page.goto(url, options);
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// Multi-query strategy
// ---------------------------------------------------------------------------

function buildQueries(person) {
  const name = clean(person.name);
  const company = clean(person.company);
  const role = clean(person.designation);
  const q = [];
  if (company) q.push(`site:linkedin.com/in "${name}" "${company}"`);
  if (company) q.push(`"${name}" "${company}" LinkedIn`);
  if (role || company) q.push(`${name} ${role} ${company} LinkedIn`.replace(/\s+/g, ' ').trim());
  q.push(`site:linkedin.com/in ${name}`);
  return [...new Set(q)];
}

// ---------------------------------------------------------------------------
// Search providers
// ---------------------------------------------------------------------------

const SEARCH_ENGINES = [
  { name: 'Brave', url: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}&source=web`, decode: (h) => h },
  { name: 'Ecosia', url: (q) => `https://www.ecosia.org/search?q=${encodeURIComponent(q)}`, decode: decodeBingLike },
  { name: 'Bing', url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`, decode: decodeBingLike },
];

function decodeBingLike(href) {
  try {
    const u = new URL(href, 'https://www.bing.com');
    if (!/\/(ck\/a|url)/.test(u.pathname)) return href;
    const enc = (u.searchParams.get('u') || u.searchParams.get('url') || '').replace(/^a1/, '');
    if (!enc) return href;
    return Buffer.from(enc.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return href;
  }
}

function looksLikeChallenge(html) {
  return (
    /captcha|are you a robot|unusual traffic|verify you are human/i.test(html) &&
    !/linkedin\.com\/in\//i.test(html)
  );
}

async function parseResults(html, decode) {
  const { load } = await import('cheerio');
  const $ = load(html);
  const out = [];
  const seen = new Set();
  $('a[href]').each((_, a) => {
    const $a = $(a);
    const href = decode($a.attr('href') || '');
    if (!/linkedin\.com\/in\//i.test(href)) return;
    const url = cleanProfileUrl(href);
    if (!url || seen.has(url)) return;
    seen.add(url);
    const $card = $a.closest('.snippet, [data-type], li.b_algo, article, .result, .w-gl__result');
    const title = clean($card.find('h2, h3, [class*="title"]').first().text()) || clean($a.text());
    const snippet = clean($card.find('[class*="description"], .b_caption p, .snippet-description, p').first().text());
    out.push({ url, title, snippet, name: nameFromTitle(title) });
  });
  return out;
}

/** Keyless browser search — try free engines until one answers. Retries challenges. */
async function searchKeyless(page, query, logger) {
  for (const engine of SEARCH_ENGINES) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await gotoSafe(page, engine.url(query), { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        const html = await page.content();
        if (looksLikeChallenge(html)) {
          if (attempt === 0) {
            await delay(3000 + Math.floor(Math.random() * 2000));
            continue;
          }
          break; // try next engine
        }
        const found = await parseResults(html, engine.decode);
        if (found.length) return found;
        break;
      } catch (err) {
        // A renderer crash kills the tab — bail out so the caller can recreate it
        // instead of erroring through every remaining engine and query.
        if (/crash|chrome-error|target.*clos|detached|session closed/i.test(err.message)) {
          throw new Error('PAGE_DEAD');
        }
        logger?.warn(`${engine.name} search error: ${err.message.split('\n')[0]}`);
        break;
      }
    }
  }
  return [];
}

// Brave Search API is rate-limited (free tier ~1 req/s); serialize calls.
let braveNextAt = 0;
async function braveGate() {
  const now = Date.now();
  const wait = Math.max(0, braveNextAt - now);
  braveNextAt = Math.max(now, braveNextAt) + 1100;
  if (wait) await delay(wait);
}

async function searchBraveApi(query, logger) {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return [];
  const { default: axios } = await import('axios');
  for (let attempt = 0; attempt < 3; attempt++) {
    await braveGate();
    try {
      const res = await axios.get('https://api.search.brave.com/res/v1/web/search', {
        params: { q: query, count: 10 },
        headers: { Accept: 'application/json', 'X-Subscription-Token': key },
        timeout: 15000,
      });
      return (res.data?.web?.results || [])
        .map((r) => ({ url: cleanProfileUrl(r.url), title: clean(r.title), snippet: clean(r.description), name: nameFromTitle(r.title) }))
        .filter((c) => c.url);
    } catch (err) {
      if (err.response?.status === 429) {
        await delay(1500 * (attempt + 1)); // back off and retry
        continue;
      }
      logger?.warn(`Brave API error: ${err.message}`);
      return [];
    }
  }
  return [];
}

/** Run one query through the active provider (with keyless fallback). */
async function runQuery(query, ctx, logger) {
  if (ctx.mode === 'braveApi') {
    const r = await searchBraveApi(query, logger);
    if (r.length) return r;
    if (ctx.page) return searchKeyless(ctx.page, query, logger); // fallback
    return [];
  }
  return ctx.page ? searchKeyless(ctx.page, query, logger) : [];
}

/** Collect up to 5 unique candidates across the multi-query ladder. */
async function collectCandidates(person, ctx, logger) {
  const pool = new Map();
  for (const query of buildQueries(person)) {
    let found = [];
    try {
      found = await runQuery(query, ctx, logger);
    } catch (err) {
      if (err.message === 'PAGE_DEAD') throw err; // let the worker recreate the tab
      logger?.warn(`Query failed (${query}): ${err.message.split('\n')[0]}`);
    }
    for (const c of found) {
      if (!pool.has(c.url)) pool.set(c.url, c);
    }
    // Stop early once we have a strong match or enough candidates to score — this
    // also avoids hammering the search engines (which trips rate limits).
    const best = [...pool.values()].reduce((m, c) => Math.max(m, scoreCandidate(person, c).confidence), 0);
    if (best >= 0.88 || pool.size >= 3) break;
  }
  return [...pool.values()].slice(0, 5);
}

// ---------------------------------------------------------------------------
// Profile validation (best-effort — LinkedIn gates most views)
// ---------------------------------------------------------------------------

async function validateProfile(page, url, logger) {
  try {
    await gotoSafe(page, url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    const finalUrl = page.url();
    if (/\/(authwall|login|signup|uas\/login)/i.test(finalUrl)) return null;
    const html = await page.content();
    const { load } = await import('cheerio');
    const $ = load(html);

    // Prefer JSON-LD Person data when present.
    let person = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).contents().text());
        const nodes = Array.isArray(data) ? data : data['@graph'] || [data];
        for (const node of nodes) {
          if (node && (node['@type'] === 'Person' || node.jobTitle || node.worksFor)) person = node;
        }
      } catch {
        /* ignore malformed ld+json */
      }
    });

    const ogTitle = $('meta[property="og:title"]').attr('content') || $('title').first().text();
    const ogDesc = $('meta[property="og:description"]').attr('content') || '';
    const name = clean(person?.name) || nameFromTitle(ogTitle);
    // Auth wall / generic pages have no real person name.
    if (!name || /sign ?up|join linkedin|log ?in|^linkedin$/i.test(name)) return null;

    const worksFor = person?.worksFor;
    const company = clean(worksFor?.name) || clean(Array.isArray(worksFor) ? worksFor[0]?.name : '');
    const headline = clean(person?.jobTitle) || clean(ogDesc);
    const location = clean(person?.address?.addressLocality) || '';
    return { name, headline, company, location };
  } catch (err) {
    logger?.warn(`Profile validation failed for ${url}: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-person enrichment
// ---------------------------------------------------------------------------

function notFoundResult() {
  return { linkedin_url: '', confidence: 0, confidence_level: '', status: 'Not Found', matched_name: '', matched_company: '', matched_title: '' };
}

function resultFromCache(rec) {
  return {
    linkedin_url: rec.linkedin_url || '',
    confidence: rec.confidence || 0,
    confidence_level: rec.confidence_level || '',
    status: rec.status || (rec.linkedin_url ? 'Found' : 'Not Found'),
    matched_name: rec.matched_name || '',
    matched_company: rec.matched_company || '',
    matched_title: rec.matched_title || '',
  };
}

async function cacheResult(person, r) {
  await putCached({
    name: person.name,
    company: person.company,
    linkedin_url: r.linkedin_url,
    confidence: r.confidence,
    confidence_level: r.confidence_level,
    status: r.status,
    matched_name: r.matched_name,
    matched_company: r.matched_company,
    matched_title: r.matched_title,
  });
}

async function enrichOne(person, ctx, logger) {
  const cached = await getCached(person.name, person.company);
  if (cached) return resultFromCache(cached);

  let candidates = await collectCandidates(person, ctx, logger);
  if (!candidates.length) {
    const r = notFoundResult();
    await cacheResult(person, r);
    return r;
  }

  // Rank by snippet first to pick which profiles are worth opening.
  candidates.sort((a, b) => scoreCandidate(person, b).confidence - scoreCandidate(person, a).confidence);

  const validationAttempted = Boolean(ctx.validate && ctx.page);
  let anyValidated = false;
  if (validationAttempted) {
    for (const c of candidates.slice(0, 2)) {
      const profile = await validateProfile(ctx.page, c.url, logger);
      if (profile) {
        c.profile = profile;
        anyValidated = true;
      }
    }
  }

  const scored = candidates
    .map((c) => ({ c, s: scoreCandidate(person, c) }))
    .filter((x) => x.s.nameScore >= MIN_NAME_SIM)
    .sort((a, b) => b.s.confidence - a.s.confidence);

  if (!scored.length) {
    const r = notFoundResult();
    await cacheResult(person, r);
    return r;
  }

  const best = scored[0];
  const pct = Math.round(best.s.confidence * 100);
  const secondPct = scored[1] ? Math.round(scored[1].s.confidence * 100) : 0;

  let status;
  if (pct >= 75 && secondPct >= 75 && pct - secondPct < 8) status = 'Multiple Possible Matches';
  else if (pct >= 75) status = 'Found';
  else if (validationAttempted && !anyValidated) status = 'Verification Failed'; // found links, couldn't verify
  else status = 'Not Found';

  const url = status === 'Not Found' ? '' : best.c.url;
  const r = {
    linkedin_url: url,
    confidence: url ? pct : 0,
    confidence_level: url ? levelFor(pct) : '',
    status,
    matched_name: best.s.matched_name,
    matched_company: best.s.matched_company,
    matched_title: best.s.matched_title,
  };
  await cacheResult(person, r);
  return r;
}

// ---------------------------------------------------------------------------
// Browser session / concurrency
// ---------------------------------------------------------------------------

async function launchBrowser(logger) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    logger?.warn('Playwright not installed — cannot search for LinkedIn profiles.');
    return null;
  }
  try {
    return await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
  } catch (err) {
    logger?.warn(`Could not launch browser: ${err.message}`);
    return null;
  }
}

async function createSession(opts) {
  const mode = process.env.BRAVE_API_KEY ? 'braveApi' : 'keyless';
  const total = opts.total || 1;
  // Opening LinkedIn profile pages is slow and usually gated; enable it for
  // small batches (where it adds accuracy) and skip it for large ones unless
  // explicitly requested via opts.validate.
  const validate = opts.validate ?? total <= 25;
  const concurrency = mode === 'braveApi' ? opts.concurrency || 3 : 1;
  const workers = Math.max(1, Math.min(concurrency, total));

  // A browser is needed for keyless search and for profile validation. Reuse a
  // single browser with one page per worker (limits launches).
  let browser = null;
  const pages = [];
  const contexts = [];
  if (mode === 'keyless' || validate) browser = await launchBrowser(opts.logger);
  if (browser) {
    for (let i = 0; i < workers; i++) {
      const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 } });
      contexts.push(context);
      pages.push(await context.newPage());
    }
  }

  // Recreate a worker's page/context after a renderer crash so the rest of the
  // list still gets processed (long runs occasionally crash a tab).
  async function recreate(wi) {
    if (!browser) return null;
    try {
      await contexts[wi]?.close();
    } catch {
      /* ignore */
    }
    const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 } });
    contexts[wi] = context;
    pages[wi] = await context.newPage();
    return pages[wi];
  }
  return { mode, validate, browser, workers, pages, recreate };
}

/**
 * Enrich a list of {name, designation, company} people. Returns result objects
 * aligned by index. Handles cache, concurrency, retries and browser lifecycle.
 */
export async function enrichPeople(people = [], opts = {}) {
  const { logger, progressFrom = 0, progressTo = 100 } = opts;
  const targetIdx = people.map((p, i) => (clean(p?.name) ? i : -1)).filter((i) => i >= 0);
  const total = targetIdx.length;
  const results = people.map(() => notFoundResult());
  if (!total) return results;

  // Resolve cache hits up front so a fully-cached batch never launches a browser.
  const pending = [];
  for (const i of targetIdx) {
    const cached = await getCached(people[i].name, people[i].company);
    if (cached) results[i] = resultFromCache(cached);
    else pending.push(i);
  }
  let done = total - pending.length;
  if (done) logger?.info(`${done} of ${total} resolved from cache.`);
  if (!pending.length) {
    logger?.success('LinkedIn discovery: all resolved from cache.');
    return results;
  }

  logger?.info(`LinkedIn discovery: ${pending.length} profile(s) via ${process.env.BRAVE_API_KEY ? 'Brave Search API' : 'keyless browser search'}.`);
  const session = await createSession({ ...opts, total: pending.length });
  if (session.mode === 'keyless' && !session.browser) {
    logger?.error('LinkedIn search unavailable (no browser) — all Not Found.');
    return results;
  }

  let next = 0;
  async function worker(wi) {
    const ctx = { mode: session.mode, page: session.pages[wi] || null, validate: session.validate };
    while (true) {
      const k = next++;
      if (k >= pending.length) break;
      const i = pending[k];
      const person = people[i];
      // Heal a crashed/closed tab before the next lookup so a single renderer
      // crash near the end of a long list doesn't fail everyone after it.
      if (ctx.page) {
        const alive = await ctx.page.evaluate(() => true).catch(() => false);
        if (!alive) {
          logger?.warn('Search tab was unresponsive — recreating it.');
          ctx.page = await session.recreate(wi);
        }
      }
      let r;
      try {
        r = await enrichOne(person, ctx, logger);
      } catch (err) {
        if (err.message === 'PAGE_DEAD' && session.browser) {
          // Tab crashed mid-lookup — recreate it and retry this person once.
          logger?.warn(`Search tab crashed on ${person.name} — recreating and retrying.`);
          ctx.page = await session.recreate(wi);
          r = await enrichOne(person, ctx, logger).catch(() => ({ ...notFoundResult(), status: 'Verification Failed' }));
        } else {
          logger?.warn(`Enrichment error for ${person.name}: ${err.message.split('\n')[0]}`);
          r = { ...notFoundResult(), status: 'Verification Failed' };
        }
      }
      results[i] = r;
      done += 1;
      logger?.progress(progressFrom + Math.round((done / total) * (progressTo - progressFrom)), `Enriching ${done}/${total}`);
      logger?.info(`  ${person.name} → ${r.linkedin_url || 'not found'} (${r.confidence}%, ${r.status})`);
      // Throttle the keyless path so we don't trip search-engine rate limits.
      if (session.mode !== 'braveApi') await delay(900 + Math.floor(Math.random() * 900));
    }
  }

  try {
    await Promise.all(Array.from({ length: session.workers }, (_, wi) => worker(wi)));
  } finally {
    if (session.browser) await session.browser.close().catch(() => {});
    await flushCache();
  }

  const found = results.filter((r) => r.status === 'Found').length;
  const multi = results.filter((r) => r.status === 'Multiple Possible Matches').length;
  logger?.success(`LinkedIn discovery done: ${found} found, ${multi} ambiguous, ${total - found - multi} unresolved.`);
  return results;
}

// ---------------------------------------------------------------------------
// Public API used by the rest of the app
// ---------------------------------------------------------------------------

/** Map a discovery result onto the speaker-record LinkedIn fields. */
export function toSpeakerFields(r) {
  return {
    linkedinUrl: r.linkedin_url || '',
    linkedinConfidence: (r.confidence || 0) / 100,
    linkedinLevel: r.confidence_level || '',
    linkedinStatus: r.status || 'Not Found',
    linkedinMatchedName: r.matched_name || '',
    linkedinMatchedCompany: r.matched_company || '',
    linkedinMatchedTitle: r.matched_title || '',
  };
}

/** Enrich an array of speaker records (used after scraping). Returns a new array. */
export async function enrichSpeakers(speakers = [], opts = {}) {
  const results = await enrichPeople(
    speakers.map((s) => ({ name: s.name, designation: s.designation, company: s.company })),
    opts
  );
  return speakers.map((s, i) => ({ ...s, ...toSpeakerFields(results[i]) }));
}

/** Field patch for a manually entered/cleared LinkedIn URL (human-confirmed). */
export function manualLinkedIn(url) {
  const u = clean(url);
  return toSpeakerFields(
    u
      ? { linkedin_url: u, confidence: 100, confidence_level: 'High', status: 'Found' }
      : notFoundResult()
  );
}
