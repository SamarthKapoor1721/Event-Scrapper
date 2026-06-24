import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { scrape } from '../scraper/scraper.js';
import { enrichSpeakers } from '../enrich/linkedin.js';
import { saveYear } from '../storage/storage.js';
import { jobLogger, logBus } from '../utils/logger.js';

const router = Router();

/**
 * GET /api/scrape/logs/:jobId  — Server-Sent Events stream of logs & progress.
 * The client opens this before POSTing /scrape so it sees live output.
 */
router.get('/scrape/logs/:jobId', (req, res) => {
  const { jobId } = req.params;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('\n');

  // Flush any backlog first.
  for (const event of logBus.backlog(jobId)) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  const onEvent = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  logBus.on(jobId, onEvent);

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(keepAlive);
    logBus.off(jobId, onEvent);
  });
});

/**
 * POST /api/scrape
 * Body: { year, url | urls, event?, selectors?, useAI?, retries?, jobId? }
 * Returns: { jobId, speakers, companies, count, confidence, meta }
 */
router.post('/scrape', async (req, res) => {
  const { year, url, urls, event, eventName, selectors, scope, useAI, findLinkedIn, retries, crawl, maxPages, maxDepth, jobId: clientJobId } = req.body || {};
  const jobId = clientJobId || randomUUID();
  const logger = jobLogger(jobId);

  if (!year) return res.status(400).json({ error: 'Missing "year".', jobId });
  if (!url && !(Array.isArray(urls) && urls.length)) {
    return res.status(400).json({ error: 'Provide "url" or non-empty "urls".', jobId });
  }

  try {
    logger.progress(2, 'Queued');
    const result = await scrape(
      {
        year,
        eventName: eventName || event,
        url,
        urls,
        selectors,
        scope: typeof scope === 'string' && scope.trim() ? scope.trim() : undefined,
        useAI: Boolean(useAI),
        retries: Number.isInteger(retries) ? retries : 1,
        crawl: Boolean(crawl),
        maxPages: Number.isInteger(maxPages) ? Math.max(1, Math.min(200, maxPages)) : 25,
        maxDepth: Number.isInteger(maxDepth) ? Math.max(0, Math.min(5, maxDepth)) : 2,
      },
      logger
    );

    // LinkedIn Profile Enrichment — runs automatically after scraping completes
    // and before storage/export, so the saved data and Excel include the matches.
    if (findLinkedIn && result.speakers.length) {
      logger.progress(0, 'Finding LinkedIn profiles');
      result.speakers = await enrichSpeakers(result.speakers, { logger, progressFrom: 0, progressTo: 100 });
      result.meta = { ...result.meta, linkedinEnriched: true };
    }

    await saveYear(year, { speakers: result.speakers, companies: result.companies, meta: result.meta });
    logger.success(`Saved data/${year}/speakers.json & companies.json`);
    logBus.done(jobId, result.count);

    res.json({ jobId, ...result });
  } catch (err) {
    logger.error(`Scrape failed: ${err.message}`);
    logBus.error(jobId, err.message);
    res.status(500).json({ error: err.message, jobId });
  }
});

export default router;
