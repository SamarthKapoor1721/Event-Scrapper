import { useEffect, useRef, useState } from 'react';

/**
 * Searchable multi-select: type to filter presets, click to add (or add a custom
 * value), chosen values shown as removable chips. Replaces the native <select>.
 */
export default function Picker({ label, options = [], values, setValues, placeholder = 'Search or add…' }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const q = query.trim().toLowerCase();
  const chosen = new Set(values.map((v) => v.toLowerCase()));
  const filtered = options.filter((o) => !chosen.has(o.toLowerCase()) && (!q || o.toLowerCase().includes(q)));
  const canAddCustom = q && !options.some((o) => o.toLowerCase() === q) && !chosen.has(q);
  const list = canAddCustom ? [{ custom: true, value: query.trim() }, ...filtered.map((o) => ({ value: o }))] : filtered.map((o) => ({ value: o }));

  function add(v) {
    const t = (v || '').trim();
    if (t && !chosen.has(t.toLowerCase())) setValues([...values, t]);
    setQuery('');
    setHi(0);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (list[hi]) add(list[hi].value);
      else if (query.trim()) add(query);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHi((h) => Math.min(h + 1, list.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Backspace' && !query && values.length) {
      setValues(values.slice(0, -1));
    }
  }

  return (
    <div ref={ref} className="relative">
      <span className="field-label">{label}</span>
      {values.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1.5 rounded-lg chip"
            >
              {v}
              <button type="button" onClick={() => setValues(values.filter((x) => x !== v))} className="chip-x" title={`Remove ${v}`}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <svg className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="9" cy="9" r="6" />
          <path d="M14 14l3 3" strokeLinecap="round" />
        </svg>
        <input
          className="input pl-10"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setHi(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
        />
      </div>

      {open && list.length > 0 && (
        <div
          className="nice-scroll absolute z-30 mt-1.5 max-h-64 w-full overflow-auto rounded-xl p-1.5 shadow-xl"
          style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}
        >
          {list.map((item, i) => (
            <button
              key={item.value + i}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHi(i)}
              onClick={() => add(item.value)}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm transition"
              style={{
                background: i === hi ? 'var(--accent)' : 'transparent',
                color: i === hi ? 'var(--accent-ink)' : 'var(--text)',
              }}
            >
              {item.custom ? (
                <span>
                  <span className="font-semibold" style={{ color: i === hi ? 'var(--accent-ink)' : 'var(--accent)' }}>
                    + Add
                  </span>{' '}
                  “{item.value}”
                </span>
              ) : (
                item.value
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
