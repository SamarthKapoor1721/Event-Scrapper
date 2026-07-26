import path from 'node:path';
import os from 'node:os';
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
  clo: 'chief learning officer', 'l&d': 'learning and development',
  ld: 'learning and development', od: 'organizational development',
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
  const dScore = designationScore(person.designation, titleText || haystack);
  const hasCompany = Boolean(normalizeCompany(person.company));
  const cScore = hasCompany ? companyScore(person.company, profile?.company || haystack) : 0;

  // Weighting: name 50% · company 30% · designation 20%.
  // Two adjustments so correct matches aren't buried:
  //   • No company provided → drop the company term and reweight name/designation
  //     (we can't corroborate it, so it shouldn't cap the score at 70%).
  //   • Company provided but not visible in the result → floor it, since LinkedIn
  //     snippets routinely omit the employer (absence ≠ wrong company).
  let confidence;
  if (!hasCompany) {
    confidence = 0.7 * nScore + 0.3 * dScore;
  } else {
    confidence = 0.5 * nScore + 0.3 * Math.max(cScore, 0.35) + 0.2 * dScore;
  }

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
  } catch (err) {
    // A timed-out/failed goto leaves the tab still loading that URL, which then
    // "interrupts" the next navigation. Park it on about:blank (inside the lock)
    // so the next search starts from a clean state.
    await page.goto('about:blank', { timeout: 5000 }).catch(() => {});
    throw err;
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
    const $card = $a.closest('.snippet, [data-type], li.b_algo, article, .result, .w-gl__result, div.g, div.tF2Cxc, div.MjjYud');
    // Keep only real organic results (drops "people also viewed"/sidebar links).
    // An organic hit either sits in a known result container OR wraps a heading —
    // checking both means a class-name change upstream can't silently drop
    // everything.
    const isOrganic = $card.length > 0 || $a.find('h3, h2').length > 0;
    if (!isOrganic) return;
    const title = clean($card.find('h3, h2, [class*="title"]').first().text()) || clean($a.text());
    const snippet = clean($card.find('[class*="description"], .b_caption p, .VwiC3b, .snippet-description, p').first().text());
    out.push({ url, title, snippet, name: nameFromTitle(title) });
  });
  return out;
}

/** Keyless browser search — try free engines until one answers. Retries challenges.
 *  Sets `ctx.blocked = true` when it sees challenge/connection errors (vs. a genuine
 *  empty result) so the caller can back off when the engines start rate-limiting. */
async function searchKeyless(page, query, logger, ctx) {
  for (const engine of SEARCH_ENGINES) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await gotoSafe(page, engine.url(query), { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        const html = await page.content();
        if (looksLikeChallenge(html)) {
          if (ctx) ctx.blocked = true;
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
        // Connection refused/closed/reset = the engine is throttling this IP.
        if (/ERR_CONNECTION|ERR_NETWORK|ERR_TIMED_OUT|timeout/i.test(err.message) && ctx) ctx.blocked = true;
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

async function searchBraveApi(query, logger, { count = 10, offset = 0 } = {}) {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return [];
  const { default: axios } = await import('axios');
  for (let attempt = 0; attempt < 3; attempt++) {
    await braveGate();
    try {
      const res = await axios.get('https://api.search.brave.com/res/v1/web/search', {
        params: { q: query, count, offset },
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

/** Google Programmable Search (Custom Search JSON API) — official, no CAPTCHA.
 *  Free tier: 100 queries/day, no credit card. Needs GOOGLE_CSE_KEY + GOOGLE_CSE_CX. */
async function searchGoogleCse(query, logger, { start = 1 } = {}) {
  const key = process.env.GOOGLE_CSE_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!key || !cx) return [];
  const { default: axios } = await import('axios');
  try {
    const res = await axios.get('https://www.googleapis.com/customsearch/v1', {
      params: { key, cx, q: query, num: 10, start },
      timeout: 15000,
    });
    return (res.data?.items || [])
      .map((it) => ({ url: cleanProfileUrl(it.link), title: clean(it.title), snippet: clean(it.snippet), name: nameFromTitle(it.title) }))
      .filter((c) => c.url);
  } catch (err) {
    if (err.response?.status === 429) logger?.warn('Google Custom Search daily quota (100/day) reached.');
    else logger?.warn(`Google Custom Search error: ${err.response?.data?.error?.message || err.message}`);
    return [];
  }
}

/** Run one query through the active provider (with keyless fallback). */
async function runQuery(query, ctx, logger) {
  if (ctx.mode === 'braveApi') {
    const r = await searchBraveApi(query, logger);
    if (r.length) return r;
    if (ctx.page) return searchKeyless(ctx.page, query, logger, ctx); // fallback
    return [];
  }
  return ctx.page ? searchKeyless(ctx.page, query, logger, ctx) : [];
}

/** Collect up to 5 unique candidates across the multi-query ladder. */
async function collectCandidates(person, ctx, logger) {
  ctx.blocked = false; // reset per-person; set if the engines throttle us
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
  // Only cache resolved profiles. "Not Found" is often a transient failure
  // (rate-limit, tab crash), so leaving it uncached lets the next run retry it.
  if (!r.linkedin_url) return;
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

const HEADFUL = /^(1|true|yes|on)$/i.test(process.env.HEADFUL || '');

/**
 * Open a browser context for searching. With HEADFUL=1 it opens a VISIBLE window
 * backed by a persistent profile — so you can solve a CAPTCHA by hand once and it
 * stays solved across searches and restarts. Otherwise a normal headless context.
 */
async function openSearchContext(logger) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    logger?.warn('Playwright not installed — cannot search.');
    return null;
  }
  const args = ['--no-sandbox', '--disable-blink-features=AutomationControlled'];
  const consent = [{ name: 'CONSENT', value: 'YES+cb', domain: '.google.com', path: '/' }];
  try {
    if (HEADFUL) {
      const dir = path.join(os.tmpdir(), 'event-scraper-profile');
      const context = await chromium.launchPersistentContext(dir, { headless: false, args, viewport: { width: 1280, height: 900 }, userAgent: UA });
      await context.addCookies(consent).catch(() => {});
      logger?.info('Visible browser (HEADFUL) — solve any CAPTCHA in the window; it will be remembered.');
      return { context, headful: true, close: async () => { await context.close().catch(() => {}); } };
    }
    const browser = await chromium.launch({ headless: true, args });
    const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 } });
    await context.addCookies(consent).catch(() => {});
    return { context, headful: false, close: async () => { await browser.close().catch(() => {}); } };
  } catch (err) {
    logger?.warn(`Browser launch failed: ${err.message}`);
    return null;
  }
}

/** In headful mode, wait for the user to solve a shown CAPTCHA (up to ~2 min). */
async function waitForManualSolve(page, logger) {
  logger?.warn('⚠ CAPTCHA shown — please solve it in the browser window (waiting up to 2 min)…');
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2500);
    const html = await page.content().catch(() => '');
    if (!looksLikeChallenge(html) && !/\/sorry\/index/i.test(page.url())) {
      logger?.success('CAPTCHA cleared — continuing.');
      return true;
    }
  }
  logger?.warn('CAPTCHA not solved in time — continuing.');
  return false;
}

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
  let blockStreak = 0; // consecutive lookups where the engines throttled us
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

      // Adaptive cooldown: when the free engines start throttling this IP
      // (ctx.blocked set on challenge/connection errors), pause to let the limit
      // reset and start a fresh browser session, instead of failing everyone left.
      if (session.mode !== 'braveApi') {
        if (ctx.blocked && !r.linkedin_url) blockStreak += 1;
        else if (r.linkedin_url) blockStreak = 0;
        if (blockStreak >= 4) {
          logger?.warn('Search engines are rate-limiting — pausing 45s to recover…');
          await delay(45000);
          if (session.browser) ctx.page = await session.recreate(wi);
          blockStreak = 0;
        }
        await delay(1200 + Math.floor(Math.random() * 1300));
      }
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

// ---------------------------------------------------------------------------
// X-ray search: query → list of LinkedIn profiles (name + designation + url)
// ---------------------------------------------------------------------------

/** Decode Google's `/url?q=<real>` result links. */
function decodeGoogle(href) {
  try {
    const u = new URL(href, 'https://www.google.com');
    if (u.pathname === '/url') return u.searchParams.get('q') || u.searchParams.get('url') || href;
    return href;
  } catch {
    return href;
  }
}

// Paginated engine URLs for collecting many results from one query. Google is
// first because it's the only engine that does `site:linkedin.com/in` X-ray
// searches well — it can challenge a heavy/datacenter IP, but usually works
// fine for normal (residential) use, so the others remain as fallbacks.
const PAGED_ENGINES = [
  { name: 'Google', url: (q, p) => `https://www.google.com/search?q=${encodeURIComponent(q)}&num=20&start=${p * 10}&hl=en`, decode: decodeGoogle },
  { name: 'Brave', url: (q, p) => `https://search.brave.com/search?q=${encodeURIComponent(q)}&offset=${p}`, decode: (h) => h },
  { name: 'Bing', url: (q, p) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&first=${p * 10 + 1}`, decode: decodeBingLike },
  { name: 'Ecosia', url: (q, p) => `https://www.ecosia.org/search?q=${encodeURIComponent(q)}&p=${p}`, decode: decodeBingLike },
];

/** Parse a LinkedIn result title into { name, designation, company }. */
export function parseProfileTitle(title) {
  // "Name - Designation - Company | LinkedIn" / "Name - Designation at Company"
  let t = clean(title).replace(/\s*[|–-]\s*LinkedIn.*$/i, '');
  const parts = t.split(/\s+[-–|]\s+/).map((s) => clean(s)).filter(Boolean);
  let name = parts[0] || '';
  // Google/Bing sometimes inject UI labels as the leading segment.
  if (/^(web results|results|more results|see more|people also|view\b|profiles)/i.test(name) || /linkedin/i.test(name)) {
    name = '';
  }
  let designation = parts[1] || '';
  let company = parts[2] || '';
  if (!company && / at /i.test(designation)) {
    const m = designation.match(/^(.*?)\s+at\s+(.+)$/i);
    if (m) {
      designation = clean(m[1]);
      company = clean(m[2]);
    }
  }
  return { name, designation, company };
}

// Two-way role aliases (CTO ↔ chief technology officer) for query expansion.
const ROLE_ALIASES = (() => {
  const m = {};
  for (const [k, v] of Object.entries(ACRONYMS)) {
    m[k] = v;
    m[v] = k;
  }
  return m;
})();

/**
 * Build a LinkedIn X-ray query from structured filters.
 *   buildXrayQuery({ location:'Gurgaon', designations:['CTO','Talent Acquisition Head'], keywords:['summit'] })
 *   -> site:linkedin.com/in ("CTO" OR "chief technology officer" OR "Talent Acquisition Head") "Gurgaon" ("summit")
 */
// Generate phrasing variants for a role so we match real-world headlines, e.g.
// "Talent Acquisition Head" also matches "Head of Talent Acquisition" /
// "Talent Acquisition Leader", and "CTO" matches "Chief Technology Officer".
const SENIORITY = 'Head|Lead|Director|Manager|Officer|Leader|VP|President';
export function roleVariants(role) {
  const t = clean(role);
  if (!t) return [];
  const out = new Set([`"${t}"`]);
  const alias = ROLE_ALIASES[t.toLowerCase()];
  if (alias) out.add(`"${alias}"`);
  const m1 = t.match(new RegExp(`^(.*?)\\s+(${SENIORITY})$`, 'i')); // "X Head" → "Head of X", "Head X"
  if (m1) {
    out.add(`"${m1[2]} of ${m1[1]}"`);
    out.add(`"${m1[2]} ${m1[1]}"`);
  }
  const m2 = t.match(new RegExp(`^(${SENIORITY})\\s+of\\s+(.+)$`, 'i')); // "Head of X" → "X Head"
  if (m2) out.add(`"${m2[2]} ${m2[1]}"`);
  const m3 = t.match(new RegExp(`^(${SENIORITY})\\s+(?!of\\b)(.+)$`, 'i')); // "Director X" → "Director of X", "X Director"
  if (m3) {
    out.add(`"${m3[1]} of ${m3[2]}"`);
    out.add(`"${m3[2]} ${m3[1]}"`);
  }

  // Expand domain abbreviations both ways (L&D ↔ Learning & Development) so we
  // match however the headline is written.
  for (const v of [...out]) {
    if (/l&d/i.test(v)) out.add(v.replace(/l&d/gi, 'Learning & Development'));
    if (/learning\s*&\s*development/i.test(v)) out.add(v.replace(/learning\s*&\s*development/gi, 'Learning and Development'));
    if (/learning and development/i.test(v)) out.add(v.replace(/learning and development/gi, 'L&D'));
    if (/\bta\b/i.test(v)) out.add(v.replace(/\bTA\b/gi, 'Talent Acquisition'));
  }
  return [...out];
}

// Industry → search synonyms so "Healthcare" also matches hospital/pharma/etc.
const INDUSTRY_SYNONYMS = {
  healthcare: ['healthcare', 'hospital', 'pharma', 'pharmaceutical', 'medical', 'life sciences', 'biotech'],
  'real estate': ['real estate', 'realty', 'property', 'proptech'],
  fintech: ['fintech', 'financial services', 'banking', 'payments', 'lending', 'bfsi'],
  insurance: ['insurance', 'insurtech'],
  'it services': ['it services', 'information technology', 'software services', 'it consulting'],
  saas: ['saas', 'software', 'b2b software', 'cloud'],
  manufacturing: ['manufacturing', 'industrial', 'production'],
  ecommerce: ['ecommerce', 'e-commerce', 'retail', 'd2c'],
  edtech: ['edtech', 'education', 'e-learning'],
  logistics: ['logistics', 'supply chain', 'freight', 'transportation'],
  automotive: ['automotive', 'automobile', 'ev', 'mobility'],
  telecom: ['telecom', 'telecommunications'],
  energy: ['energy', 'power', 'renewable', 'oil and gas', 'solar'],
  hospitality: ['hospitality', 'hotels', 'travel', 'tourism'],
  media: ['media', 'advertising', 'entertainment'],
  consulting: ['consulting', 'advisory', 'professional services'],
  cybersecurity: ['cybersecurity', 'security', 'infosec'],
  ai: ['artificial intelligence', 'machine learning', 'data science'],
  fmcg: ['fmcg', 'consumer goods', 'cpg'],
};

function industryVariants(ind) {
  const t = clean(ind);
  if (!t) return [];
  const syns = INDUSTRY_SYNONYMS[t.toLowerCase()] || [t];
  return syns.map((s) => `"${s}"`);
}

export function buildXrayQuery({ location, locations = [], designations = [], exactRole, industries = [], keywords = [] } = {}) {
  // `exactRole` (already quoted) uses that single phrase verbatim instead of
  // expanding the designations — used by deep search to give each phrasing its
  // own query (each query gets its own ~10-result cap from the engine).
  const roles = exactRole ? [exactRole] : [];
  if (!exactRole) for (const d of designations) roles.push(...roleVariants(d));
  const parts = ['site:linkedin.com/in'];
  if (roles.length) parts.push(`(${[...new Set(roles)].join(' OR ')})`);

  // One or more cities — OR them together so any match counts.
  const locs = [...new Set([location, ...locations].map((l) => clean(l)).filter(Boolean))];
  if (locs.length === 1) parts.push(`"${locs[0]}"`);
  else if (locs.length > 1) parts.push(`(${locs.map((l) => `"${l}"`).join(' OR ')})`);

  // Industry clause (expanded to synonyms).
  const inds = [...new Set((industries || []).flatMap(industryVariants))];
  if (inds.length) parts.push(`(${inds.join(' OR ')})`);

  const kw = (keywords || []).map((k) => clean(k)).filter(Boolean);
  if (kw.length) parts.push(`(${kw.map((k) => `"${k}"`).join(' OR ')})`);
  return parts.join(' ');
}

// Seniority tiers (checked in order) with a heuristic decision-maker score.
const SENIORITY_RULES = [
  [/\b(chief|cxo|c[a-z]o|ceo|cto|cio|cmo|cfo|coo|chro|cpo|cdo|cgo|ciso)\b/i, 'C-Level', 95],
  [/\b(founder|co-?founder|owner|proprietor|managing director|\bmd\b|partner)\b/i, 'Founder/MD', 92],
  [/\b(president|vice president|svp|evp|avp|\bvp\b)\b/i, 'VP', 82],
  [/\b(director|head|country head|business head|unit head|general manager|\bgm\b)\b/i, 'Director/Head', 70],
  [/\b(manager|lead|principal|senior|specialist)\b/i, 'Manager/Lead', 48],
];

const DEPT_RULES = [
  [/market|brand|growth|demand|advertis|communicat|\bpr\b/i, 'Marketing'],
  [/tech|engineer|\bit\b|software|\bdata\b|\bai\b|\bml\b|cloud|security|cyber|information|developer/i, 'Technology'],
  [/talent|recruit|\bhr\b|human resource|people|hiring/i, 'HR'],
  [/sales|revenue|business development|\bbd\b|account exec/i, 'Sales'],
  [/product/i, 'Product'],
  [/financ|\bcfo\b|treasur|account/i, 'Finance'],
  [/operation|\bcoo\b|supply|logistic/i, 'Operations'],
  [/customer|\bcx\b|success|experience/i, 'Customer'],
  [/strateg|innovation|transformation|digital/i, 'Strategy/Digital'],
];

// Titles that are NOT decision-makers (job-seekers, students, ex-roles).
const JUNK_LEAD_RE = /\b(intern|internship|student|trainee|fresher|apprentice|aspiring|seeking|looking for|job ?seeker|unemployed|ex-|former|retired|freelanc)\b/i;

/** Derive seniority, department and a heuristic decision-maker score from a title. */
export function classifyLead(person) {
  const title = clean(person.designation);
  let seniority = 'Individual';
  let score = title ? 30 : 20;
  for (const [re, level, s] of SENIORITY_RULES) {
    if (re.test(title)) { seniority = level; score = s; break; }
  }
  let department = 'General';
  for (const [re, d] of DEPT_RULES) {
    if (re.test(title)) { department = d; break; }
  }
  return {
    seniority,
    department,
    decisionScore: score,
    junk: JUNK_LEAD_RE.test(title) || JUNK_LEAD_RE.test(clean(person.name)),
  };
}

// Seniority words that are too generic to verify a role on their own.
const GENERIC_ROLE_TOKENS = new Set(['head', 'vp', 'director', 'manager', 'lead', 'leader', 'officer', 'president', 'chief', 'senior', 'global', 'avp', 'svp', 'evp']);

function normText(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Does this profile text actually match one of the searched roles?
 * Checks every role phrasing as a token-set (order-independent), ignoring
 * filler words. Variants made only of generic seniority words (e.g. just
 * "Head") are skipped — they'd match anyone. Returns true when nothing
 * verifiable was requested, so we never drop everything.
 */
export function roleMatches(text, roles = []) {
  if (!roles.length) return true;
  const hay = new Set(normText(text).split(' ').filter(Boolean));
  if (!hay.size) return false;
  let checked = 0;
  for (const role of roles) {
    for (const variant of roleVariants(role)) {
      const tokens = normText(variant.replace(/"/g, ''))
        .split(' ')
        .filter((t) => t.length > 1 && !['of', 'and', 'the', 'for'].includes(t));
      if (!tokens.length || tokens.every((t) => GENERIC_ROLE_TOKENS.has(t))) continue; // too generic to verify
      checked += 1;
      if (tokens.every((t) => hay.has(t))) return true;
    }
  }
  return checked === 0; // nothing specific enough to check → don't filter it out
}

/** If the input is a Google/Bing search URL, pull out the actual query (q=…). */
export function extractQuery(input) {
  const s = clean(input);
  if (!/^https?:\/\//i.test(s)) return s;
  try {
    const u = new URL(s);
    return clean(u.searchParams.get('q') || u.searchParams.get('query') || s);
  } catch {
    return s;
  }
}

/**
 * Run an X-ray search query and collect the LinkedIn profiles in the results.
 * Returns [{ name, designation, company, url, snippet }] deduped by URL.
 */
export async function searchProfiles(rawQueries, opts = {}) {
  const { logger, pages = 3, stats } = opts;
  // Each query may be a plain string, or { query, tag } to label results with the
  // company they came from (used by the per-company POC search).
  const items = (Array.isArray(rawQueries) ? rawQueries : [rawQueries])
    .map((q) => (typeof q === 'string' ? { query: extractQuery(q), tag: '' } : { query: extractQuery(q.query), tag: q.tag || '' }))
    .filter((x) => x.query);
  if (!items.length) return [];
  const queries = items.map((i) => i.query);
  const seen = new Map();
  const cse = process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_CX;
  const provider = process.env.BRAVE_API_KEY ? 'Brave Search API' : cse ? 'Google Custom Search' : 'keyless browser search';
  logger?.info(`Profile search: ${queries.length} query(ies) via ${provider}.`);

  if (process.env.BRAVE_API_KEY) {
    for (const { query, tag } of items) {
      for (let off = 0; off < pages; off++) {
        const found = await searchBraveApi(query, logger, { count: 20, offset: off });
        if (!found.length) break;
        for (const c of found) if (c.url && !seen.has(c.url)) seen.set(c.url, { ...c, source: 'Brave API', tag });
      }
    }
  } else if (cse) {
    for (const { query, tag } of items) {
      for (let off = 0; off < pages; off++) {
        const found = await searchGoogleCse(query, logger, { start: off * 10 + 1 });
        if (!found.length) break;
        for (const c of found) if (c.url && !seen.has(c.url)) seen.set(c.url, { ...c, source: 'Google CSE', tag });
      }
    }
  } else {
    const session = await openSearchContext(logger);
    if (!session) throw new Error('Search browser unavailable (Playwright not installed).');
    const { context, headful, close } = session;
    const page = await context.newPage();
    try {
      // For a single query, hit every engine and merge (maximize one search).
      // For many queries (per city×role), use the first engine that answers each
      // — the breadth comes from the queries, so we keep per-query load light.
      const allEngines = queries.length === 1;
      let blockedStreak = 0;
      for (const { query, tag } of items) {
        const sizeBefore = seen.size;
        for (const engine of PAGED_ENGINES) {
          let gotAny = false;
          for (let p = 0; p < pages; p++) {
            // One bad page must never crash the whole search — catch everything
            // (navigation, parse) and just move on to the next engine/query.
            try {
              await gotoSafe(page, engine.url(query, p), { waitUntil: 'domcontentloaded', timeout: 25000 });
              await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
              let html = await page.content();
              // Detect an engine block/CAPTCHA (e.g. Google's tiny "sorry" page).
              const blocked = looksLikeChallenge(html) || (engine.name === 'Google' && html.length < 15000 && !/linkedin\.com\/in\//i.test(html));
              if (blocked) {
                // In visible mode, pause for the user to solve it once, then reload.
                if (headful && await waitForManualSolve(page, logger)) {
                  html = await page.content();
                } else {
                  if (stats) stats.blocked = true;
                  logger?.warn(`${engine.name} is rate-limiting/CAPTCHA — skipping.`);
                  break;
                }
              }
              const found = await parseResults(html, engine.decode);
              const before = seen.size;
              for (const c of found) if (!seen.has(c.url)) seen.set(c.url, { ...c, source: engine.name, tag });
              const added = seen.size - before;
              if (found.length) gotAny = true;
              else if (p === 0) break; // engine empty for this query → next engine
              // `site:` searches are truncated, so once a deeper page stops adding
              // new profiles, stop paging (and avoid extra CAPTCHA risk).
              if (p > 0 && added === 0) break;
            } catch (err) {
              logger?.warn(`${engine.name} page ${p + 1}: ${err.message.split('\n')[0]}`);
              break;
            }
            await delay(900 + Math.floor(Math.random() * 700));
          }
          if (gotAny && !allEngines) break; // one engine is enough in multi-query mode
        }
        // Circuit breaker: if every engine is blocked for several queries in a
        // row, stop rather than grinding through the rest for nothing.
        blockedStreak = seen.size === sizeBefore ? blockedStreak + 1 : 0;
        if (blockedStreak >= 5) {
          if (stats) stats.blocked = true;
          logger?.warn('All search engines are blocking — stopping early and returning what was found.');
          break;
        }
        if (queries.length > 1) logger?.info(`  ${seen.size} profile(s) collected so far…`);
      }
    } finally {
      await close();
    }
  }

  const out = [...seen.values()].map((c) => {
    const parsed = parseProfileTitle(c.title);
    // If we searched for a specific company, trust that over the parsed company.
    return { ...parsed, company: c.tag || parsed.company, url: c.url, snippet: c.snippet, source: c.source || 'Search' };
  });
  logger?.success(`Profile search found ${out.length} LinkedIn profile(s).`);
  return out;
}

// ---------------------------------------------------------------------------
// Post / event mining: from company + event + location searches, collect the
// LinkedIn profiles that appear AND candidate names mentioned in the snippets.
// ---------------------------------------------------------------------------

// The search engines' own hosts — never a real result destination.
const ENGINE_HOST_RE = /(^|\.)(google|bing|ecosia|brave|duckduckgo|startpage|yahoo|msn)\.[a-z.]+$/i;

/** Resolve a result anchor to its real external URL (decoding engine redirects). */
function resolveExternalUrl(href, decode) {
  let u = decode(href || '');
  try {
    const url = new URL(u, 'https://x.invalid');
    // Still on the engine's own host? Pull the destination out of a redirect param.
    if (ENGINE_HOST_RE.test(url.hostname)) {
      const enc = url.searchParams.get('url') || url.searchParams.get('u') || url.searchParams.get('q') || url.searchParams.get('uddg') || '';
      if (enc) {
        const dec = enc.startsWith('a1')
          ? Buffer.from(enc.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
          : decodeURIComponent(enc);
        if (/^https?:\/\//i.test(dec)) u = dec;
      }
    }
  } catch {
    /* ignore */
  }
  return u;
}

/** Parse ALL organic result cards (not just linkedin/in) → {url, title, snippet}. */
async function parseCards(html, decode) {
  const { load } = await import('cheerio');
  const $ = load(html);
  const cards = [];
  const seen = new Set();
  $('div.g, div.tF2Cxc, div.MjjYud, li.b_algo, .snippet, .result, .w-gl__result, article').each((_, el) => {
    const $c = $(el);
    // Pick the first anchor that resolves to an EXTERNAL result (not the engine's
    // own domain) — otherwise we'd store ecosia.org/bing.com internal links.
    let url = '';
    $c.find('a[href]').each((_, a) => {
      if (url) return;
      const resolved = resolveExternalUrl($(a).attr('href') || '', decode);
      try {
        const h = new URL(resolved, 'https://x.invalid');
        if (/^https?:$/.test(h.protocol) && h.hostname !== 'x.invalid' && !ENGINE_HOST_RE.test(h.hostname)) url = resolved;
      } catch {
        /* skip */
      }
    });
    const title = clean($c.find('h3, h2, [class*="title"]').first().text());
    const snippet = clean($c.find('.VwiC3b, .b_caption p, .snippet-description, [class*="description"], p').first().text());
    const key = `${title}|${snippet}`.slice(0, 200);
    if (url && (title || snippet) && !seen.has(key)) {
      seen.add(key);
      cards.push({ url, title, snippet });
    }
  });
  return cards;
}

// A result looks like an event/speaker page (vs. a random article).
const EVENT_URL_RE = /summit|conference|roundtable|forum|conclave|expo|10times|event|awards|symposium|meetup|webinar|agenda|speaker|panel|festival/i;
const EVENT_SKIP_RE = /\/jobs?\b|indeed|naukri|glassdoor|wikipedia|youtube\.com\/watch|amazon\.|flipkart/i;

/**
 * Find events (summits/roundtables/conferences) and the leads on them.
 * Returns:
 *   events   — event/speaker pages found ({ title, url, snippet }) — scrape these
 *              with the Scraper to pull full speaker lists.
 *   profiles — linkedin.com/in profiles that appeared in the results (direct leads)
 */
export async function findEvents(queries, opts = {}) {
  const { logger, pages = 2, stats } = opts;
  const qs = (Array.isArray(queries) ? queries : [queries]).map(extractQuery).filter(Boolean);
  if (!qs.length) return { events: [], profiles: [] };

  const eventMap = new Map();
  const profileMap = new Map();
  const browser = await launchBrowser(logger);
  if (!browser) throw new Error('Search browser unavailable (Playwright not installed).');
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: 'CONSENT', value: 'YES+cb', domain: '.google.com', path: '/' }]).catch(() => {});
  const page = await context.newPage();
  try {
    for (const query of qs) {
      for (const engine of PAGED_ENGINES) {
        let gotAny = false;
        for (let p = 0; p < pages; p++) {
          try {
            await gotoSafe(page, engine.url(query, p), { waitUntil: 'domcontentloaded', timeout: 25000 });
            await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
            const html = await page.content();
            if (looksLikeChallenge(html) || (engine.name === 'Google' && html.length < 15000 && !/http/i.test(html))) {
              if (stats) stats.blocked = true;
              break;
            }
            const cards = await parseCards(html, engine.decode);
            if (!cards.length && p === 0) break;
            let added = 0;
            for (const card of cards) {
              const profileUrl = cleanProfileUrl(card.url);
              if (profileUrl) {
                if (!profileMap.has(profileUrl)) {
                  const { name, designation, company } = parseProfileTitle(card.title);
                  if (name) { profileMap.set(profileUrl, { name, designation, company, url: profileUrl }); added++; }
                }
              } else if (card.url && /^https?:/i.test(card.url) && EVENT_URL_RE.test(`${card.url} ${card.title}`) && !EVENT_SKIP_RE.test(card.url)) {
                const key = card.url.split(/[?#]/)[0];
                if (!eventMap.has(key)) { eventMap.set(key, { title: card.title, url: card.url, snippet: card.snippet }); added++; }
              }
            }
            if (added) gotAny = true;
            else if (p > 0) break;
            await delay(900 + Math.floor(Math.random() * 700));
          } catch (err) {
            logger?.warn(`${engine.name} p${p + 1}: ${err.message.split('\n')[0]}`);
            break;
          }
        }
        if (gotAny) break; // one engine per query
      }
      logger?.info(`  ${eventMap.size} event(s), ${profileMap.size} profile(s) so far…`);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  logger?.success(`Event search: ${eventMap.size} events, ${profileMap.size} profiles.`);
  return { events: [...eventMap.values()], profiles: [...profileMap.values()] };
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
