const $ = (id) => document.getElementById(id);
const status = (msg, cls = '') => {
  $('status').textContent = msg;
  $('status').className = cls;
};

let collected = [];

// Remember the API URL and anything collected but not yet sent.
chrome.storage.local.get(['apiUrl', 'collected'], (s) => {
  if (s.apiUrl) $('api').value = s.apiUrl;
  if (Array.isArray(s.collected) && s.collected.length) {
    collected = s.collected;
    render(`${collected.length} saved from earlier`);
  }
});

$('api').addEventListener('change', () => chrome.storage.local.set({ apiUrl: $('api').value.trim() }));

function render(kindLabel) {
  $('num').textContent = collected.length;
  $('kind').textContent = kindLabel;
  $('send').disabled = collected.length === 0;
  chrome.storage.local.set({ collected });
}

$('scrape').addEventListener('click', async () => {
  status('Collecting…');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('linkedin.com')) return status('Open a LinkedIn page first.', 'err');

  chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE' }, (res) => {
    if (chrome.runtime.lastError) {
      return status('Reload the LinkedIn tab, then try again.', 'err');
    }
    if (!res || res.kind === 'unsupported') {
      return status('Not a people-search or profile page.', 'err');
    }
    if (res.error) return status(res.error, 'err');

    // Merge into whatever is already collected, deduped by profile URL.
    const byUrl = new Map(collected.map((r) => [r.url, r]));
    for (const r of res.rows) if (r.url && !byUrl.has(r.url)) byUrl.set(r.url, r);
    const added = byUrl.size - collected.length;
    collected = [...byUrl.values()];
    render(`${res.kind} page`);
    status(added ? `Added ${added} new profile(s).` : 'No new profiles on this page.', added ? 'ok' : '');
  });
});

$('send').addEventListener('click', async () => {
  const api = $('api').value.trim().replace(/\/$/, '');
  if (!api) return status('Set your app URL first.', 'err');
  $('send').disabled = true;
  status('Sending…');
  try {
    const res = await fetch(`${api}/api/import-linkedin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: collected, source: 'Extension' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    status(`Sent — ${data.count} row(s) saved.`, 'ok');
    collected = [];
    render('sent');
  } catch (err) {
    status(`Failed: ${err.message}. Is the app running?`, 'err');
    $('send').disabled = false;
  }
});
