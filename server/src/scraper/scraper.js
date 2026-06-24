import { fetchPage } from './browser.js';
import { extract } from './extractor.js';
import { collectLinks, canonicalize, relevanceScore } from './crawler.js';
import { resolveSelectors } from '../config/selectors.js';
import { aiExtract } from '../ai/aiFallback.js';
import { dedupeMerge, normalizeName, normalizeCompany, clean, splitDesignationCompany } from '../normalize/normalize.js';

const CONFIDENCE_THRESHOLD = 0.5;

/** Add https:// when the user omits the scheme (e.g. "example.com/x"). */
function normalizeUrl(url) {
  const u = clean(url);
  if (!u) return u;
  if (/^https?:\/\//i.test(u)) return u;
  if (/^\/\//.test(u)) return `https:${u}`; // protocol-relative
  return `https://${u}`;
}

function isValidUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Fetch one URL and extract data, optionally augmenting with AI. Returns the
 * extracted records plus the raw html (so a crawler can harvest links).
 */
async function fetchAndExtract(url, { resolved, useAI, timeout, scope } = {}, logger) {
  const { html, engine, finalUrl } = await fetchPage(url, { timeout }, logger);
  let { speakers, companies, confidence } = extract(html, finalUrl || url, resolved, logger, scope);
  logger?.info(`Parsed ${speakers.length} speakers, ${companies.length} companies (confidence ${confidence}).`);

  if (useAI && confidence < CONFIDENCE_THRESHOLD) {
    logger?.warn(`Confidence ${confidence} < ${CONFIDENCE_THRESHOLD} — trying AI fallback.`);
    const ai = await aiExtract(html, logger);
    if (ai) {
      speakers = dedupeMerge([...speakers, ...ai.speakers], (s) => normalizeName(s.name) || clean(s.name).toLowerCase());
      companies = dedupeMerge([...companies, ...ai.companies], (c) => normalizeCompany(c.company) || clean(c.company).toLowerCase());
    }
  }

  return { speakers, companies, confidence, engine, html, finalUrl: finalUrl || url };
}

/**
 * Scrape a single URL with retry. Returns { speakers, companies, confidence, engine }.
 */
async function scrapeOne(url, { eventName, selectors, useAI, retries = 1, timeout, scope } = {}, logger) {
  if (!isValidUrl(url)) throw new Error(`Invalid URL: ${url}`);
  const resolved = resolveSelectors(eventName, selectors);

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) logger?.warn(`Retry ${attempt}/${retries} for ${url}`);
      logger?.progress(15 + attempt * 5, 'Loading page');
      const res = await fetchAndExtract(url, { resolved, useAI, timeout, scope }, logger);
      return { speakers: res.speakers, companies: res.companies, confidence: res.confidence, engine: res.engine };
    } catch (err) {
      lastError = err;
      logger?.error(`Attempt failed: ${err.message}`);
    }
  }
  throw lastError || new Error('Scrape failed.');
}

/**
 * Crawl a whole site starting from a seed URL: breadth-first over same-domain
 * links, fetching and extracting each page, until maxPages or maxDepth is hit.
 * Pages whose URL looks speaker/company-related are visited first.
 */
async function crawlSite(seedUrl, { eventName, selectors, useAI, timeout, scope, maxPages = 25, maxDepth = 2 } = {}, logger) {
  if (!isValidUrl(seedUrl)) throw new Error(`Invalid URL: ${seedUrl}`);
  const resolved = resolveSelectors(eventName, selectors);

  const start = canonicalize(seedUrl);
  const visited = new Set();
  const queued = new Set([start]);
  const queue = [{ url: start, depth: 0 }];
  const allSpeakers = [];
  const allCompanies = [];
  const engines = [];
  let bestConfidence = 0;

  logger?.info(`Crawl mode: up to ${maxPages} page(s), depth ${maxDepth}, staying on ${new URL(seedUrl).hostname}.`);

  while (queue.length && visited.size < maxPages) {
    // Visit the most relevant-looking URL next, shallowest first as a tiebreak.
    queue.sort((a, b) => relevanceScore(b.url) - relevanceScore(a.url) || a.depth - b.depth);
    const { url, depth } = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    logger?.info(`[crawl ${visited.size}/${maxPages}] depth ${depth}: ${url}`);
    logger?.progress(Math.min(85, 10 + Math.round((visited.size / maxPages) * 75)), `Crawling ${visited.size}/${maxPages}`);

    let page;
    try {
      page = await fetchAndExtract(url, { resolved, useAI, timeout, scope }, logger);
    } catch (err) {
      logger?.error(`Skipping ${url}: ${err.message}`);
      continue;
    }
    allSpeakers.push(...page.speakers);
    allCompanies.push(...page.companies);
    engines.push(page.engine);
    bestConfidence = Math.max(bestConfidence, page.confidence);

    if (depth < maxDepth) {
      for (const link of collectLinks(page.html, page.finalUrl, seedUrl)) {
        if (!queued.has(link) && !visited.has(link)) {
          queued.add(link);
          queue.push({ url: link, depth: depth + 1 });
        }
      }
    }
  }

  logger?.success(`Crawl visited ${visited.size} page(s).`);
  return { speakers: allSpeakers, companies: allCompanies, confidence: bestConfidence, engines, pages: visited.size };
}

/**
 * Scrape one or more URLs for a single year, merging results.
 * @param {string|string[]} urls
 */
export async function scrape(
  { year, eventName, urls, url, selectors, scope, useAI = false, retries = 1, timeout = 45000, crawl = false, maxPages = 25, maxDepth = 2 },
  logger
) {
  const list = (Array.isArray(urls) ? urls : [urls || url]).map(normalizeUrl).filter(Boolean);
  if (!list.length) throw new Error('No URL provided.');

  logger?.info(`Starting scrape for ${eventName || 'event'} ${year} — ${list.length} URL(s)${crawl ? ' (whole-site crawl)' : ''}.`);
  let allSpeakers = [];
  let allCompanies = [];
  let bestConfidence = 0;
  const engines = [];

  let succeeded = 0;
  for (let i = 0; i < list.length; i++) {
    const u = list[i];
    logger?.info(`[${i + 1}/${list.length}] ${u}`);
    logger?.progress(Math.round((i / list.length) * 80) + 5, `URL ${i + 1}/${list.length}`);
    try {
      const res = crawl
        ? await crawlSite(u, { eventName, selectors, useAI, timeout, scope, maxPages, maxDepth }, logger)
        : await scrapeOne(u, { eventName, selectors, useAI, retries, timeout, scope }, logger);
      allSpeakers.push(...res.speakers);
      allCompanies.push(...res.companies);
      bestConfidence = Math.max(bestConfidence, res.confidence);
      engines.push(...(res.engines || [res.engine]));
      succeeded += 1;
    } catch (err) {
      // One bad/missing page shouldn't abort the whole job — log and move on.
      logger?.error(`Skipping ${u}: ${err.message}`);
    }
  }
  if (!succeeded) throw new Error('All URLs failed to scrape.');

  logger?.progress(90, 'Merging & deduplicating');
  const speakers = dedupeMerge(allSpeakers, (s) => normalizeName(s.name) || clean(s.name).toLowerCase())
    .map((s) => ({ ...s, ...splitDesignationCompany(s.designation, s.company) }));
  const companies = dedupeMerge(allCompanies, (c) => normalizeCompany(c.company) || clean(c.company).toLowerCase());

  logger?.success(`Done: ${speakers.length} unique speakers, ${companies.length} unique companies.`);
  logger?.progress(100, 'Complete');

  return {
    speakers,
    companies,
    count: { speakers: speakers.length, companies: companies.length },
    confidence: bestConfidence,
    engines: [...new Set(engines)],
    meta: {
      event: eventName || null,
      year: String(year),
      urls: list,
      engines: [...new Set(engines)],
      confidence: bestConfidence,
      scrapedAt: new Date().toISOString(),
    },
  };
}
