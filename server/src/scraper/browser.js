/**
 * Page fetching abstraction.
 *
 * Strategy, in order of preference:
 *   1. Playwright (Chromium)  - full JS rendering, best for dynamic pages.
 *   2. Puppeteer (optional)   - fallback headless browser if Playwright fails.
 *   3. Axios + raw HTML       - last resort for static/SSR pages.
 *
 * Returns the rendered HTML plus the engine that produced it.
 */

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function tryPlaywright(url, opts, logger) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    logger?.warn('Playwright not installed — skipping.');
    return null;
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
    const context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    logger?.info(`Playwright: navigating to ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeout });

    // Wait for network to settle so client-rendered content appears.
    await page.waitForLoadState('networkidle', { timeout: opts.timeout }).catch(() => {
      logger?.warn('networkidle not reached; continuing with current DOM.');
    });

    // Some sites gate content behind a JS bot challenge (Vercel/Cloudflare) that
    // auto-resolves after a few seconds. Wait for the real page to appear.
    await waitForChallengeToClear(page, opts, logger);

    if (opts.waitForSelector) {
      await page.waitForSelector(opts.waitForSelector, { timeout: 8000 }).catch(() => {});
    }

    // Auto-scroll to trigger lazy loading / infinite-scroll lists.
    await autoScroll(page, logger);
    await page.waitForTimeout(opts.settleMs ?? 1200);

    const html = await page.content();
    const finalUrl = page.url();
    return { html, engine: 'playwright', finalUrl };
  } catch (err) {
    logger?.warn(`Playwright failed: ${err.message}`);
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}

/**
 * Wait for a JS bot-challenge interstitial (Vercel/Cloudflare "checkpoint") to
 * resolve into the real page. These run JS that reloads the page once passed.
 */
async function waitForChallengeToClear(page, opts, logger) {
  const deadline = Date.now() + Math.min(opts.timeout ?? 45000, 25000);
  let warned = false;
  while (Date.now() < deadline) {
    const html = await page.content().catch(() => '');
    if (!looksLikeChallenge(html)) return;
    if (!warned) {
      logger?.warn('Bot challenge detected — waiting for it to clear…');
      warned = true;
    }
    await page.waitForTimeout(2000);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }
  if (warned) logger?.warn('Challenge did not clear within budget; continuing with current DOM.');
}

/**
 * Auto-scroll to the bottom repeatedly, waiting for new content, until the page
 * height stops growing. Handles both lazy images and infinite-scroll lists
 * ("scroll down to load more …").
 */
async function autoScroll(page, logger) {
  let last = 0;
  let stable = 0;
  const maxRounds = 150;
  for (let i = 0; i < maxRounds && stable < 4; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await page.waitForTimeout(900);
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    const height = await page.evaluate(() => document.body.scrollHeight).catch(() => last);
    if (height === last) {
      stable += 1;
    } else {
      stable = 0;
      last = height;
    }
  }
  logger?.info(`Auto-scroll settled at ${last}px.`);
}

async function tryPuppeteer(url, opts, logger) {
  let puppeteer;
  try {
    ({ default: puppeteer } = await import('puppeteer'));
  } catch {
    logger?.warn('Puppeteer not installed — skipping fallback.');
    return null;
  }
  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    logger?.info(`Puppeteer: navigating to ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: opts.timeout });
    await new Promise((r) => setTimeout(r, opts.settleMs ?? 1200));
    const html = await page.content();
    return { html, engine: 'puppeteer', finalUrl: page.url() };
  } catch (err) {
    logger?.warn(`Puppeteer failed: ${err.message}`);
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function tryAxios(url, opts, logger) {
  const { default: axios } = await import('axios');
  logger?.info(`Axios: fetching static HTML for ${url}`);
  const res = await axios.get(url, {
    timeout: opts.timeout,
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400,
  });
  return { html: res.data, engine: 'axios', finalUrl: url };
}

/** Detect a Cloudflare / Vercel / generic bot-challenge interstitial. */
export function looksLikeChallenge(html) {
  if (!html) return false;
  const h = html.toLowerCase();
  return (
    h.includes('cf-browser-verification') ||
    h.includes('checking your browser') ||
    h.includes('cf-challenge') ||
    h.includes('attention required! | cloudflare') ||
    (h.includes('cloudflare') && h.includes('ray id')) ||
    h.includes('vercel security checkpoint') ||
    h.includes('just a moment') ||
    h.includes('verifying you are human')
  );
}

/**
 * Fetch a page, trying engines in order. Throws if every engine fails.
 */
export async function fetchPage(url, options = {}, logger) {
  const opts = {
    timeout: options.timeout ?? 45000,
    settleMs: options.settleMs ?? 1200,
    waitForSelector: options.waitForSelector,
    preferStatic: options.preferStatic ?? false,
  };

  const engines = opts.preferStatic
    ? [tryAxios, tryPlaywright, tryPuppeteer]
    : [tryPlaywright, tryPuppeteer, tryAxios];

  let lastError;
  for (const engine of engines) {
    try {
      const result = await engine(url, opts, logger);
      if (result?.html) {
        if (looksLikeChallenge(result.html)) {
          logger?.warn(`${result.engine}: hit a Cloudflare/bot challenge page.`);
          lastError = new Error('Blocked by Cloudflare / bot challenge.');
          continue; // try a heavier engine
        }
        logger?.success(`Fetched page via ${result.engine} (${result.html.length} bytes).`);
        return result;
      }
    } catch (err) {
      lastError = err;
      logger?.warn(`Engine error: ${err.message}`);
    }
  }
  throw lastError || new Error('All fetch engines failed.');
}
