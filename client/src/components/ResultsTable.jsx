import { useState } from 'react';

export default function ResultsTable({ result, onEditLinkedIn }) {
  const [tab, setTab] = useState('speakers');
  if (!result) return null;

  const speakers = result.speakers || [];
  const companies = result.companies || [];
  const rows = tab === 'speakers' ? speakers : companies;
  // Show the LinkedIn column only when enrichment actually ran.
  const hasLinkedIn = speakers.some((s) => 'linkedinStatus' in s);
  const speakerCols = hasLinkedIn ? 4 : 3;

  return (
    <div className="card animate-fade-up overflow-hidden">
      <div className="flex gap-1 border-b border-slate-200/70 p-2 dark:border-white/10">
        {[
          ['speakers', `Speakers`, speakers.length],
          ['companies', `Partners`, companies.length],
        ].map(([key, label, n]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
              tab === key
                ? 'tab-active'
                : 'text-dim hover:bg-[var(--surface2)]'
            }`}
          >
            {label}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                tab === key ? 'bg-black/20' : 'bg-[var(--surface2)] text-dim'
              }`}
            >
              {n}
            </span>
          </button>
        ))}
      </div>

      <div className="nice-scroll max-h-[30rem] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 thead-bg text-xs font-semibold uppercase tracking-wide text-dim">
            {tab === 'speakers' ? (
              <tr>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Designation</th>
                <th className="px-4 py-2.5">Company</th>
                {hasLinkedIn && <th className="px-4 py-2.5">LinkedIn Profile</th>}
              </tr>
            ) : (
              <tr>
                <th className="px-4 py-2.5">Company</th>
                <th className="px-4 py-2.5">Category</th>
                <th className="px-4 py-2.5">Website</th>
              </tr>
            )}
          </thead>
          <tbody className="divide-y divide-token">
            {rows.length === 0 && (
              <tr>
                <td colSpan={tab === 'speakers' ? speakerCols : 3} className="px-4 py-10 text-center text-dim">
                  No {tab === 'speakers' ? 'speakers' : 'partners'} found.
                </td>
              </tr>
            )}
            {rows.map((r, i) =>
              tab === 'speakers' ? (
                <tr key={i} className="transition row-hover">
                  <td className="px-4 py-2.5 font-semibold">
                    {r.profileUrl && r.profileUrl !== 'javascript:' ? (
                      <a className="link-accent" href={r.profileUrl} target="_blank" rel="noreferrer">
                        {r.name}
                      </a>
                    ) : (
                      r.name
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-dim">{r.designation || '—'}</td>
                  <td className="px-4 py-2.5 text-dim">{r.company || '—'}</td>
                  {hasLinkedIn && (
                    <td className="px-4 py-2.5">
                      <LinkedInCell row={r} onEdit={(url) => onEditLinkedIn?.(i, url)} />
                    </td>
                  )}
                </tr>
              ) : (
                <tr key={i} className="transition row-hover">
                  <td className="px-4 py-2.5 font-semibold">{r.company}</td>
                  <td className="px-4 py-2.5 text-dim">
                    {r.category ? (
                      <span className="rounded-full chip">
                        {r.category}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.website ? (
                      <a className="link-accent" href={r.website} target="_blank" rel="noreferrer">
                        {r.website.replace(/^https?:\/\//, '').slice(0, 40)}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Short labels for the non-plain statuses, shown next to the badge.
const STATUS_NOTE = {
  'Multiple Possible Matches': 'multiple',
  'Verification Failed': 'unverified',
};

/** Editable LinkedIn URL + confidence badge + match status for one speaker. */
function LinkedInCell({ row, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.linkedinUrl || '');
  const url = row.linkedinUrl || '';
  const status = row.linkedinStatus || (url ? 'Found' : 'Not Found');
  const note = STATUS_NOTE[status];

  function commit() {
    setEditing(false);
    if (value.trim() !== (url || '')) onEdit(value.trim());
  }

  return (
    <div className="flex min-w-[17rem] items-center gap-2">
      <Badge confidence={row.linkedinConfidence} level={row.linkedinLevel} status={status} hasUrl={Boolean(url)} />
      {note && <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-[var(--warning)]">{note}</span>}
      {editing ? (
        <input
          autoFocus
          className="w-full input py-1 text-xs"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setValue(url);
              setEditing(false);
            }
          }}
          placeholder="https://www.linkedin.com/in/…"
        />
      ) : (
        <>
          {url ? (
            <a className="truncate text-xs link-accent" href={url} target="_blank" rel="noreferrer" title={url}>
              {url.replace(/^https?:\/\/(www\.)?linkedin\.com/, '')}
            </a>
          ) : (
            <span className="text-xs text-dim">—</span>
          )}
          <button
            onClick={() => {
              setValue(url);
              setEditing(true);
            }}
            className="ml-auto shrink-0 rounded-md px-2 py-0.5 text-xs font-medium text-dim transition hover:bg-[var(--surface2)] hover:text-main"
            title="Edit / replace LinkedIn URL"
          >
            Edit
          </button>
        </>
      )}
    </div>
  );
}

/** Color-coded confidence badge: High (90+) green, Medium (75–89) amber, Low red. */
function Badge({ confidence, level, status, hasUrl }) {
  if (!hasUrl || status === 'Not Found') {
    return <span className="shrink-0 rounded-full badge text-dim bg-[var(--surface2)] ">Not Found</span>;
  }
  const pct = Math.round((confidence || 0) * 100);
  const lvl = level || (pct >= 90 ? 'High' : pct >= 75 ? 'Medium' : 'Low');
  const cls = lvl === 'High' ? 'pill-success' : lvl === 'Medium' ? 'pill-warning' : 'pill-danger';
  return (
    <span className={`pill shrink-0 tabular-nums ${cls}`} title={`${status} · ${lvl} confidence`}>
      {pct}%
    </span>
  );
}
