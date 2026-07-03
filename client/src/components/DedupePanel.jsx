import { useState } from 'react';
import { api } from '../api';

function bufToBase64(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Upload a CSV/Excel sheet and remove duplicate rows. */
export default function DedupePanel() {
  const [file, setFile] = useState(null);
  const [by, setBy] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function run() {
    setError('');
    setResult(null);
    if (!file) return setError('Choose a .csv or .xlsx file first.');
    setBusy(true);
    try {
      const isCsv = /\.csv$/i.test(file.name) || file.type.includes('csv');
      const body = { by };
      if (isCsv) body.csv = await file.text();
      else body.fileBase64 = bufToBase64(await file.arrayBuffer());
      const data = await api.dedupe(body);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card animate-fade-up p-5 sm:p-6">
      <h2 className="text-lg font-bold">Remove Duplicates from a Sheet</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Upload a CSV or Excel file and download a cleaned copy with duplicate rows removed.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="field-label">File (.csv or .xlsx)</span>
          <input
            type="file"
            accept=".csv,.xlsx,.xls,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-indigo-500"
          />
        </label>
        <label className="block">
          <span className="field-label">Match duplicates by</span>
          <select className="input" value={by} onChange={(e) => setBy(e.target.value)}>
            <option value="auto">Auto (LinkedIn URL if present)</option>
            <option value="linkedin">LinkedIn URL</option>
            <option value="name_company">Name + Company</option>
            <option value="name">Name only</option>
          </select>
        </label>
        <button onClick={run} disabled={busy} className="btn-primary">
          {busy ? 'Cleaning…' : 'Remove Duplicates'}
        </button>
      </div>

      {error && <p className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>}

      {result && (
        <div className="mt-4 rounded-xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/5">
          <p className="text-sm">
            <span className="font-bold text-emerald-600 dark:text-emerald-400">{result.removed}</span> duplicate(s) removed —{' '}
            <span className="font-bold">{result.unique}</span> of {result.original} rows kept{' '}
            <span className="text-slate-400">(matched by {result.keyBy})</span>.
          </p>
          <div className="mt-3 flex gap-2">
            <a href={result.downloadUrl} className="btn-secondary">Download Excel</a>
            <a href={result.csvUrl} className="btn-secondary">Download CSV</a>
          </div>
        </div>
      )}
    </div>
  );
}
