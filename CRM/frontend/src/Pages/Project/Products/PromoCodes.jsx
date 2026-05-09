import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import {
  Plus, MagnifyingGlass, DotsThreeOutline, PencilSimple, Power, Trash,
  ArrowDown, SquaresFour, List, X,
} from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { Combobox, DatePicker, TimePicker } from '../Booking/BookingCreateModal.jsx';
import { CpmOptionSelect } from './CreateProductModal.jsx';
import { PoListRow } from '../../../Utils/PoListRow.jsx';
import { InteractiveSection } from '../../../Utils/InteractiveSection.js';
import '../../../Style/Authentication.css';
import '../../../Style/Products.css';
import '../../../Style/Organization.css';
import '../../../Style/Booking.css';   // bk-date-pop / bk-time-pop / wheel styles for DateTimePicker

const DISCOUNT_TYPE_OPTIONS = [
  { value: 'all',        label: 'All types' },
  { value: 'percentage', label: 'Percentage' },
  { value: 'fixed',      label: 'Fixed amount' },
];

const SORT_OPTIONS = [
  { field: 'code', label: 'Sort by code' },
  { field: 'date', label: 'Sort by date' },
  { field: 'used', label: 'Sort by usage' },
];
const SORT_DEFAULT_DIR = { code: 'asc', date: 'desc', used: 'desc' };

// Computed status of one code at "now" — used for the row badge.
function statusOf(c, now = new Date()) {
  if (!c.is_active) return 'inactive';
  if (c.valid_until && new Date(c.valid_until) < now) return 'expired';
  if (c.valid_from  && new Date(c.valid_from)  > now) return 'scheduled';
  return 'active';
}

const TILT = {
  maxAngle: 14, lerp: 0.05, lerpOut: 0.07,
  scale: 1.04, perspective: 700,
  gloss: { opacity: 0.16, spread: 50 },
};

export default function PromoCodes() {
  const { projectId } = useOutletContext();
  const pq = `?project_id=${projectId}`;
  const [codes, setCodes] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [typeF, setTypeF] = useState('all');
  const [sort, setSort] = useState({ field: 'date', dir: 'desc' });
  const [view, setView] = useState('list');
  const [viewHover, setViewHover] = useState(null);
  const curView = viewHover ?? view;
  const [editing, setEditing] = useState(null);   // null | 'new' | code object
  const [toast, setToast] = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2400); };

  const load = useCallback(async () => {
    const [c, cat] = await Promise.all([
      fetch(`${API_BASE}/api/promo-codes${pq}`, { credentials: 'include' }).then(r => r.ok ? r.json() : []),
      fetch(`${API_BASE}/api/categories${pq}`,  { credentials: 'include' }).then(r => r.ok ? r.json() : []),
    ]);
    setCodes(Array.isArray(c) ? c : []);
    setCategories(Array.isArray(cat) ? cat : []);
  }, [pq]);

  useEffect(() => { load(); }, [load]);

  const persist = async (body, id) => {
    const url = id
      ? `${API_BASE}/api/promo-codes/${id}${pq}`
      : `${API_BASE}/api/promo-codes${pq}`;
    const r = await fetch(url, {
      method: id ? 'PUT' : 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) { showToast(id ? 'Saved' : 'Created'); setEditing(null); load(); return true; }
    const j = await r.json().catch(() => ({}));
    showToast(j.detail || 'Failed');
    return false;
  };

  const remove = async (id) => {
    if (!confirm('Delete this promo code?')) return;
    const r = await fetch(`${API_BASE}/api/promo-codes/${id}${pq}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (r.ok) { showToast('Deleted'); load(); }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filt = codes.filter(c => {
      if (q && !(c.code || '').toLowerCase().includes(q)) return false;
      if (typeF !== 'all' && c.discount_type !== typeF) return false;
      return true;
    });
    const dir = sort.dir === 'asc' ? 1 : -1;
    filt.sort((a, b) => {
      let av, bv;
      if (sort.field === 'code') { av = (a.code || '').toLowerCase(); bv = (b.code || '').toLowerCase(); }
      else if (sort.field === 'date') { av = a.created_at || ''; bv = b.created_at || ''; }
      else { av = a.times_used || 0; bv = b.times_used || 0; }
      return av < bv ? -dir : av > bv ? dir : 0;
    });
    return filt;
  }, [codes, search, typeF, sort]);

  const handleSetSort = (field) => {
    setSort(prev => ({
      field,
      dir: field === prev.field ? (prev.dir === 'asc' ? 'desc' : 'asc') : (SORT_DEFAULT_DIR[field] || 'asc'),
    }));
  };

  return (
    <>
      {/* Hint sits directly under the page title — not under the toolbar. */}
      <p className="po-block-hint">
        Customer-facing promo codes — applied at checkout via{' '}
        <code className="po-api-code">POST /promo-code/apply</code>.
        Tier pricing (wholesale) is on the next tab.
      </p>

      <div className="org-toolbar">
        {/* Search ALWAYS on the left */}
        <div className="org-search-wrap">
          <MagnifyingGlass className="org-search-icon" />
          <input className="org-search-input" placeholder="Search codes…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {/* Right-side cluster: Sort toggle + View toggle + Type filter + New code */}
        <SortToggle sort={sort} onSort={handleSetSort} />

        <div className="po-cb-wrap po-cb-wrap--toolbar" style={{ width: 180, minWidth: 180 }}>
          <Combobox value={typeF} options={DISCOUNT_TYPE_OPTIONS}
            onChange={(v) => setTypeF(v)} />
        </div>

        <div className="org-view-toggle" onMouseLeave={() => setViewHover(null)}>
          <div className="org-view-indicator"
            style={{ transform: `translateX(${curView === 'list' ? 30 : 0}px)` }} />
          <button className={`org-view-btn${curView === 'grid' ? ' org-view-btn--current' : ''}`}
            onClick={() => setView('grid')} onMouseEnter={() => setViewHover('grid')}
            title="Grid view" type="button">
            <SquaresFour className="org-view-icon" />
          </button>
          <button className={`org-view-btn${curView === 'list' ? ' org-view-btn--current' : ''}`}
            onClick={() => setView('list')} onMouseEnter={() => setViewHover('list')}
            title="List view" type="button">
            <List className="org-view-icon" />
          </button>
        </div>

        <button type="button" className="org-new-btn" onClick={() => setEditing('new')}>
          <Plus className="org-new-icon" /> New code
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="crm-placeholder">{search || typeF !== 'all'
          ? 'No codes match your filters.' : 'No promo codes yet.'}
        </div>
      ) : view === 'list' ? (
        <div className="po-set-table">
          <div className="po-set-row po-set-row--head po-set-row--promo">
            <span>Code</span><span>Type</span><span>Value</span>
            <span>Min order</span><span>Used</span><span>Validity</span><span>Status</span><span></span>
          </div>
          {filtered.map(c => (
            <PromoRow key={c.id} code={c} categories={categories}
              onEdit={() => setEditing(c)}
              onDelete={() => remove(c.id)}
              onToggleActive={() => persist({ is_active: !c.is_active }, c.id)} />
          ))}
        </div>
      ) : (
        <div className="promo-grid">
          {filtered.map(c => (
            <PromoCard key={c.id} code={c} categories={categories}
              onEdit={() => setEditing(c)}
              onDelete={() => remove(c.id)}
              onToggleActive={() => persist({ is_active: !c.is_active }, c.id)} />
          ))}
        </div>
      )}

      {editing && (
        <PromoCodeModal
          code={editing === 'new' ? null : editing}
          categories={categories}
          onSave={(body) => persist(body, editing === 'new' ? null : editing.id)}
          onClose={() => setEditing(null)}
        />
      )}

      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
    </>
  );
}

// ── Sort toggle (mirrors Organization page) ──────────────────────────
function SortToggle({ sort, onSort }) {
  const indRef  = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);
  const curField = hovered ?? sort.field;

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el  = btnRefs.current[curField];
      if (!ind || !el) return;
      ind.style.opacity   = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width     = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [curField, sort.field]);

  return (
    <div className="org-sort-toggle" onMouseLeave={() => setHovered(null)}>
      <div ref={indRef} className="org-sort-indicator" />
      {SORT_OPTIONS.map(({ field, label }) => {
        const active = sort.field === field;
        const isCur  = curField === field;
        return (
          <button key={field} ref={el => { btnRefs.current[field] = el; }}
            className={`org-sort-btn${isCur ? ' org-sort-btn--current' : ''}`}
            style={active ? { paddingLeft: '6px' } : undefined}
            onMouseEnter={() => setHovered(field)}
            onClick={() => onSort(field)} type="button">
            {active && (
              <ArrowDown className="org-sort-icon"
                style={{ transform: sort.dir === 'asc' ? 'rotate(180deg)' : 'rotate(0deg)' }} />
            )}
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── Helpers shared between row + card ────────────────────────────────
function buildLabels(code) {
  const valueLabel = code.discount_type === 'percentage' ? `${code.discount_value}%` : `$${code.discount_value}`;
  const usedLabel = `${code.times_used}${code.usage_limit ? ` / ${code.usage_limit}` : ''}`;
  const f = code.valid_from  ? new Date(code.valid_from).toLocaleDateString()  : null;
  const t = code.valid_until ? new Date(code.valid_until).toLocaleDateString() : null;
  let validLabel;
  if (!f && !t) validLabel = 'Always';
  else if (f && t) validLabel = `${f} → ${t}`;
  else if (f)      validLabel = `From ${f}`;
  else             validLabel = `Until ${t}`;
  return { valueLabel, usedLabel, validLabel };
}

// ── Promo row (list view) — clickable, opens edit on row click ──────
function PromoRow({ code, categories, onEdit, onDelete, onToggleActive }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef(null);
  const status = statusOf(code);
  const { valueLabel, usedLabel, validLabel } = buildLabels(code);
  const catCount = (code.category_ids || []).length;

  return (
    <PoListRow className="po-set-row--promo" frozen={menuOpen}
      onClick={() => onEdit()} style={{ cursor: 'pointer' }}>
      <span className="po-set-strong">
        {code.code}
        {catCount > 0 && (
          <span className="promo-cat-tag" title={
            (code.category_ids || []).map(id =>
              categories.find(c => c.id === id)?.name || `#${id}`
            ).join(', ')
          }>
            {catCount} cat
          </span>
        )}
      </span>
      <span>{code.discount_type}</span>
      <span>{valueLabel}</span>
      <span>${code.min_order_amount || 0}</span>
      <span>{usedLabel}</span>
      <span className="po-set-note">{validLabel}</span>
      <span>
        <span className={`promo-status promo-status--${status}`}>{status}</span>
      </span>
      <button ref={menuBtnRef} type="button" className="org-list-menu-btn" aria-label="Options"
        onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}>
        <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
      </button>
      {menuOpen && (
        <PromoMenu code={code} btnRef={menuBtnRef}
          onClose={() => setMenuOpen(false)}
          onEdit={onEdit} onDelete={onDelete} onToggleActive={onToggleActive} />
      )}
    </PoListRow>
  );
}

// ── Promo card (grid view) — Organization-style 3D-tilt card ────────
function PromoCard({ code, categories, onEdit, onDelete, onToggleActive }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef(null);
  const { ref, glossRef, handlers } = InteractiveSection(TILT, menuOpen);
  const status = statusOf(code);
  const { valueLabel, usedLabel, validLabel } = buildLabels(code);
  const catCount = (code.category_ids || []).length;

  return (
    <div ref={ref} className={`promo-card${menuOpen ? ' promo-card--frozen' : ''}`}
      onClick={() => onEdit()} {...handlers}>
      <div ref={glossRef} className="promo-card-gloss" />

      <div className="promo-card-head">
        <span className="promo-card-code">{code.code}</span>
        <button ref={menuBtnRef} type="button" className="org-list-menu-btn"
          aria-label="Options"
          onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}>
          <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
        </button>
      </div>

      <div className="promo-card-value">{valueLabel}
        <span className="promo-card-type"> · {code.discount_type}</span>
      </div>

      <div className="promo-card-meta">
        <div className="promo-card-meta-row">
          <span className="promo-card-meta-label">Min order</span>
          <span>${code.min_order_amount || 0}</span>
        </div>
        <div className="promo-card-meta-row">
          <span className="promo-card-meta-label">Used</span>
          <span>{usedLabel}</span>
        </div>
        <div className="promo-card-meta-row">
          <span className="promo-card-meta-label">Validity</span>
          <span>{validLabel}</span>
        </div>
        {catCount > 0 && (
          <div className="promo-card-meta-row">
            <span className="promo-card-meta-label">Categories</span>
            <span>{catCount}</span>
          </div>
        )}
      </div>

      <div className="promo-card-foot">
        <span className={`promo-status promo-status--${status}`}>{status}</span>
      </div>

      {menuOpen && (
        <PromoMenu code={code} btnRef={menuBtnRef}
          onClose={() => setMenuOpen(false)}
          onEdit={onEdit} onDelete={onDelete} onToggleActive={onToggleActive} />
      )}
    </div>
  );
}

// Dropdown — portal'd to body so row overflow + tilt don't clip; positioned via getBoundingClientRect.
function PromoMenu({ code, btnRef, onClose, onEdit, onDelete, onToggleActive }) {
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: Math.max(8, r.right - 184) });
    }
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const onPd  = (e) => {
      if (!e.target.closest?.('.org-card-dropdown') && !btnRef.current?.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPd);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPd);
    };
  }, [btnRef, onClose]);

  if (!pos) return null;

  return createPortal(
    <div className="org-card-dropdown" style={{ top: pos.top, left: pos.left }}
      onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <button className="org-card-dropdown-item"
        onClick={() => { onClose(); onEdit(); }}>
        <PencilSimple className="org-card-dropdown-icon" /> Edit
      </button>
      <button className="org-card-dropdown-item"
        onClick={() => { onClose(); onToggleActive(); }}>
        <Power className="org-card-dropdown-icon" />
        {code.is_active ? 'Deactivate' : 'Activate'}
      </button>
      <div className="org-card-dropdown-sep" />
      <button className="org-card-dropdown-item org-card-dropdown-item--danger"
        onClick={() => { onClose(); onDelete(); }}>
        <Trash className="org-card-dropdown-icon" /> Delete
      </button>
    </div>,
    document.body,
  );
}

// ── Edit / Create modal — uses shared <Modal> shell (proper close button) ──
function PromoCodeModal({ code, categories, onSave, onClose }) {
  const isNew = !code;
  const [c, setC] = useState({
    code: code?.code || '',
    discount_type: code?.discount_type || 'percentage',
    discount_value: String(code?.discount_value ?? ''),
    min_order_amount: String(code?.min_order_amount ?? '0'),
    max_discount: code?.max_discount == null ? '' : String(code.max_discount),
    usage_limit: code?.usage_limit == null ? '' : String(code.usage_limit),
    per_user_limit: code?.per_user_limit == null ? '' : String(code.per_user_limit),
    valid_from: code?.valid_from ? code.valid_from.slice(0, 16) : '',
    valid_until: code?.valid_until ? code.valid_until.slice(0, 16) : '',
    is_active: code?.is_active ?? true,
    category_ids: code?.category_ids || [],
  });

  const update = (k, v) => setC(prev => ({ ...prev, [k]: v }));

  const submit = () => {
    const codeVal = c.code.trim().toUpperCase();
    if (!codeVal) return;
    onSave({
      code: codeVal,
      discount_type: c.discount_type,
      discount_value: parseFloat(c.discount_value) || 0,
      min_order_amount: parseFloat(c.min_order_amount) || 0,
      max_discount: c.max_discount === '' ? null : parseFloat(c.max_discount),
      usage_limit: c.usage_limit === '' ? null : parseInt(c.usage_limit, 10),
      per_user_limit: c.per_user_limit === '' ? null : parseInt(c.per_user_limit, 10),
      valid_from: c.valid_from || null,
      valid_until: c.valid_until || null,
      is_active: !!c.is_active,
      category_ids: c.category_ids,
    });
  };

  // Esc closes — same hook pattern as CreateProductModal.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Type options reused for the in-modal dropdown (without the "all" filter row).
  const TYPE_OPTIONS_FOR_MODAL = [
    { id: 'percentage', name: 'Percentage' },
    { id: 'fixed',      name: 'Fixed amount' },
  ];

  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">{isNew ? 'New promo code' : 'Edit promo code'}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {isNew
                    ? 'Configure the code now — customers apply it at checkout via /promo-code/apply.'
                    : `Editing ${code.code} — changes apply to future checkouts only.`}
                </span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body">
          <form className="cpm-form" onSubmit={(e) => { e.preventDefault(); submit(); }}
            autoComplete="off">

            <div className="cpm-section">
              <label className="po-field-label">Code</label>
              <input className="crm-input" autoFocus value={c.code}
                autoComplete="off" spellCheck={false} maxLength={40}
                placeholder="SUMMER20" onChange={(e) => update('code', e.target.value)} />
            </div>

            <div className="cpm-section">
              <label className="po-field-label">Type</label>
              <CpmOptionSelect value={c.discount_type} options={TYPE_OPTIONS_FOR_MODAL}
                onChange={(v) => update('discount_type', v)} />
            </div>

            <div className="cpm-section">
              <label className="po-field-label">Discount value</label>
              <input className="crm-input" type="number" min="0" step="0.01"
                placeholder={c.discount_type === 'percentage' ? '20' : '50'}
                value={c.discount_value} onChange={(e) => update('discount_value', e.target.value)} />
              <span className="cpm-section-hint">
                {c.discount_type === 'percentage' ? 'A percent value, 0–100' : 'Currency amount subtracted from cart total'}
              </span>
            </div>

            <div className="cpm-section">
              <label className="po-field-label">Min order amount</label>
              <input className="crm-input" type="number" min="0" step="0.01"
                placeholder="0" value={c.min_order_amount}
                onChange={(e) => update('min_order_amount', e.target.value)} />
            </div>

            {c.discount_type === 'percentage' && (
              <div className="cpm-section">
                <label className="po-field-label">Max discount</label>
                <input className="crm-input" type="number" min="0" step="0.01"
                  placeholder="No cap" value={c.max_discount}
                  onChange={(e) => update('max_discount', e.target.value)} />
                <span className="cpm-section-hint">Cap the absolute amount on percentage discounts</span>
              </div>
            )}

            <div className="cpm-section">
              <label className="po-field-label">Total usage limit</label>
              <input className="crm-input" type="number" min="1"
                placeholder="Unlimited" value={c.usage_limit}
                onChange={(e) => update('usage_limit', e.target.value)} />
              <span className="cpm-section-hint">Across all users; leave empty for unlimited</span>
            </div>

            <div className="cpm-section">
              <label className="po-field-label">Per-user limit</label>
              <input className="crm-input" type="number" min="1"
                placeholder="Unlimited" value={c.per_user_limit}
                onChange={(e) => update('per_user_limit', e.target.value)} />
              <span className="cpm-section-hint">Max times one user can apply this code</span>
            </div>

            <div className="cpm-section">
              <label className="po-field-label">Valid from</label>
              <DateTimePicker value={c.valid_from} onChange={(v) => update('valid_from', v)} />
              <span className="cpm-section-hint">Empty = effective immediately</span>
            </div>

            <div className="cpm-section">
              <label className="po-field-label">Valid until</label>
              <DateTimePicker value={c.valid_until} onChange={(v) => update('valid_until', v)} />
              <span className="cpm-section-hint">Empty = no expiry</span>
            </div>

            <CategoriesPicker
              categories={categories}
              selected={c.category_ids}
              onChange={(next) => update('category_ids', next)} />


            <div className="auth-actions">
              <button className="crm-submit-btn" type="submit">
                {isNew ? 'Create code' : 'Save changes'}
              </button>
              <button className="crm-submit-btn auth-btn-secondary" type="button" onClick={onClose}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// DateTimePicker — wraps Booking's DatePicker+TimePicker with "YYYY-MM-DDTHH:MM" wire format.
function DateTimePicker({ value, onChange }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const [datePart, timePart] = (value || '').includes('T')
    ? value.split('T')
    : [value || '', ''];

  const setDate = (d) => {
    if (!d) { onChange(''); return; }
    onChange(`${d}T${timePart || '00:00'}`);
  };
  const setTime = (t) => {
    if (!datePart) {
      // Default to today if user picks time first.
      const today = new Date().toISOString().slice(0, 10);
      onChange(`${today}T${t}`);
    } else {
      onChange(`${datePart}T${t}`);
    }
  };

  return (
    <div className="cpm-datetime-row">
      <DatePicker value={datePart} onChange={setDate} tz={tz} />
      <TimePicker value={timePart || '00:00'} onChange={setTime}
        slotInterval={15} />
    </div>
  );
}

// CategoriesPicker — list with default "All"; empty selected[] = catalog-wide.
function CategoriesPicker({ categories, selected, onChange }) {
  const [search, setSearch] = useState('');
  const allOn = !selected || selected.length === 0;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter(c => (c.name || '').toLowerCase().includes(q));
  }, [categories, search]);

  const toggleAll = () => {
    // Clicking "All" while specific cats are picked clears them; while on it's a no-op.
    if (!allOn) onChange([]);
  };

  const toggleCat = (cid) => {
    if (allOn) {
      // First specific selection — picks just this one.
      onChange([cid]);
      return;
    }
    if (selected.includes(cid)) {
      // Removing the last cat falls back to "All".
      onChange(selected.filter(x => x !== cid));
    } else {
      onChange([...selected, cid]);
    }
  };

  const selectedCount = allOn ? 'All categories' : `${selected.length} selected`;

  return (
    <div className="cat-prod-section">
      <div className="cat-prod-section-head">
        <label className="po-field-label" style={{ margin: 0 }}>Categories</label>
        <span className="cat-prod-count">{selectedCount}</span>
      </div>

      <span className="cpm-section-hint">
        "All" applies the code to every category. Pick specific ones to restrict —
        the cart must contain ONLY items from chosen categories for the code to apply.
      </span>

      {categories.length > 0 && (
        <div className="cat-prod-search-wrap">
          <MagnifyingGlass className="cat-prod-search-icon" />
          <input className="crm-input cat-prod-search-input"
            placeholder="Search categories…"
            value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>
      )}

      <div className="cat-prod-list">
        {categories.length === 0 ? (
          <p className="cat-prod-empty">No categories defined for this project yet.</p>
        ) : (
          <>
            {/* "All" pseudo-row — always first, default-checked. */}
            <label className={`cat-prod-row${allOn ? ' cat-prod-row--checked' : ''}`}>
              <input type="checkbox" className="cat-prod-checkbox"
                checked={allOn} onChange={toggleAll} />
              <span className="cat-prod-title" style={{ fontWeight: 500 }}>
                All categories
              </span>
              <span className="cat-prod-badge">Default</span>
            </label>

            {filtered.length === 0 && (
              <p className="cat-prod-empty">No categories match your search.</p>
            )}

            {filtered.map(cat => {
              const checked = !allOn && selected.includes(cat.id);
              return (
                <label key={cat.id}
                  className={`cat-prod-row${checked ? ' cat-prod-row--checked' : ''}`}>
                  <input type="checkbox" className="cat-prod-checkbox"
                    checked={checked} onChange={() => toggleCat(cat.id)} />
                  <span className="cat-prod-title">{cat.name}</span>
                </label>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
