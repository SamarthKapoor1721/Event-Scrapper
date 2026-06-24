import { Router } from 'express';
import { compareYears } from '../compare/compare.js';
import { buildComparisonWorkbook } from '../export/excel.js';
import { loadYear, saveOutput, listYears, deleteYear } from '../storage/storage.js';

const router = Router();

/**
 * POST /api/compare
 * Body: { baseYear, targetYear, threshold?, fuzzy?, event? }
 * Defaults to comparing 2025 -> 2026 when years omitted.
 * Returns: { downloadUrl, summary, comparison }
 */
router.post('/compare', async (req, res) => {
  const { baseYear = '2025', targetYear = '2026', threshold, fuzzy, event } = req.body || {};

  const [base, target] = await Promise.all([loadYear(baseYear), loadYear(targetYear)]);
  if (!base) return res.status(404).json({ error: `No data for base year ${baseYear}. Scrape it first.` });
  if (!target) return res.status(404).json({ error: `No data for target year ${targetYear}. Scrape it first.` });

  const options = {
    baseYear: String(baseYear),
    targetYear: String(targetYear),
    fuzzy: fuzzy !== undefined ? Boolean(fuzzy) : true,
    threshold: typeof threshold === 'number' ? threshold : undefined,
  };

  const comparison = compareYears(base, target, options);
  const buffer = await buildComparisonWorkbook(comparison);
  const filename = 'comparison.xlsx';
  await saveOutput(filename, buffer);

  res.json({
    filename,
    downloadUrl: `/api/download/${filename}`,
    summary: comparison.summary,
    comparison,
  });
});

/** GET /api/years — list stored years and their counts (drives the UI). */
router.get('/years', async (_req, res) => {
  res.json({ years: await listYears() });
});

/** GET /api/data/:year — return stored speakers & companies for inspection. */
router.get('/data/:year', async (req, res) => {
  const data = await loadYear(req.params.year);
  if (!data) return res.status(404).json({ error: `No data for year ${req.params.year}.` });
  res.json(data);
});

/** DELETE /api/data/:year — remove stored speakers & companies for a year. */
router.delete('/data/:year', async (req, res) => {
  try {
    const existed = await loadYear(req.params.year);
    if (!existed) return res.status(404).json({ error: `No data for year ${req.params.year}.` });
    await deleteYear(req.params.year);
    res.json({ deleted: true, year: String(req.params.year) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
