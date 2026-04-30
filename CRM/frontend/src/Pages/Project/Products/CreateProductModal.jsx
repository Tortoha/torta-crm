import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { X, CaretDown } from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { DynamicBlock } from '../../../Utils/DynamicBlock.js';

export default function CreateProductModal({ open, pq, onClose, onCreated }) {
  const [title,    setTitle]    = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [desc,     setDesc]     = useState('');
  const [catId,    setCatId]    = useState('');
  const [categories, setCategories] = useState([]);
  const [busy,     setBusy]     = useState(false);
  const [err,      setErr]      = useState('');

  useEffect(() => {
    if (!open) return;
    setTitle(''); setSubtitle(''); setDesc(''); setCatId('');
    setBusy(false); setErr('');
    fetch(`${API_BASE}/api/categories${pq}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setCategories(Array.isArray(d) ? d : []))
      .catch(() => setCategories([]));
  }, [open, pq]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async (e) => {
    e?.preventDefault();
    const t = title.trim();
    if (!t) return setErr('Title is required');
    setErr(''); setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/products${pq}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: t,
          subtitle: subtitle.trim() || null,
          description: desc.trim() || null,
          category_id: catId === '' ? null : Number(catId),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.detail || 'Create failed'); setBusy(false); return; }
      onCreated(data);
    } catch {
      setErr('Network error');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="auth-modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="auth-modal cpm-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">New product</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  Fill in basics now — you can add variations from the product page after creation.
                </span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body">
          <form className="cpm-form" onSubmit={submit} autoComplete="off">
            <div className="cpm-section">
              <label className="po-field-label">Title</label>
              <input className="crm-input" autoFocus value={title}
                autoComplete="off" spellCheck={false}
                onChange={e => setTitle(e.target.value)}
                placeholder="Product name" maxLength={200} />
            </div>
            <div className="cpm-section">
              <label className="po-field-label">Subtitle</label>
              <input className="crm-input" value={subtitle}
                autoComplete="off" spellCheck={false}
                onChange={e => setSubtitle(e.target.value)}
                placeholder="Short tagline shown under the title" maxLength={300} />
            </div>
            <div className="cpm-section">
              <label className="po-field-label">Description</label>
              <textarea className="crm-input cpm-textarea" rows={3} value={desc}
                autoComplete="off" spellCheck={false}
                onChange={e => setDesc(e.target.value)}
                placeholder="Long body text — materials, features…" />
            </div>
            <div className="cpm-section">
              <label className="po-field-label">Category</label>
              <CpmCategorySelect value={catId} categories={categories} onChange={setCatId} />
            </div>

            {err && <span className="crm-form-error">{err}</span>}

            <div className="auth-actions">
              <button className="crm-submit-btn" type="submit" disabled={busy}>
                {busy ? 'Creating…' : 'Create product'}
              </button>
              <button className="crm-submit-btn auth-btn-secondary" type="button" onClick={onClose}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Custom Category dropdown (replaces native <select>) ──────
function CpmCategorySelect({ value, categories, onChange }) {
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [hovered, setHovered] = useState(null);

  const activeKey = value === '' ? 'none' : `c:${value}`;
  const current = hovered ?? activeKey;
  const { indRef, setItemRef } = DynamicBlock(current, open);

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    // Match the trigger width but never let the dropdown spill past the
    // right edge of the viewport (or sit flush against either edge).
    const margin = 12;
    const width = Math.min(r.width, window.innerWidth - margin * 2);
    const maxLeft = window.innerWidth - width - margin;
    const left = Math.max(margin, Math.min(r.left, maxLeft));
    setPos({ top: r.bottom + 6, left, width });
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    const onPd  = e => {
      if (!e.target.closest?.('.cpm-cat-dropdown') && !btnRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPd);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPd);
    };
  }, [open]);

  const selected = value === ''
    ? null
    : categories.find(c => String(c.id) === String(value));
  const label = selected ? selected.name : 'Uncategorized';

  return (
    <>
      <button ref={btnRef} type="button"
        className={`cpm-cat-btn${open ? ' cpm-cat-btn--open' : ''}`}
        onClick={() => setOpen(v => !v)}>
        <span className={selected ? '' : 'cpm-cat-placeholder'}>{label}</span>
        <CaretDown weight="bold" className={`cpm-cat-caret${open ? ' cpm-cat-caret--up' : ''}`} />
      </button>
      {open && pos && createPortal(
        <div className="cat-filter-dropdown cpm-cat-dropdown"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          onMouseLeave={() => setHovered(null)}>
          <div ref={indRef} className="cat-filter-indicator" />
          <button ref={setItemRef('none')} type="button"
            className={`cat-filter-item${current === 'none' ? ' cat-filter-item--current' : ''}`}
            onMouseEnter={() => setHovered('none')}
            onClick={() => { onChange(''); setOpen(false); }}>
            Uncategorized
          </button>
          {categories.map(c => {
            const k = `c:${c.id}`;
            return (
              <button key={c.id} ref={setItemRef(k)} type="button"
                className={`cat-filter-item${current === k ? ' cat-filter-item--current' : ''}`}
                onMouseEnter={() => setHovered(k)}
                onClick={() => { onChange(String(c.id)); setOpen(false); }}>
                <span>{c.name}</span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
