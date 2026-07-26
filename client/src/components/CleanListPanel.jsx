import { useState } from 'react';
import { api } from '../api';

function bufToBase64(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(binary);
}

// Read one File → a payload the backend understands (CSV/TSV text, JSON rows, or xlsx base64).
async function fileToPayload(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.json')) {
    const data = JSON.parse(await file.text());
    return { rows: Array.isArray(data) ? data : data.rows || [] };
  }
  if (name.endsWith('.csv') || name.endsWith('.tsv') || file.type.includes('csv')) {
    return { csv: await file.text() };
  }
  return { fileBase64: bufToBase64(await file.arrayBuffer()) };
}

/** Dedupe a new list against your existing master list(s). Multi-file, multi-format. */
export default function CleanListPanel() {
  const [masterFiles, setMasterFiles] = useState([]);
  const [newFiles, setNewFiles] = useState([]);
  const [by, setBy] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function run() {
    setError('');
    setResult(null);
    if (!newFiles.length) return setError('Upload at least one new list to clean.');
    setBusy(true);
    try {
      const master = await Promise.all([...masterFiles].map(fileToPayload));
      const incoming = await Promise.all([...newFiles].map(fileToPayload));
      const data = await api.subtractLists({ master, incoming, by });
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="card animate-fade-up p-5 sm:p-6">
        <h2 className="card-title text-[15px]">Remove People You Already Have</h2>
        <p className="mt-1 text-sm text-dim">
          Upload your existing master list(s) and your new list(s) — the people already in your master are removed, and
          the new list is deduped against itself. Accepts CSV, XLSX, XLS and JSON (multiple files each).
        </p>

        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FileBucket
            label="Your existing master list(s) — people to exclude"
            files={masterFiles}
            setFiles={setMasterFiles}
          />
          <FileBucket
            label="New list(s) to clean"
            files={newFiles}
            setFiles={setNewFiles}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
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
            {busy ? 'Cleaning…' : 'Remove already-have'}
          </button>
        </div>

        {error && <p className="mt-3 text-sm font-medium text-[var(--danger)]">{error}</p>}

        {result && (
          <div className="mt-4 subpanel rounded-xl p-4">
            <p className="text-sm">
              <span className="font-bold text-[var(--success)]">{result.kept}</span> new unique people kept
              {' · '}
              <span className="font-semibold">{result.removedMaster}</span> already in your master
              {' · '}
              <span className="font-semibold">{result.removedDup}</span> internal duplicates
              {' '}
              <span className="text-dim">(matched by {result.keyBy})</span>.
            </p>
            <div className="mt-3 flex gap-2">
              <a href={result.downloadUrl} className="btn-secondary">Download Excel</a>
              <a href={result.csvUrl} className="btn-secondary">Download CSV</a>
            </div>
          </div>
        )}
      </div>

      {result?.rows?.length > 0 && (
        <div className="card animate-fade-up overflow-hidden">
          <div className="nice-scroll max-h-[30rem] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 thead-bg text-xs font-semibold uppercase tracking-wide text-dim">
                <tr>
                  {Object.keys(result.rows[0]).slice(0, 6).map((h) => (
                    <th key={h} className="px-4 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-token">
                {result.rows.map((r, i) => (
                  <tr key={i} className="transition row-hover">
                    {Object.keys(result.rows[0]).slice(0, 6).map((h) => (
                      <td key={h} className="px-4 py-2.5 text-dim">{String(r[h] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function FileBucket({ label, files, setFiles }) {
  return (
    <div>
      <span className="field-label">{label}</span>
      <input
        type="file"
        multiple
        accept=".csv,.tsv,.xlsx,.xls,.json,text/csv,application/json"
        onChange={(e) => setFiles(Array.from(e.target.files || []))}
        className="file-input"
      />
      {files.length > 0 && (
        <p className="mt-1.5 text-xs text-dim">{files.map((f) => f.name).join(', ')}</p>
      )}
    </div>
  );
}
