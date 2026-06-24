// Thin API client for the backend. All endpoints are proxied under /api.

const BASE = '/api';

async function postJson(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function del(path) {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  scrape: (payload) => postJson('/scrape', payload),
  enrichBatch: (payload) => postJson('/enrich/batch', payload),
  generateExcel: (payload) => postJson('/generate-excel', payload),
  compare: (payload) => postJson('/compare', payload),
  exportData: (payload) => postJson('/export', payload),
  years: () => getJson('/years'),
  deleteYear: (year) => del(`/data/${encodeURIComponent(year)}`),
  health: () => getJson('/health'),
  downloadUrl: (filename) => `${BASE}/download/${filename}`,
  logStreamUrl: (jobId) => `${BASE}/scrape/logs/${jobId}`,
};

/** Generate a client-side job id (so we can open the SSE stream first). */
export function newJobId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
