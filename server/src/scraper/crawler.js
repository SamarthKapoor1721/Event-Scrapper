import * as cheerio from 'cheerio';

/**
 * Same-domain link discovery for whole-site crawling.
 *
 * Given a page's HTML, returns the absolute, same-host URLs it links to so the
 * crawler can follow them. Hashes and query-only variations are normalized away
 * to avoid revisiting the same page.
 */

// Pages whose URL hints at speaker/company data — crawled first.
const RELEVANT = /speaker|exhibitor|sponsor|partner|compan|delegate|attendee|agenda|schedule|participant|brand|panel|guest|lineup/i;

// Asset/utility links we never want to enqueue.
const SKIP = /\.(pdf|jpe?g|png|gif|svg|webp|zip|mp4|mp3|css|js|ico|woff2?|ttf)(\?|$)/i;

/** Strip hash, trailing slash, and common tracking params for stable identity. */
export function canonicalize(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const p of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid']) {
      u.searchParams.delete(p);
    }
    let s = u.toString();
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s;
  } catch {
    return url;
  }
}

/** Heuristic priority — higher means crawl sooner. */
export function relevanceScore(url) {
  return RELEVANT.test(url) ? 1 : 0;
}

/**
 * Collect same-domain links from a page.
 * @param {string} html       rendered HTML of the page
 * @param {string} pageUrl    the URL the HTML came from (for resolving relatives)
 * @param {string} rootUrl    the seed URL — defines the host we stay within
 * @returns {string[]} canonical absolute URLs on the same host
 */
export function collectLinks(html, pageUrl, rootUrl) {
  let rootHost;
  try {
    rootHost = new URL(rootUrl).hostname;
  } catch {
    return [];
  }
  const $ = cheerio.load(html);
  const out = new Set();
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href');
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;
    let abs;
    try {
      abs = new URL(href, pageUrl);
    } catch {
      return;
    }
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return;
    if (abs.hostname !== rootHost) return; // same domain only
    if (SKIP.test(abs.pathname)) return;
    out.add(canonicalize(abs.toString()));
  });
  return [...out];
}
