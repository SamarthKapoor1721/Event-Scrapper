import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import scrapeRoutes from './routes/scrape.js';
import excelRoutes from './routes/excel.js';
import compareRoutes from './routes/compare.js';
import downloadRoutes from './routes/download.js';
import enrichRoutes from './routes/enrich.js';
import { aiEnabled } from './ai/aiFallback.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Request log line (concise).
app.use((req, _res, next) => {
  if (req.path !== '/api/health') console.log(`${req.method} ${req.path}`);
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, aiFallback: aiEnabled(), time: new Date().toISOString() });
});

app.use('/api', scrapeRoutes);
app.use('/api', excelRoutes);
app.use('/api', compareRoutes);
app.use('/api', downloadRoutes);
app.use('/api', enrichRoutes);

// 404 + error handlers.
app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown endpoint.' }));
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  if (!res.headersSent) res.status(500).json({ error: err.message || 'Internal error.' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 GFF Scraper API listening on http://localhost:${PORT}`);
  console.log(`   AI fallback: ${aiEnabled() ? 'ENABLED' : 'disabled (set ANTHROPIC_API_KEY to enable)'}`);
});
