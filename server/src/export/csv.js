/**
 * CSV export engine — dependency-free, RFC-4180-ish quoting.
 */

function escapeCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows, header) {
  const cols = header || (rows.length ? Object.keys(rows[0]) : []);
  const lines = [cols.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(cols.map((c) => escapeCell(row[c])).join(','));
  }
  return lines.join('\r\n');
}

export function speakersCsv(speakers = []) {
  return toCsv(
    speakers.map((s) => ({
      Name: s.name || '',
      Designation: s.designation || '',
      Company: s.company || '',
      'Profile URL': s.profileUrl || '',
    })),
    ['Name', 'Designation', 'Company', 'Profile URL']
  );
}

export function companiesCsv(companies = []) {
  return toCsv(
    companies.map((c) => ({
      Company: c.company || '',
      Category: c.category || '',
      Website: c.website || '',
    })),
    ['Company', 'Category', 'Website']
  );
}
