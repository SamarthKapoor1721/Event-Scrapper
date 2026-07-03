import ExcelJS from 'exceljs';

/**
 * Excel export engine (ExcelJS) — produces nicely formatted .xlsx buffers with
 * a bold colored header row, frozen header, auto-filter, banded rows, borders
 * and auto-sized columns. The route layer persists them and serves a download.
 */

const HEADER_FILL = 'FF1D4ED8'; // blue-700
const HEADER_FONT = 'FFFFFFFF'; // white
const BAND_FILL = 'FFF1F5F9'; // slate-100
const BORDER = 'FFE2E8F0'; // slate-200

/**
 * Add a formatted worksheet.
 * @param wb        ExcelJS workbook
 * @param name      sheet name (sanitized, <=31 chars)
 * @param columns   [{ header, key, width }]
 * @param rows      array of objects keyed by column.key
 */
function addSheet(wb, name, columns, rows) {
  const ws = wb.addWorksheet(safeSheetName(name), {
    views: [{ state: 'frozen', ySplit: 1 }], // freeze header row
  });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 24 }));

  // Header styling.
  const header = ws.getRow(1);
  header.height = 22;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_FONT }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = thin();
  });

  // Data rows with zebra banding + borders.
  rows.forEach((r, i) => {
    const row = ws.addRow(r);
    row.eachCell((cell) => {
      cell.alignment = { vertical: 'middle', wrapText: false };
      cell.border = thin();
      if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND_FILL } };
    });
  });

  // Auto-filter across the header, and a sensible default if empty.
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

function thin() {
  const side = { style: 'thin', color: { argb: BORDER } };
  return { top: side, left: side, bottom: side, right: side };
}

/** Excel sheet names must be <=31 chars and free of : \ / ? * [ ] */
function safeSheetName(name) {
  return String(name).replace(/[:\\/?*[\]]/g, ' ').slice(0, 31).trim() || 'Sheet';
}

/** Build a yearly workbook (Speakers + Companies sheets). Returns a Buffer. */
export async function buildYearWorkbook({ speakers = [], companies = [] }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Conference Scraper';
  wb.created = new Date();

  // Only show the LinkedIn enrichment columns when at least one speaker carries
  // enrichment data, so non-enriched exports stay clean.
  const hasLinkedIn = speakers.some(
    (s) => s.linkedinUrl || s.linkedinStatus || typeof s.linkedinConfidence === 'number'
  );

  const speakerCols = [
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Designation', key: 'designation', width: 34 },
    { header: 'Company', key: 'company', width: 30 },
    { header: 'Profile URL', key: 'profileUrl', width: 40 },
  ];
  if (hasLinkedIn) {
    speakerCols.push(
      { header: 'LinkedIn Profile URL', key: 'linkedinUrl', width: 46 },
      { header: 'Confidence Score', key: 'linkedinConfidence', width: 16 },
      { header: 'Confidence Level', key: 'linkedinLevel', width: 16 },
      { header: 'Match Status', key: 'linkedinStatus', width: 22 }
    );
  }

  addSheet(
    wb,
    'Speakers',
    speakerCols,
    speakers.map((s) => ({
      name: s.name || '',
      designation: s.designation || '',
      company: s.company || '',
      profileUrl: s.profileUrl || '',
      ...(hasLinkedIn
        ? {
            linkedinUrl: s.linkedinUrl || '',
            // Percentage for readability; unresolved rows stay blank.
            linkedinConfidence: s.linkedinUrl ? `${Math.round((s.linkedinConfidence || 0) * 100)}%` : '',
            linkedinLevel: s.linkedinUrl ? s.linkedinLevel || '' : '',
            linkedinStatus: s.linkedinStatus || (s.linkedinUrl ? '' : 'Not Found'),
          }
        : {}),
    }))
  );

  addSheet(
    wb,
    'Companies',
    [
      { header: 'Company', key: 'company', width: 30 },
      { header: 'Category', key: 'category', width: 28 },
      { header: 'Website', key: 'website', width: 40 },
    ],
    companies.map((c) => ({ company: c.company || '', category: c.category || '', website: c.website || '' }))
  );

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Build a single-sheet workbook from arbitrary rows (preserving columns). */
export async function buildRowsWorkbook(rows = [], sheetName = 'Sheet1', headers) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Event Scraper';
  wb.created = new Date();
  const keys = headers && headers.length ? headers : rows.length ? Object.keys(rows[0]) : ['(empty)'];
  const cols = keys.map((h) => ({ header: String(h), key: String(h), width: Math.min(50, Math.max(14, String(h).length + 6)) }));
  addSheet(wb, sheetName, cols, rows);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Build a workbook of LinkedIn profiles from an X-ray search. Returns a Buffer. */
export async function buildProfilesWorkbook(rows = []) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Event Scraper';
  wb.created = new Date();
  addSheet(
    wb,
    'LinkedIn Profiles',
    [
      { header: 'Name', key: 'Name', width: 28 },
      { header: 'Designation', key: 'Designation', width: 40 },
      { header: 'Company', key: 'Company', width: 30 },
      { header: 'LinkedIn URL', key: 'LinkedIn URL', width: 50 },
    ],
    rows
  );
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Build the comparison workbook (returning + missing + full per-year lists). */
export async function buildComparisonWorkbook(comparison) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Conference Scraper';
  wb.created = new Date();
  const base = comparison.baseYear || comparison.summary?.baseYear || 'base';
  const target = comparison.targetYear || comparison.summary?.targetYear || 'target';

  const personCols = [
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Company', key: 'company', width: 30 },
    { header: 'Designation', key: 'designation', width: 34 },
  ];
  const companyCols = [
    { header: 'Company', key: 'company', width: 30 },
    { header: 'Category', key: 'category', width: 28 },
    { header: 'Website', key: 'website', width: 40 },
  ];

  addSheet(wb, 'People Coming Again', personCols, comparison.peopleAgain);
  addSheet(wb, 'Companies Coming Again', [{ header: 'Company', key: 'company', width: 32 }], comparison.companiesAgain);
  addSheet(wb, `People Missing In ${target}`, personCols, comparison.peopleMissing);
  addSheet(wb, `Companies Missing In ${target}`, [{ header: 'Company', key: 'company', width: 32 }], comparison.companiesMissing);

  // Separate full company lists per year, with partner tier/category.
  addSheet(wb, `Companies ${base}`, companyCols, comparison.baseCompanies || []);
  addSheet(wb, `Companies ${target}`, companyCols, comparison.targetCompanies || []);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
