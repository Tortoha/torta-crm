import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CaretDown, MagnifyingGlass, Check } from '@phosphor-icons/react';
import { COUNTRIES, findCountryByName, flagEmoji } from './countries.js';

export function CountryCombo({ value, onChange, placeholder = 'Select country' }) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos]     = useState(null);   // { top, left, width }
  const btnRef    = useRef(null);
  const popRef    = useRef(null);
  const searchRef = useRef(null);

  // Re-measure trigger and place popup directly below it; called on open / scroll / resize.
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
    // useCapture: true so we catch scroll on any ancestor (incl. modal body)
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open]);

  // Auto-focus the search input the moment the popup mounts.
  useEffect(() => {
    if (open) requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  // Close on outside click + Escape; clicks inside trigger/popup are ignored.
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

  const selected = findCountryByName(value);
  const q = query.trim().toLowerCase();
  // Match by name OR by exact ISO-2 code so power-users can type "us"/"de".
  const filtered = !q
    ? COUNTRIES
    : COUNTRIES.filter(c =>
        c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q
      );

  return (
    <>
      <button ref={btnRef} type="button"
        className={`po-combo-btn ${open ? 'po-combo-btn--open' : ''}`}
        onClick={() => setOpen(o => !o)}>
        {selected ? (
          <span className="po-combo-value">
            <span className="po-combo-flag">{flagEmoji(selected.code)}</span>
            <span className="po-combo-name">{selected.name}</span>
          </span>
        ) : value ? (
          // Legacy free-text value (no flag). Still display it.
          <span className="po-combo-value">
            <span className="po-combo-name">{value}</span>
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
              placeholder="Search countries…" />
          </div>
          <div className="po-combo-list">
            {filtered.length === 0 ? (
              <div className="po-combo-empty">No matches</div>
            ) : (
              filtered.map(c => {
                const on = selected?.code === c.code;
                return (
                  <button key={c.code} type="button"
                    className={`po-combo-item ${on ? 'po-combo-item--on' : ''}`}
                    onClick={() => {
                      onChange(c.name);
                      setOpen(false);
                      setQuery('');
                    }}>
                    <span className="po-combo-flag">{flagEmoji(c.code)}</span>
                    <span className="po-combo-name">{c.name}</span>
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
