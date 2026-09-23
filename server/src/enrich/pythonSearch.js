import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, '../../../scripts/lead_scraper.py');
const HEADFUL = /^(1|true|yes|on)$/i.test(process.env.HEADFUL || '');

let pythonMissing = false; // once confirmed unavailable, stop trying for this process

/**
 * Primary LinkedIn search path: the standalone Python scraper
 * (scripts/lead_scraper.py) — its own process, its own persistent browser
 * profile with its own solved-CAPTCHA history, and free of the JS-side
 * filtering bugs that kept resurfacing in the Node/Playwright path (which
 * now only runs as a fallback when this comes up empty for a query).
 *
 * Takes the FULL list of queries for this search and spawns Python only
 * ONCE for all of them — its own script already loops through many queries
 * inside one browser session, so batching this way avoids paying a fresh
 * process-and-browser-launch cost per company/query the way calling it once
 * per query would.
 *
 * Returns raw {url, title, snippet, queryIndex}[] candidates, unclassified —
 * queryIndex is the 0-based position in the `queries` array this candidate
 * came from, so the caller can re-attach its own per-query tag (e.g. the
 * company name for Company POC mining). The caller runs everything through
 * the exact same parseProfileTitle / roleMatches / locationMatches /
 * classifyLead pipeline as any other engine — there is no second copy of
 * that logic in Python to keep in sync.
 */
export async function searchViaPythonBatch(queries, { pages = 2, logger } = {}) {
  if (pythonMissing || !queries.length) return [];
  const args = [SCRIPT_PATH, ...queries, '--json', '--pages', String(Math.max(1, Math.min(20, pages)))];
  if (HEADFUL) args.push('--headful');
  // Generous per-query budget (page loads + a possible manual CAPTCHA solve),
  // with a floor so a single query still gets a reasonable window.
  const timeoutMs = Math.max(90000, queries.length * 45000);

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('python3', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      pythonMissing = true;
      logger?.warn(`Python search unavailable: ${err.message}`);
      return resolve([]);
    }

    let stdout = '';
    let stderrTail = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      logger?.warn('Python search timed out — skipping remaining queries.');
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-2000);
      // Mirror the script's own progress lines (CAPTCHA prompts, per-query/
      // per-engine attempts) into the same live log the JS engines write to
      // — 'captcha' for its solve prompt and 'success' for "cleared" so the
      // Find People UI shows (and then dismisses) the same banner it does
      // for the JS engines' own CAPTCHA waits.
      for (const line of d.toString().split('\n')) {
        const t = line.trim();
        if (!t) continue;
        if (/CAPTCHA.*please solve/i.test(t)) logger?.log(`  [python] ${t}`, 'captcha');
        else if (/CAPTCHA cleared/i.test(t)) logger?.success(`  [python] ${t}`);
        else logger?.info(`  [python] ${t}`);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        pythonMissing = true;
        logger?.warn('Python search unavailable: python3 not found on PATH.');
      } else {
        logger?.warn(`Python search error: ${err.message}`);
      }
      resolve([]);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && code !== null) {
        logger?.warn(`Python search exited with code ${code}${stderrTail ? `: ${stderrTail.split('\n').filter(Boolean).pop()}` : ''}`);
        return resolve([]);
      }
      try {
        const items = JSON.parse(stdout);
        resolve(Array.isArray(items) ? items.map((it) => ({ ...it, queryIndex: it.query_index ?? 0 })) : []);
      } catch {
        // A killed/timed-out process may have printed nothing (or partial
        // output) — that's an empty result, not a crash worth alarming about.
        if (stdout.trim()) logger?.warn('Python search produced unparseable output — skipping.');
        resolve([]);
      }
    });
  });
}
