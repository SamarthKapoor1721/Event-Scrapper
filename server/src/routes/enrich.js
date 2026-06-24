import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { enrichPeople } from '../enrich/linkedin.js';
import { toCsv } from '../export/csv.js';
import { saveOutput } from '../storage/storage.js';
import { jobLogger, logBus } from '../utils/logger.js';
import { clean } from '../normalize/normalize.js';

const router = Router();

/** Split one CSV line, honoring double-quoted fields. */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Parse CSV text into [{ name, designation, company }]. Auto-detects a header. */
function parseCsv(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const hasHeader = header.some((h) => /name|company|designation|title|role|org/.test(h));
  let nameI = 0;
  let roleI = 1;
  let compI = 2;
  let start = 0;
  if (hasHeader) {
    start = 1;
    const find = (re) => header.findIndex((h) => re.test(h));
    nameI = find(/name/) >= 0 ? find(/name/) : 0;
    roleI = find(/designation|title|role|position/);
    compI = find(/company|org/);
  }
  const rows = [];
  for (let i = start; i < lines.length; i++) {
    const c = splitCsvLine(lines[i]);
    rows.push({
      name: clean(c[nameI]),
      designation: clean(roleI >= 0 ? c[roleI] : ''),
      company: clean(compI >= 0 ? c[compI] : ''),
    });
  }
  return rows.filter((r) => r.name);
}

/**
 * POST /api/enrich/batch
 * Body: { rows?: [{name,designation,company}], csv?: string, jobId? }
 * Finds LinkedIn profiles for every row and returns results + a downloadable CSV.
 */
router.post('/enrich/batch', async (req, res) => {
  const { rows, csv, jobId: clientJobId } = req.body || {};
  let people = Array.isArray(rows) && rows.length
    ? rows.map((r) => ({
        name: clean(r.name ?? r.Name),
        designation: clean(r.designation ?? r.Designation ?? r.title ?? r.Title),
        company: clean(r.company ?? r.Company),
      }))
    : typeof csv === 'string'
      ? parseCsv(csv)
      : [];
  people = people.filter((p) => p.name);

  if (!people.length) {
    return res.status(400).json({ error: 'Provide "rows" or "csv" with at least a Name column.' });
  }
  if (people.length > 500) {
    return res.status(400).json({ error: 'Batch is limited to 500 rows per request.' });
  }

  const jobId = clientJobId || randomUUID();
  const logger = jobLogger(jobId);
  try {
    logger.progress(2, 'Starting batch');
    const results = await enrichPeople(people, { logger });
    const out = people.map((p, i) => ({
      Name: p.name,
      Designation: p.designation,
      Company: p.company,
      'LinkedIn URL': results[i].linkedin_url,
      Confidence: results[i].linkedin_url ? `${results[i].confidence}%` : '',
      Status: results[i].status,
    }));
    const filename = `linkedin_batch_${Date.now()}.csv`;
    await saveOutput(filename, Buffer.from(toCsv(out, ['Name', 'Designation', 'Company', 'LinkedIn URL', 'Confidence', 'Status'])));
    logger.success(`Batch complete: ${out.length} row(s).`);
    logBus.done(jobId, { rows: out.length });
    res.json({ jobId, rows: out, results, filename, downloadUrl: `/api/download/${filename}` });
  } catch (err) {
    logger.error(`Batch failed: ${err.message}`);
    logBus.error(jobId, err.message);
    res.status(500).json({ error: err.message, jobId });
  }
});

export default router;
