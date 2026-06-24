import { Router } from 'express';
import fs from 'node:fs';
import { outputPath } from '../storage/storage.js';

const router = Router();

/** GET /api/download/:filename — stream a generated artifact. */
router.get('/download/:filename', (req, res) => {
  const full = outputPath(req.params.filename); // basename-sanitized inside
  if (!fs.existsSync(full)) {
    return res.status(404).json({ error: `File not found: ${req.params.filename}` });
  }
  res.download(full, req.params.filename, (err) => {
    if (err && !res.headersSent) res.status(500).json({ error: err.message });
  });
});

export default router;
