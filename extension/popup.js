const $ = (id) => document.getElementById(id);
const status = (msg, cls = '') => {
  $('status').textContent = msg;
  $('status').className = cls;
};

let people = []; // [{ name, designation, company, url?, status? }]

chrome.storage.local.get(['apiUrl', 'people'], (s) => {
  if (s.apiUrl) $('api').value = s.apiUrl;
  if (Array.isArray(s.people) && s.people.length) {
    people = s.people;
    render('saved from earlier');
  }
});

$('api').addEventListener('change', () => chrome.storage.local.set({ apiUrl: $('api').value.trim() }));

function render(label) {
  const withUrl = people.filter((p) => p.url).length;
  $('num').textContent = people.length;
  $('kind').textContent = withUrl ? `${withUrl} with LinkedIn · ${label}` : label;
  $('enrich').disabled = people.length === 0;
  $('send').disabled = people.length === 0;
  chrome.storage.local.set({ people });
}

function progress(done, total) {
  $('track').style.display = total ? 'block' : 'none';
  $('fill').style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
}

// Step 1 — scrape the speakers off whatever page is open.
$('scrape').addEventListener('click', async () => {
  status('Scraping…');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || /^chrome:|^chrome-extension:/.test(tab.url || '')) {
    return status('Open the event page first.', 'err');
  }
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['scrape-event.js'],
    });
    const found = Array.isArray(result) ? result : [];
    if (!found.length) return status('No speakers found on this page.', 'err');

    // Merge with anything already collected, deduped by name.
    const byName = new Map(people.map((p) => [p.name.toLowerCase(), p]));
    let added = 0;
    for (const p of found) {
      if (!byName.has(p.name.toLowerCase())) { byName.set(p.name.toLowerCase(), p); added++; }
    }
    people = [...byName.values()];
    render('scraped');
    status(`Found ${found.length} · ${added} new.`, 'ok');
  } catch (err) {
    status(`Could not read this page: ${err.message}`, 'err');
  }
});

// Step 2 — look up each speaker's LinkedIn profile.
$('enrich').addEventListener('click', () => {
  const todo = people.filter((p) => !p.url);
  if (!todo.length) return status('Everyone already has a profile.', 'ok');
  $('enrich').disabled = true;
  $('scrape').disabled = true;
  status(`Searching ${todo.length} profile(s)…`);
  progress(0, todo.length);

  chrome.runtime.sendMessage({ type: 'ENRICH', people: todo }, (res) => {
    $('enrich').disabled = false;
    $('scrape').disabled = false;
    progress(0, 0);
    if (chrome.runtime.lastError) return status(chrome.runtime.lastError.message, 'err');
    if (res?.error) return status(res.error, 'err');

    const byName = new Map(people.map((p) => [p.name.toLowerCase(), p]));
    for (const r of res.rows || []) byName.set(r.name.toLowerCase(), { ...byName.get(r.name.toLowerCase()), ...r });
    people = [...byName.values()];
    const found = (res.rows || []).filter((r) => r.url).length;
    render('enriched');
    status(`Found ${found} of ${res.rows.length} profile(s).`, found ? 'ok' : 'err');
  });
});

// Live progress + CAPTCHA prompts from the background worker.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'PROGRESS') return;
  if (msg.captcha) {
    status('⚠ CAPTCHA — solve it in the tab that just opened. Waiting…', 'warn');
    return;
  }
  progress(msg.done, msg.total);
  if (msg.current) status(`Searching: ${msg.current} (${msg.done}/${msg.total})`);
});

// Step 3 — hand everything to the app.
$('send').addEventListener('click', async () => {
  const api = $('api').value.trim().replace(/\/$/, '');
  if (!api) return status('Set your app URL first.', 'err');
  $('send').disabled = true;
  status('Sending…');
  try {
    const res = await fetch(`${api}/api/import-linkedin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: people.map((p) => ({ name: p.name, designation: p.designation, company: p.company, url: p.url })),
        source: 'Extension',
        requireUrl: false,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    status(`Sent — ${data.count} row(s) saved.`, 'ok');
    people = [];
    render('sent');
  } catch (err) {
    status(`Failed: ${err.message}. Is the app running?`, 'err');
    $('send').disabled = false;
  }
});
