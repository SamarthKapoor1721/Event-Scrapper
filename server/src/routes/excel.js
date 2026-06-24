import { Router } from 'express';
import { buildYearWorkbook } from '../export/excel.js';
import { speakersCsv, companiesCsv } from '../export/csv.js';
import { loadYear, saveYear, saveOutput } from '../storage/storage.js';
import { manualLinkedIn } from '../enrich/linkedin.js';

const router = Router();

function slug(event) {
  return String(event || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'event';
}

/**
 * Merge user-edited LinkedIn fields from the UI into the stored speakers, keyed
 * by name. A manually set/replaced URL is marked 'Matched' (100%) since a human
 * confirmed it; clearing the URL reverts the row to 'Not Found'.
 */
function mergeLinkedInEdits(stored, edits) {
  const byName = new Map(edits.map((e) => [String(e.name || '').trim().toLowerCase(), e]));
  return stored.map((s) => {
    const edit = byName.get(String(s.name || '').trim().toLowerCase());
    if (!edit || edit.linkedinUrl === undefined) return s;
    const url = String(edit.linkedinUrl || '').trim();
    // A human-supplied URL that differs from the auto-match is treated as
    // confirmed (Found / High); an unchanged URL keeps its existing score.
    if (url && url === (s.linkedinUrl || '')) return s;
    return { ...s, ...manualLinkedIn(url) };
  });
}

/**
 * POST /api/generate-excel
 * Body: { year, event? }   (data must already be scraped/stored)
 * Returns: { filename, downloadUrl, counts }
 */
router.post('/generate-excel', async (req, res) => {
  const { year, event, speakers: speakersOverride } = req.body || {};
  if (!year) return res.status(400).json({ error: 'Missing "year".' });

  const data = await loadYear(year);
  if (!data) return res.status(404).json({ error: `No stored data for year ${year}. Scrape it first.` });

  // Manual LinkedIn edits made in the UI before export: persist them back so the
  // stored data and the workbook stay in sync, then build from the merged set.
  if (Array.isArray(speakersOverride) && speakersOverride.length) {
    data.speakers = mergeLinkedInEdits(data.speakers, speakersOverride);
    await saveYear(year, { speakers: data.speakers, companies: data.companies, meta: data.meta });
  }

  const buffer = await buildYearWorkbook(data);
  const filename = `${slug(event || data.meta?.event || 'gff')}_${year}.xlsx`;
  await saveOutput(filename, buffer);

  res.json({
    filename,
    downloadUrl: `/api/download/${filename}`,
    counts: { speakers: data.speakers.length, companies: data.companies.length },
  });
});

/**
 * POST /api/export
 * Body: { year, format: 'csv'|'json', kind: 'speakers'|'companies'|'all', event? }
 * Returns a downloadable artifact (file saved to output).
 */
router.post('/export', async (req, res) => {
  const { year, format = 'json', kind = 'all', event } = req.body || {};
  if (!year) return res.status(400).json({ error: 'Missing "year".' });
  const data = await loadYear(year);
  if (!data) return res.status(404).json({ error: `No stored data for year ${year}.` });

  const base = `${slug(event || data.meta?.event || 'gff')}_${year}`;
  const files = [];

  if (format === 'json') {
    if (kind === 'speakers' || kind === 'all') {
      await saveOutput(`${base}_speakers.json`, Buffer.from(JSON.stringify(data.speakers, null, 2)));
      files.push(`${base}_speakers.json`);
    }
    if (kind === 'companies' || kind === 'all') {
      await saveOutput(`${base}_companies.json`, Buffer.from(JSON.stringify(data.companies, null, 2)));
      files.push(`${base}_companies.json`);
    }
  } else if (format === 'csv') {
    if (kind === 'speakers' || kind === 'all') {
      await saveOutput(`${base}_speakers.csv`, Buffer.from(speakersCsv(data.speakers)));
      files.push(`${base}_speakers.csv`);
    }
    if (kind === 'companies' || kind === 'all') {
      await saveOutput(`${base}_companies.csv`, Buffer.from(companiesCsv(data.companies)));
      files.push(`${base}_companies.csv`);
    }
  } else {
    return res.status(400).json({ error: `Unsupported format "${format}".` });
  }

  res.json({ files: files.map((f) => ({ filename: f, downloadUrl: `/api/download/${f}` })) });
});

export default router;
