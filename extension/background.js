/**
 * Finds a LinkedIn profile URL for each scraped speaker.
 *
 * Runs the search in a real tab in the user's own Chrome (not a headless
 * browser), so results aren't bot-flagged the way the server's Playwright
 * searches are. When a CAPTCHA does appear, the tab is brought to the front so
 * the user can solve it by hand and the run continues — instead of silently
 * returning "Not Found" for everyone, which is what the server-side path did.
 */

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for a tab to finish loading (or time out). */
function waitForLoad(tabId, timeout = 20000) {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    const timer = setTimeout(done, timeout);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/** Read the search page: LinkedIn result links + whether a challenge is showing. */
function readSearchPage() {
  const challenge = /captcha|are you a robot|unusual traffic|verify you are human|prove you'?re human/i
    .test(document.body.innerText || '');
  const results = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.href || '';
    const m = href.match(/https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/[^?#/]+/i);
    if (!m) continue;
    // The result's visible title carries "Name - Headline - Company".
    const card = a.closest('li, div');
    const title = (card?.innerText || a.innerText || '').split('\n')[0];
    results.push({ url: m[0].replace(/^http:/, 'https:'), title: title.trim() });
  }
  return { challenge, results, hasLinkedIn: results.length > 0 };
}

/**
 * Search for one person and return the best LinkedIn URL.
 * `tabId` is reused across people so we don't open a tab per speaker.
 */
async function lookupOne(tabId, person, onCaptcha) {
  const terms = [person.name, person.company, 'LinkedIn'].filter(Boolean).join(' ');
  const url = `https://www.bing.com/search?q=${encodeURIComponent(`site:linkedin.com/in ${terms}`)}`;
  await chrome.tabs.update(tabId, { url });
  await waitForLoad(tabId);
  await sleep(600);

  let [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: readSearchPage });

  // CAPTCHA — surface the tab and wait for the user, then re-read the page.
  if (result?.challenge && !result.hasLinkedIn) {
    await onCaptcha();
    await chrome.tabs.update(tabId, { active: true });
    const win = await chrome.tabs.get(tabId);
    await chrome.windows.update(win.windowId, { focused: true, drawAttention: true });

    // Poll for up to 3 minutes while the user solves it.
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      await sleep(2500);
      [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: readSearchPage });
      if (!result?.challenge) break;
    }
    // Re-run the query: solving a challenge usually lands on a confirmation
    // page rather than the results we asked for.
    if (!result?.hasLinkedIn) {
      await chrome.tabs.update(tabId, { url });
      await waitForLoad(tabId);
      await sleep(600);
      [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: readSearchPage });
    }
  }

  const best = result?.results?.[0];
  if (!best) return { ...person, url: '', matchedTitle: '', status: 'Not Found' };
  return { ...person, url: best.url, matchedTitle: best.title, status: 'Found' };
}

/** Enrich every scraped speaker, reporting progress back to the popup. */
async function enrichAll(people, sendProgress) {
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  const results = [];
  try {
    for (let i = 0; i < people.length; i++) {
      sendProgress({ done: i, total: people.length, current: people[i].name });
      try {
        results.push(await lookupOne(tab.id, people[i], () => sendProgress({ captcha: true, done: i, total: people.length })));
      } catch (err) {
        results.push({ ...people[i], url: '', status: 'Error', error: String(err.message || err) });
      }
      await sleep(1200 + Math.random() * 800); // be gentle on the engine
    }
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
  sendProgress({ done: people.length, total: people.length });
  return results;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'ENRICH') return;
  const send = (p) => chrome.runtime.sendMessage({ type: 'PROGRESS', ...p }).catch(() => {});
  enrichAll(msg.people || [], send)
    .then((rows) => sendResponse({ rows }))
    .catch((err) => sendResponse({ error: String(err.message || err) }));
  return true; // keep the channel open for the async reply
});
