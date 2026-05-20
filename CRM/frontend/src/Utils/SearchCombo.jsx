// Generic searchable combobox — same visual + interaction model as
// CountryCombo (New warehouse modal) but accepts arbitrary options.
// Use for any long picker where a search box is more useful than a
// scroll-and-click list (shipping carrier, tax category, payment
// provider, etc.).
//
// Options shape: [{ value, label }] — `value` can be string or
// number; comparison is done via String(). `label` is the visible
// text shown both in the trigger button (when selected) and in the
// dropdown list.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CaretDown, MagnifyingGlass, Check } from '@phosphor-icons/react';

export function SearchCombo({ value, options, onChange, placeholder = 'Select…' }) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos]     = useState(null);
  const btnRef    = useRef(null);
  const popRef    = useRef(null);
  const searchRef = useRef(null);

  // Place popup directly below the trigger; re-measure on resize +
  // any ancestor scroll so the dropdown follows the field if the
  // modal body scrolls while open.
  const measure = () => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left, width: r.width });
  };

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open]);

  // Auto-focus search input so the user can start typing immediately.
  useEffect(() => {
    if (open) requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Reset query on close so re-open starts fresh.
  useEffect(() => { if (!open) setQuery(''); }, [open]);

  const selected = options.find(o => String(o.value) === String(value));
  const q = query.trim().toLowerCase();
  const filtered = !q
    ? options
    : options.filter(o => String(o.label).toLowerCase().includes(q));

  return (
    <>
      <button ref={btnRef} type="button"
        className={`po-combo-btn ${open ? 'po-combo-btn--open' : ''}`}
        onClick={() => setOpen(o => !o)}>
        {selected ? (
          <span className="po-combo-value">
            <span className="po-combo-name">{selected.label}</span>
          </span>
        ) : (
          <span className="po-combo-value po-combo-value--empty">{placeholder}</span>
        )}
        <CaretDown weight="bold" className="po-combo-caret" />
      </button>

      {open && pos && createPortal(
        <div ref={popRef} className="po-combo-pop"
          style={{ top: pos.top, left: pos.left, width: pos.width }}>
          <div className="po-combo-search">
            <MagnifyingGlass className="po-combo-search-icon" weight="bold" />
            <input ref={searchRef} className="po-combo-search-input"
              value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search…"
              onKeyDown={(e) => {
                // Enter picks the first filtered result — same UX
                // convention as Stripe / Shopify dashboards.
                if (e.key === 'Enter' && filtered[0]) {
                  onChange(filtered[0].value);
                  setOpen(false);
                  setQuery('');
                }
              }} />
          </div>
          <div className="po-combo-list">
            {filtered.length === 0 ? (
              <div className="po-combo-empty">No matches</div>
            ) : (
              filtered.map(o => {
                const on = selected && String(selected.value) === String(o.value);
                return (
                  <button key={String(o.value)} type="button"
                    className={`po-combo-item ${on ? 'po-combo-item--on' : ''}`}
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                      setQuery('');
                    }}>
                    <span className="po-combo-name">{o.label}</span>
                    {on && <Check weight="bold" className="po-combo-check" />}
                  </button>
                );
              })
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
