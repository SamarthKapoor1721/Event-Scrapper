import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { enrichPeople, searchProfiles, buildXrayQuery, classifyLead, findEvents, roleVariants, roleMatches } from '../enrich/linkedin.js';
import { toCsv } from '../export/csv.js';
import { buildRowsWorkbook } from '../export/excel.js';
import { saveOutput } from '../storage/storage.js';
import { jobLogger, logBus } from '../utils/logger.js';
import { clean, normalizeName, normalizeCompany } from '../normalize/normalize.js';

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

/**
 * POST /api/search-profiles
 * Body: { query | url, pages?, jobId? }
 * Runs a LinkedIn X-ray search and returns the profiles found (name,
 * designation, company, url) plus a downloadable Excel + CSV.
 */
router.post('/search-profiles', async (req, res) => {
  const { query, url, location, locations, designations, industries, keywords, pages, jobId: clientJobId } = req.body || {};
  // Either a raw query/URL, or structured filters (locations + designations) that
  // get compiled into LinkedIn X-ray queries — one per city, so each city's
  // results are gathered separately and merged (far more people than one big OR).
  const locList = Array.isArray(locations) ? locations : [];
  const raw = clean(query || url);
  const cityList = [...new Set([location, ...locList].map((c) => clean(c)).filter(Boolean))];
  const hasFilters = cityList.length || (Array.isArray(designations) && designations.length);

  let queries = [];
  let label = '';
  if (raw) {
    queries = [raw];
    label = raw;
  } else if (hasFilters) {
    const roleList = Array.isArray(designations) ? designations.map((d) => clean(d)).filter(Boolean) : [];
    const cities = cityList.length ? cityList : [''];
    const roles = roleList.length ? roleList : [null];
    // Search every city × role separately so each location/role is fully covered,
    // then merge — this yields far more people than one big combined OR query.
    const industryList = Array.isArray(industries) ? industries.map((i) => clean(i)).filter(Boolean) : [];
    let combos = [];
    if (req.body?.deep) {
      // Deep search: give EVERY role phrasing its own query. Engines cap each
      // query at ~10 results, so N phrasings ≈ N× the people (slower, more
      // requests, higher CAPTCHA risk).
      for (const c of cities) {
        for (const r of roles) {
          const variants = r ? roleVariants(r) : [''];
          for (const v of variants) combos.push(buildXrayQuery({ location: c, exactRole: v || undefined, designations: v ? [] : [], industries: industryList, keywords }));
        }
      }
    } else {
      for (const c of cities) for (const r of roles) combos.push(buildXrayQuery({ location: c, designations: r ? [r] : [], industries: industryList, keywords }));
    }
    combos = [...new Set(combos)];
    // Search every combination separately (max coverage). Only if there are a lot
    // do we group roles into one OR clause per city to bound the request count.
    const cap = req.body?.deep ? 60 : 24;
    queries = combos.length > cap ? cities.map((c) => buildXrayQuery({ location: c, designations: roleList, industries: industryList, keywords })) : combos;
    label = `${queries.length} search(es)${cityList.length ? ` · cities: ${cityList.join(', ')}` : ''}`;
  }
  if (!queries.length) {
    return res.status(400).json({ error: 'Provide a search query/URL, or a location and/or designations.' });
  }
  const jobId = clientJobId || randomUUID();
  const logger = jobLogger(jobId);
  try {
    logger.progress(5, 'Searching');
    // Cap pages low: search engines truncate `site:` results to ~1 page, and many
    // rapid page loads just trigger a CAPTCHA. More pages ≠ more results.
    const stats = {};
    const profiles = await searchProfiles(queries, { logger, pages: Math.max(1, Math.min(3, Number(pages) || 2)), stats });

    // Classify each lead (seniority · department · heuristic decision score),
    // drop non-decision-makers (unless disabled), and sort by score.
    const excludeJunk = req.body?.excludeJunk !== false;
    // Accuracy: keep only profiles whose text actually shows one of the roles
    // searched (drops unrelated people the engine happened to return).
    const strict = req.body?.strict !== false;
    const roleFilter = Array.isArray(designations) ? designations.map((d) => clean(d)).filter(Boolean) : [];
    const headers = ['Name', 'LinkedIn URL', 'Decision Score'];
    let rows = profiles
      // Lenient strict match: keep anyone whose title we couldn't read (they came
      // from a role-targeted search, so trust it); only drop a clearly-parsed
      // designation that doesn't match any searched role.
      .filter((p) => !strict || !roleFilter.length || !clean(p.designation) || roleMatches(`${p.designation} ${p.snippet}`, roleFilter))
      .map((p) => {
        const c = classifyLead(p);
        return {
          Name: p.name,
          Designation: p.designation,
          Seniority: c.seniority,
          Department: c.department,
          Company: p.company,
          'LinkedIn URL': p.url,
          'Decision Score': c.decisionScore,
          Source: p.source || 'Search',
          _junk: c.junk,
        };
      })
      .filter((r) => r.Name && (!excludeJunk || !r._junk))
      .sort((a, b) => b['Decision Score'] - a['Decision Score'])
      .map(({ _junk, ...r }) => r);

    const stamp = Date.now();
    const xlsx = `linkedin_profiles_${stamp}.xlsx`;
    const csv = `linkedin_profiles_${stamp}.csv`;
    await saveOutput(xlsx, await buildRowsWorkbook(rows, 'Leads', headers));
    await saveOutput(csv, Buffer.from(toCsv(rows, headers)));
    logger.success(`Found ${rows.length} lead(s).`);
    const note = stats.blocked && rows.length < 3
      ? 'Search engines are rate-limiting / showing a CAPTCHA on this IP right now. Wait a few minutes, keep pages at 1–2, and run fewer searches back-to-back.'
      : undefined;
    logBus.done(jobId, { rows: rows.length });
    res.json({ jobId, query: label, rows, count: rows.length, note, downloadUrl: `/api/download/${xlsx}`, csvUrl: `/api/download/${csv}` });
  } catch (err) {
    logger.error(`Profile search failed: ${err.message}`);
    logBus.error(jobId, err.message);
    res.status(500).json({ error: err.message, jobId });
  }
});

/**
 * POST /api/mine-posts  (Company POC finder)
 * Body: { companies: [], designations?, location?, pages?, excludeJunk?, jobId? }
 * For each company, searches LinkedIn for the people who work there (optionally
 * narrowed by role/location) and returns real POC profiles: name, company, URL.
 */
router.post('/mine-posts', async (req, res) => {
  const { companies, designations, location, locations, pages, jobId: clientJobId } = req.body || {};
  const companyList = (Array.isArray(companies) ? companies : String(companies || '').split(/[\n,]/))
    .map((c) => clean(c)).filter(Boolean);
  if (!companyList.length) return res.status(400).json({ error: 'Provide at least one company (one per line).' });

  // Cities must be OR'd as separate quoted terms — quoting them as one phrase
  // ("Bengaluru OR Bangalore") matches nothing.
  const cityList = [...new Set([location, ...(Array.isArray(locations) ? locations : [])].map((c) => clean(c)).filter(Boolean))];
  const locClause = cityList.length === 1 ? ` "${cityList[0]}"` : cityList.length > 1 ? ` (${cityList.map((c) => `"${c}"`).join(' OR ')})` : '';
  const roleList = (Array.isArray(designations) ? designations : []).map((d) => clean(d)).filter(Boolean);

  // One tagged query per company (× role when that stays under the cap). Every
  // company always gets at least one search — none are dropped.
  const MAX_QUERIES = 30;
  const splitRoles = roleList.length > 0 && companyList.length * roleList.length <= MAX_QUERIES;
  const queries = [];
  for (const c of companyList) {
    const base = `site:linkedin.com/in "${c}"${locClause}`;
    if (splitRoles) {
      for (const r of roleList) queries.push({ query: `${base} "${r}"`, tag: c });
    } else if (roleList.length) {
      queries.push({ query: `${base} (${roleList.map((r) => `"${r}"`).join(' OR ')})`, tag: c });
    } else {
      queries.push({ query: base, tag: c });
    }
  }

  const jobId = clientJobId || randomUUID();
  const logger = jobLogger(jobId);
  try {
    logger.progress(5, 'Searching');
    const stats = {};
    const pageCount = Math.max(1, Math.min(3, Number(pages) || 2));
    let profiles = await searchProfiles(queries, { logger, pages: pageCount, stats });

    // Second pass: small companies often have nobody matching role+location, so
    // retry the ones that came back empty with just the company name.
    const foundFor = new Set(profiles.map((p) => p.company));
    const missing = companyList.filter((c) => !foundFor.has(c));
    if (missing.length && (roleList.length || locClause)) {
      logger.info(`Retrying ${missing.length} company(ies) with no results, company-name only…`);
      const retry = missing.slice(0, 30).map((c) => ({ query: `site:linkedin.com/in "${c}"`, tag: c }));
      const more = await searchProfiles(retry, { logger, pages: 1, stats });
      const seenUrl = new Set(profiles.map((p) => p.url));
      profiles = [...profiles, ...more.filter((p) => !seenUrl.has(p.url))];
    }

    const excludeJunk = req.body?.excludeJunk !== false;
    const strict = req.body?.strict !== false;
    const headers = ['Name', 'Designation', 'Seniority', 'Company', 'LinkedIn URL', 'Decision Score'];
    let rows = profiles
      .filter((p) => !strict || !roleList.length || !clean(p.designation) || roleMatches(`${p.designation} ${p.snippet}`, roleList))
      .map((p) => {
        const c = classifyLead(p);
        return { Name: p.name, Designation: p.designation, Seniority: c.seniority, Company: p.company, 'LinkedIn URL': p.url, 'Decision Score': c.decisionScore, _junk: c.junk };
      })
      .filter((r) => r.Name && (!excludeJunk || !r._junk))
      .sort((a, b) => b['Decision Score'] - a['Decision Score'])
      .map(({ _junk, ...r }) => r);

    const stamp = Date.now();
    const xlsx = `company_pocs_${stamp}.xlsx`;
    const csv = `company_pocs_${stamp}.csv`;
    await saveOutput(xlsx, await buildRowsWorkbook(rows, 'Company POCs', headers));
    await saveOutput(csv, Buffer.from(toCsv(rows, headers)));

    const note = stats.blocked && rows.length < 3
      ? 'Search engines are rate-limiting this IP. Wait a few minutes and keep pages at 1–2.'
      : undefined;
    logger.success(`Found ${rows.length} POC(s) across ${companyList.length} companies.`);
    logBus.done(jobId, { rows: rows.length });
    res.json({ jobId, rows, count: rows.length, note, downloadUrl: `/api/download/${xlsx}`, csvUrl: `/api/download/${csv}` });
  } catch (err) {
    logger.error(`Company POC search failed: ${err.message}`);
    logBus.error(jobId, err.message);
    res.status(500).json({ error: err.message, jobId });
  }
});

const EVENT_FORMATS = ['Summit', 'Conference', 'Roundtable', 'Forum', 'Conclave', 'Leadership Summit', 'CXO Forum'];

/**
 * POST /api/find-events
 * Body: { designations|topics: [], location?, industries?, pages?, jobId? }
 * Finds events/summits/roundtables for the given roles/industry + location, and
 * the LinkedIn profiles that appear in the results.
 */
router.post('/find-events', async (req, res) => {
  const { designations, topics, location, industries, year, pages, jobId: clientJobId } = req.body || {};
  const topicList = [...(Array.isArray(designations) ? designations : []), ...(Array.isArray(topics) ? topics : [])]
    .map((t) => clean(t)).filter(Boolean);
  const loc = clean(location);
  const yr = clean(year).match(/\b(19|20)\d{2}\b/)?.[0] || '';
  const indList = (Array.isArray(industries) ? industries : []).map((i) => clean(i)).filter(Boolean);
  if (!topicList.length && !indList.length) {
    return res.status(400).json({ error: 'Add at least one designation/topic or industry.' });
  }

  // For each topic/industry, search event-format phrasings + location (+ year).
  const subjects = topicList.length ? topicList : indList;
  const formatClause = `(${EVENT_FORMATS.map((f) => `"${f}"`).join(' OR ')})`;
  const queries = subjects.map((s) => {
    const ind = indList.length && topicList.length ? ` (${indList.map((i) => `"${i}"`).join(' OR ')})` : '';
    return `"${s}" ${formatClause}${loc ? ` "${loc}"` : ''}${ind}${yr ? ` ${yr}` : ''}`.trim();
  });

  const jobId = clientJobId || randomUUID();
  const logger = jobLogger(jobId);
  try {
    logger.progress(5, 'Searching events');
    const stats = {};
    const { events, profiles } = await findEvents(queries, { logger, pages: Math.max(1, Math.min(3, Number(pages) || 2)), stats });

    const eventRows = events.map((e) => ({ Event: e.title, URL: e.url, About: e.snippet }));
    const profileRows = profiles.map((p) => {
      const c = classifyLead(p);
      return { Name: p.name, Designation: p.designation, Seniority: c.seniority, Company: p.company, 'LinkedIn URL': p.url, 'Decision Score': c.decisionScore };
    }).filter((r) => r.Name).sort((a, b) => b['Decision Score'] - a['Decision Score']);

    const stamp = Date.now();
    const eventsFile = `events_${stamp}.csv`;
    const leadsFile = `event_leads_${stamp}.csv`;
    await saveOutput(eventsFile, Buffer.from(toCsv(eventRows, ['Event', 'URL', 'About'])));
    await saveOutput(leadsFile, Buffer.from(toCsv(profileRows, ['Name', 'Designation', 'Seniority', 'Company', 'LinkedIn URL', 'Decision Score'])));

    const note = stats.blocked && !events.length && !profiles.length
      ? 'Search engines are rate-limiting this IP. Wait a few minutes and keep pages at 1–2.'
      : undefined;
    logger.success(`Found ${events.length} events, ${profileRows.length} profiles.`);
    logBus.done(jobId, { events: events.length });
    res.json({
      jobId,
      events: eventRows,
      profiles: profileRows,
      note,
      eventsUrl: `/api/download/${eventsFile}`,
      leadsUrl: `/api/download/${leadsFile}`,
    });
  } catch (err) {
    logger.error(`Event search failed: ${err.message}`);
    logBus.error(jobId, err.message);
    res.status(500).json({ error: err.message, jobId });
  }
});

/** Normalize a LinkedIn URL for matching (drop scheme/www/query/trailing slash). */
function normLinkedinUrl(v) {
  return clean(v)
    .toLowerCase()
    .replace(/^https?:\/\/(www\.|[a-z]{2}\.)?/, '')
    .replace(/[/?#].*$/, (m) => m.replace(/\?.*$/, '').replace(/#.*$/, '').replace(/\/+$/, ''))
    .replace(/\/+$/, '')
    .replace(/\?.*$/, '');
}

/** Remove duplicate rows. `by`: 'auto' | 'linkedin' | 'name' | 'name_company'. */
function dedupeRows(rows, by = 'auto') {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const find = (re) => headers.find((h) => re.test(h));
  const urlCol = find(/linkedin|profile.*url|^url$/i);
  const nameCol = find(/name/i);
  const compCol = find(/company|organi[sz]ation|employer/i);

  let mode = by;
  if (mode === 'auto') mode = urlCol ? 'linkedin' : nameCol ? 'name_company' : 'name';

  const keyOf = (r) => {
    if (mode === 'linkedin' && urlCol && clean(r[urlCol])) return `u:${normLinkedinUrl(r[urlCol])}`;
    if ((mode === 'name_company' || mode === 'name') && nameCol) {
      const n = normalizeName(r[nameCol]);
      if (!n) return '';
      return mode === 'name_company' && compCol ? `n:${n}|${normalizeCompany(r[compCol])}` : `n:${n}`;
    }
    return '';
  };

  const seen = new Set();
  const out = [];
  let removed = 0;
  for (const r of rows) {
    const key = keyOf(r);
    if (!key) { out.push(r); continue; } // no usable key → keep the row
    if (seen.has(key)) { removed += 1; continue; }
    seen.add(key);
    out.push(r);
  }
  const keyByLabel = mode === 'linkedin' ? (urlCol || 'LinkedIn URL') : mode === 'name_company' ? `${nameCol || 'Name'} + ${compCol || 'Company'}` : nameCol || 'Name';
  return { rows: out, removed, headers, keyBy: keyByLabel };
}

/** Resolve 'auto' → a concrete match mode from a set of headers. */
function resolveMode(headers, by) {
  if (by && by !== 'auto') return by;
  const find = (re) => headers.find((h) => re.test(h));
  return find(/linkedin|profile.*url|^url$/i) ? 'linkedin' : find(/name/i) ? 'name_company' : 'name';
}

/** Build a keyer for a given header set + explicit mode (keys are comparable across files). */
function makeKeyer(headers, mode) {
  const find = (re) => headers.find((h) => re.test(h));
  const urlCol = find(/linkedin|profile.*url|^url$/i);
  const nameCol = find(/name/i);
  const compCol = find(/company|organi[sz]ation|employer/i);
  const keyFn = (r) => {
    if (mode === 'linkedin' && urlCol && clean(r[urlCol])) return `u:${normLinkedinUrl(r[urlCol])}`;
    if ((mode === 'name_company' || mode === 'name') && nameCol) {
      const n = normalizeName(r[nameCol]);
      if (!n) return '';
      return mode === 'name_company' && compCol ? `n:${n}|${normalizeCompany(r[compCol])}` : `n:${n}`;
    }
    return '';
  };
  const keyBy = mode === 'linkedin' ? (urlCol || 'LinkedIn URL') : mode === 'name_company' ? `${nameCol || 'Name'} + ${compCol || 'Company'}` : nameCol || 'Name';
  return { keyFn, keyBy };
}

/** Turn a file payload ({ rows } | { fileBase64 } | { csv/tsv text }) into rows. */
function payloadToRows(p) {
  if (!p) return [];
  if (Array.isArray(p.rows)) return p.rows;
  try {
    if (typeof p.fileBase64 === 'string' && p.fileBase64) {
      const wb = XLSX.read(p.fileBase64, { type: 'base64' });
      return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    }
    if (typeof p.csv === 'string' && p.csv.trim()) {
      const wb = XLSX.read(p.csv, { type: 'string' });
      return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    }
  } catch {
    /* unreadable file → no rows */
  }
  return [];
}

/**
 * POST /api/subtract-lists
 * Body: { master: [payload], incoming: [payload], by? }
 * Returns the incoming rows that are NOT already in the master list(s), also
 * deduped among themselves. Preserves the incoming columns. Accepts CSV / XLSX /
 * XLS / JSON (as rows) across any number of files per side.
 */
router.post('/subtract-lists', async (req, res) => {
  const { master = [], incoming = [], by = 'auto' } = req.body || {};
  const masterRows = (Array.isArray(master) ? master : []).flatMap(payloadToRows);
  const incomingRows = (Array.isArray(incoming) ? incoming : []).flatMap(payloadToRows);
  if (!incomingRows.length) {
    return res.status(400).json({ error: 'Upload at least one new/incoming file with rows.' });
  }

  const headers = Object.keys(incomingRows[0]);
  const mode = resolveMode([...headers, ...(masterRows[0] ? Object.keys(masterRows[0]) : [])], by);
  const masterKeyer = makeKeyer(masterRows[0] ? Object.keys(masterRows[0]) : [], mode);
  const incKeyer = makeKeyer(headers, mode);

  const masterSet = new Set();
  for (const r of masterRows) { const k = masterKeyer.keyFn(r); if (k) masterSet.add(k); }

  const seen = new Set();
  const kept = [];
  let removedMaster = 0;
  let removedDup = 0;
  for (const r of incomingRows) {
    const k = incKeyer.keyFn(r);
    if (k && masterSet.has(k)) { removedMaster += 1; continue; }
    if (k && seen.has(k)) { removedDup += 1; continue; }
    if (k) seen.add(k);
    kept.push(r);
  }

  const stamp = Date.now();
  const xlsx = `new_unique_${stamp}.xlsx`;
  const csv = `new_unique_${stamp}.csv`;
  await saveOutput(xlsx, await buildRowsWorkbook(kept, 'New Unique', headers));
  await saveOutput(csv, Buffer.from(toCsv(kept, headers)));

  res.json({
    masterCount: masterRows.length,
    incomingCount: incomingRows.length,
    kept: kept.length,
    removedMaster,
    removedDup,
    keyBy: incKeyer.keyBy,
    rows: kept.slice(0, 500),
    downloadUrl: `/api/download/${xlsx}`,
    csvUrl: `/api/download/${csv}`,
  });
});

/**
 * POST /api/dedupe
 * Body: { csv?: string, fileBase64?: string, rows?: [], by? }
 * Removes duplicate rows from an uploaded CSV/Excel and returns a cleaned file.
 */
router.post('/dedupe', async (req, res) => {
  const { csv, fileBase64, rows: bodyRows, by = 'auto' } = req.body || {};
  let rows = [];
  try {
    if (Array.isArray(bodyRows) && bodyRows.length) {
      rows = bodyRows;
    } else if (typeof fileBase64 === 'string' && fileBase64) {
      const wb = XLSX.read(fileBase64, { type: 'base64' });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    } else if (typeof csv === 'string' && csv.trim()) {
      const wb = XLSX.read(csv, { type: 'string' });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    }
  } catch (err) {
    return res.status(400).json({ error: `Could not read the file: ${err.message}` });
  }
  if (!rows.length) return res.status(400).json({ error: 'No rows found. Upload a CSV/Excel with a header row.' });

  const { rows: deduped, removed, headers, keyBy } = dedupeRows(rows, by);
  const stamp = Date.now();
  const xlsx = `deduped_${stamp}.xlsx`;
  const csvName = `deduped_${stamp}.csv`;
  await saveOutput(xlsx, await buildRowsWorkbook(deduped, 'Deduped', headers));
  await saveOutput(csvName, Buffer.from(toCsv(deduped, headers)));

  res.json({
    original: rows.length,
    unique: deduped.length,
    removed,
    keyBy,
    downloadUrl: `/api/download/${xlsx}`,
    csvUrl: `/api/download/${csvName}`,
  });
});

export default router;
