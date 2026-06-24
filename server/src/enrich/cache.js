import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../storage/storage.js';
import { clean, normalizeName, normalizeCompany } from '../normalize/normalize.js';

/**
 * LinkedIn result cache.
 *
 * A simple JSON-file "table" keyed by (name + company). Each record stores the
 * resolved profile, its confidence/status and a `last_verified` timestamp. A
 * fresh search is skipped when a record is < CACHE_TTL_DAYS old.
 *
 * Columns: name · company · linkedin_url · confidence · last_verified (+ extras).
 */

const CACHE_FILE = path.join(DATA_DIR, 'linkedin-cache.json');
const CACHE_TTL_DAYS = 30;

let store = null; // { [key]: record }
let loaded = false;
let dirty = false;

function keyFor(name, company) {
  return `${normalizeName(name)}|${normalizeCompany(company)}`;
}

async function ensureLoaded() {
  if (loaded) return;
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    store = JSON.parse(raw) || {};
  } catch {
    store = {};
  }
  loaded = true;
}

/** Return a cached record if present and younger than maxAgeDays, else null. */
export async function getCached(name, company, maxAgeDays = CACHE_TTL_DAYS) {
  if (!clean(name)) return null;
  await ensureLoaded();
  const rec = store[keyFor(name, company)];
  if (!rec || !rec.last_verified) return null;
  const ageDays = (Date.now() - new Date(rec.last_verified).getTime()) / 86400000;
  if (ageDays > maxAgeDays) return null;
  return rec;
}

/** Insert/replace a record (does not write to disk until flushCache()). */
export async function putCached(record) {
  if (!clean(record?.name)) return;
  await ensureLoaded();
  store[keyFor(record.name, record.company)] = {
    name: clean(record.name),
    company: clean(record.company),
    linkedin_url: record.linkedin_url || '',
    confidence: record.confidence ?? 0,
    confidence_level: record.confidence_level || '',
    status: record.status || '',
    matched_name: record.matched_name || '',
    matched_company: record.matched_company || '',
    matched_title: record.matched_title || '',
    last_verified: new Date().toISOString(),
  };
  dirty = true;
}

/** Persist the cache to disk (call once after a batch). */
export async function flushCache() {
  if (!dirty || !loaded) return;
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(store, null, 2));
    dirty = false;
  } catch {
    /* non-fatal — cache is an optimization */
  }
}
