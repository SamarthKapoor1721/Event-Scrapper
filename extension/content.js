/**
 * Scrapes LinkedIn profiles from the page the user is currently viewing.
 *
 * Runs in the user's own logged-in session, so there is no CAPTCHA and no
 * headless browser — the trade-off is that LinkedIn's markup is obfuscated and
 * changes often, so every selector below has fallbacks and we prefer structure
 * (links to /in/, list items) over hashed class names.
 */

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Strip tracking params and trailing segments so the same person dedupes. */
function cleanProfileUrl(href) {
  try {
    const u = new URL(href, location.origin);
    const m = u.pathname.match(/\/in\/([^/]+)/);
    if (!m) return '';
    return `https://www.linkedin.com/in/${m[1]}`;
  } catch {
    return '';
  }
}

/**
 * LinkedIn renders the same visible name twice (once visually, once for screen
 * readers). Prefer the aria-hidden copy and fall back to the visually-hidden one.
 */
function visibleText(root, selector) {
  if (!root) return '';
  const el = root.querySelector(selector);
  if (!el) return '';
  const hidden = el.querySelector('[aria-hidden="true"]');
  return clean((hidden || el).textContent);
}

/** People-search results page: one row per person. */
function scrapeSearchResults() {
  const out = [];
  // Each result is the closest list item wrapping a /in/ link.
  const anchors = document.querySelectorAll('a[href*="/in/"]');
  const seen = new Set();
  for (const a of anchors) {
    const url = cleanProfileUrl(a.getAttribute('href'));
    if (!url || seen.has(url)) continue;
    const card = a.closest('li, div.entity-result, div[data-chameleon-result-urn]');
    if (!card) continue;
    const name = visibleText(card, 'span[aria-hidden="true"]') || clean(a.textContent);
    if (!name || /^\d+(st|nd|rd|th)$/i.test(name)) continue;
    // The two lines under the name: headline, then location.
    const subtitles = [...card.querySelectorAll('div, p')]
      .map((el) => clean(el.textContent))
      .filter(Boolean);
    const headline = subtitles.find((t) => t !== name && t.length > 2 && t.length < 200 && !/^\d+(st|nd|rd|th)\b/.test(t)) || '';
    seen.add(url);
    out.push({ name, designation: headline, company: '', url, location: '' });
  }
  return out;
}

/** A single open profile page (/in/username). */
function scrapeProfilePage() {
  const url = cleanProfileUrl(location.href);
  if (!url) return [];
  const main = document.querySelector('main') || document.body;
  const name = clean(document.querySelector('h1')?.textContent);
  if (!name) return [];
  // The headline sits directly under the h1; location is the line after it.
  const headline = clean(main.querySelector('h1')?.parentElement?.parentElement?.querySelector('div.text-body-medium')?.textContent);
  // Current company: the first experience entry, or the top-card company button.
  const company = clean(
    main.querySelector('button[aria-label^="Current company"]')?.textContent ||
      main.querySelector('[data-field="experience_company_logo"] span[aria-hidden="true"]')?.textContent
  );
  const locationText = clean(main.querySelector('span.text-body-small.inline')?.textContent);
  return [{ name, designation: headline, company, url, location: locationText }];
}

function scrape() {
  const path = location.pathname;
  if (/^\/search\/results\//.test(path)) return { kind: 'search', rows: scrapeSearchResults() };
  if (/^\/in\//.test(path)) return { kind: 'profile', rows: scrapeProfilePage() };
  return { kind: 'unsupported', rows: [] };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'SCRAPE') return;
  try {
    sendResponse(scrape());
  } catch (err) {
    sendResponse({ kind: 'error', rows: [], error: String(err.message || err) });
  }
  return true;
});
