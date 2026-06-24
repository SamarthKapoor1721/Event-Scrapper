import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..'); // project root

export const DATA_DIR = path.join(ROOT, 'data');
export const OUTPUT_DIR = path.join(ROOT, 'server', 'output');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function yearDir(year) {
  return path.join(DATA_DIR, String(year));
}

/** Persist scraped data as data/<year>/{speakers,companies}.json */
export async function saveYear(year, { speakers, companies, meta }) {
  const dir = yearDir(year);
  await ensureDir(dir);
  const payload = {
    speakers: { meta: { ...meta, count: speakers.length }, speakers },
    companies: { meta: { ...meta, count: companies.length }, companies },
  };
  await fs.writeFile(path.join(dir, 'speakers.json'), JSON.stringify(payload.speakers, null, 2));
  await fs.writeFile(path.join(dir, 'companies.json'), JSON.stringify(payload.companies, null, 2));
  return dir;
}

export async function loadYear(year) {
  const dir = yearDir(year);
  try {
    const [s, c] = await Promise.all([
      fs.readFile(path.join(dir, 'speakers.json'), 'utf8'),
      fs.readFile(path.join(dir, 'companies.json'), 'utf8'),
    ]);
    const speakers = JSON.parse(s);
    const companies = JSON.parse(c);
    return {
      speakers: speakers.speakers || [],
      companies: companies.companies || [],
      meta: speakers.meta || {},
    };
  } catch {
    return null;
  }
}

/** Delete data/<year> and everything in it. Returns true if a dir was removed. */
export async function deleteYear(year) {
  const dir = yearDir(year);
  // Guard against traversal / empty input — only allow a single path segment.
  const safe = path.basename(String(year));
  if (!safe || safe === '.' || safe === '..' || path.join(DATA_DIR, safe) !== dir) {
    throw new Error(`Invalid year: ${year}`);
  }
  try {
    await fs.rm(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export async function listYears() {
  try {
    const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
    const years = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const data = await loadYear(e.name);
      if (data) {
        years.push({
          year: e.name,
          speakers: data.speakers.length,
          companies: data.companies.length,
          scrapedAt: data.meta?.scrapedAt || null,
        });
      }
    }
    return years.sort((a, b) => a.year.localeCompare(b.year));
  } catch {
    return [];
  }
}

export async function saveOutput(filename, buffer) {
  await ensureDir(OUTPUT_DIR);
  const safe = path.basename(filename); // prevent traversal
  const full = path.join(OUTPUT_DIR, safe);
  await fs.writeFile(full, buffer);
  return { filename: safe, path: full };
}

export function outputPath(filename) {
  return path.join(OUTPUT_DIR, path.basename(filename));
}
