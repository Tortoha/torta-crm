import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router-dom';
import {
  Plus, MagnifyingGlass, DotsThreeOutline, PencilSimple, Power, Trash,
  ArrowDown, SquaresFour, List, X,
} from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { useLiveReload } from '../../../Utils/useLiveReload.js';
import { todayLocalIsoDay } from '../../../Utils/date.js';
import { formatMoney } from '../../../Utils/currency.js';
import { Combobox, DatePicker, TimePicker } from '../Booking/BookingCreateModal.jsx';
import { CpmOptionSelect } from './CreateProductModal.jsx';
import { PoListRow } from '../../../Utils/PoListRow.jsx';
import { InteractiveSection } from '../../../Utils/InteractiveSection.js';
import { useInfiniteList } from '../../../Utils/useInfiniteList.js';
import { useInfiniteScroll } from '../../../Utils/useInfiniteScroll.js';
import '../../../Style/Authentication.css';
import '../../../Style/Products.css';
import '../../../Style/Organization.css';
import '../../../Style/Booking.css';   // bk-date-pop / bk-time-pop / wheel styles for DateTimePicker

const DISCOUNT_TYPE_OPTIONS = [
  { value: 'all',        labelKey: 'products.promo.typeAll' },
  { value: 'percentage', labelKey: 'products.promo.typePercentage' },
  { value: 'fixed',      labelKey: 'products.promo.typeFixed' },
];

const SORT_OPTIONS = [
  { field: 'code', labelKey: 'products.promo.sortByCode' },
  { field: 'date', labelKey: 'products.promo.sortByDate' },
  { field: 'used', labelKey: 'products.promo.sortByUsage' },
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
  const { t } = useTranslation();
  const { projectId, project } = useOutletContext();
  const pq = `?project_id=${projectId}`;
  // Project currency drives how promo amounts (Min order, $-off
  // discount values) are rendered in both the list and the cards.
  const currency = project?.currency || 'USD';
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

  const {
    items: codes, hasMore, loading, loadMore, reload: load,
  } = useInfiniteList({
    url: `${API_BASE}/api/promo-codes${pq}`,
    pageSize: 100,
  });
  const sentinelRef = useInfiniteScroll(loadMore);
  // Live collaboration: teammates' promo create / edit / delete refetch here.
  useLiveReload(projectId, 'promo_changed', load);

  useEffect(() => {
    fetch(`${API_BASE}/api/categories${pq}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setCategories(Array.isArray(d) ? d : []));
  }, [pq]);

  const persist = async (body, id) => {
    const url = id
      ? `${API_BASE}/api/promo-codes/${id}${pq}`
      : `${API_BASE}/api/promo-codes${pq}`;
    const r = await fetch(url, {
      method: id ? 'PUT' : 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) { showToast(id ? t('products.promo.toast.saved') : t('products.promo.toast.created')); setEditing(null); load(); return true; }
    const j = await r.json().catch(() => ({}));
    showToast(j.detail || t('products.promo.toast.failed'));
    return false;
  };

  const remove = async (id) => {
    if (!confirm(t('products.promo.confirmDelete'))) return;
    const r = await fetch(`${API_BASE}/api/promo-codes/${id}${pq}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (r.ok) { showToast(t('products.promo.toast.deleted')); load(); }
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
        {t('products.promo.hintPrefix')}{' '}
        <code className="po-api-code">POST /promo-code/apply</code>.{' '}
        {t('products.promo.hintSuffix')}
      </p>

      <div className="org-toolbar">
        {/* Search ALWAYS on the left */}
        <div className="org-search-wrap">
          <MagnifyingGlass className="org-search-icon" />
          <input className="org-search-input" placeholder={t('products.promo.searchPlaceholder')}
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {/* Right-side cluster: Sort toggle + View toggle + Type filter + New code */}
        <SortToggle sort={sort} onSort={handleSetSort} />

        <div className="po-cb-wrap po-cb-wrap--toolbar" style={{ width: 180, minWidth: 180 }}>
          <Combobox value={typeF} options={DISCOUNT_TYPE_OPTIONS.map(o => ({ value: o.value, label: t(o.labelKey) }))}
            onChange={(v) => setTypeF(v)} />
        </div>

        <div className="org-view-toggle" onMouseLeave={() => setViewHover(null)}>
          <div className="org-view-indicator"
            style={{ transform: `translateX(${curView === 'list' ? 30 : 0}px)` }} />
          <button className={`org-view-btn${curView === 'grid' ? ' org-view-btn--current' : ''}`}
            onClick={() => setView('grid')} onMouseEnter={() => setViewHover('grid')}
            title={t('products.promo.gridView')} type="button">
            <SquaresFour className="org-view-icon" />
          </button>
          <button className={`org-view-btn${curView === 'list' ? ' org-view-btn--current' : ''}`}
            onClick={() => setView('list')} onMouseEnter={() => setViewHover('list')}
            title={t('products.promo.listView')} type="button">
            <List className="org-view-icon" />
          </button>
        </div>

        <button type="button" className="org-new-btn" onClick={() => setEditing('new')}>
          <Plus className="org-new-icon" /> {t('products.promo.newCode')}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="crm-placeholder">{search || typeF !== 'all'
          ? t('products.promo.noMatch') : t('products.promo.empty')}
        </div>
      ) : view === 'list' ? (
        <div className="po-set-table">
          <div className="po-set-row po-set-row--head po-set-row--promo">
            <span>{t('products.promo.colCode')}</span><span>{t('products.promo.colType')}</span><span>{t('products.promo.colValue')}</span>
            <span>{t('products.promo.colMinOrder')}</span><span>{t('products.promo.colUsed')}</span><span>{t('products.promo.colValidity')}</span><span>{t('products.promo.colStatus')}</span><span></span>
          </div>
          {filtered.map(c => (
            <PromoRow key={c.id} code={c} categories={categories} currency={currency}
              onEdit={() => setEditing(c)}
              onDelete={() => remove(c.id)}
              onToggleActive={() => persist({ is_active: !c.is_active }, c.id)} />
          ))}
          {hasMore && <div ref={sentinelRef} className="inf-sentinel">{t('products.promo.loadingMore')}</div>}
        </div>
      ) : (
        <div className="promo-grid">
          {filtered.map(c => (
            <PromoCard key={c.id} code={c} categories={categories} currency={currency}
              onEdit={() => setEditing(c)}
              onDelete={() => remove(c.id)}
              onToggleActive={() => persist({ is_active: !c.is_active }, c.id)} />
          ))}
          {hasMore && <div ref={sentinelRef} className="inf-sentinel">{t('products.promo.loadingMore')}</div>}
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
  const { t } = useTranslation();
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
      {SORT_OPTIONS.map(({ field, labelKey }) => {
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
            {t(labelKey)}
          </button>
        );
      })}
    </div>
  );
}

// ── Helpers shared between row + card ────────────────────────────────
// `currency` is the project's currency code (e.g. 'USD', 'KZT'). Pass-
// through so promo discount values render in the merchant's chosen
// currency (a 10₸ off coupon should NOT show as "$10").
function buildLabels(code, currency = 'USD', t = (k) => k) {
  const valueLabel = code.discount_type === 'percentage'
    ? `${code.discount_value}%`
    : formatMoney(code.discount_value, currency);
  const usedLabel = `${code.times_used}${code.usage_limit ? ` / ${code.usage_limit}` : ''}`;
  const f = code.valid_from  ? new Date(code.valid_from).toLocaleDateString()  : null;
  const u = code.valid_until ? new Date(code.valid_until).toLocaleDateString() : null;
  let validLabel;
  if (!f && !u) validLabel = t('products.promo.always');
  else if (f && u) validLabel = `${f} → ${u}`;
  else if (f)      validLabel = t('products.promo.from', { date: f });
  else             validLabel = t('products.promo.until', { date: u });
  return { valueLabel, usedLabel, validLabel };
}

// ── Promo row (list view) — clickable, opens edit on row click ──────
function PromoRow({ code, categories, currency, onEdit, onDelete, onToggleActive }) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef(null);
  const status = statusOf(code);
  const { valueLabel, usedLabel, validLabel } = buildLabels(code, currency, t);
  const catCount = (code.category_ids || []).length;
  const typeLabel = code.discount_type === 'percentage' ? t('products.promo.typePercentage') : t('products.promo.typeFixed');
  const statusLabel = t(`products.promo.status${status.charAt(0).toUpperCase()}${status.slice(1)}`);

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
            {t('products.promo.catTag', { count: catCount })}
          </span>
        )}
      </span>
      <span>{typeLabel}</span>
      <span>{valueLabel}</span>
      <span>{formatMoney(code.min_order_amount || 0, currency)}</span>
      <span>{usedLabel}</span>
      <span className="po-set-note">{validLabel}</span>
      <span>
        <span className={`promo-status promo-status--${status}`}>{statusLabel}</span>
      </span>
      <button ref={menuBtnRef} type="button" className="org-list-menu-btn" aria-label={t('products.promo.options')}
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
function PromoCard({ code, categories, currency, onEdit, onDelete, onToggleActive }) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef(null);
  const { ref, glossRef, handlers } = InteractiveSection(TILT, menuOpen);
  const status = statusOf(code);
  const { valueLabel, usedLabel, validLabel } = buildLabels(code, currency, t);
  const catCount = (code.category_ids || []).length;
  const typeLabel = code.discount_type === 'percentage' ? t('products.promo.typePercentage') : t('products.promo.typeFixed');
  const statusLabel = t(`products.promo.status${status.charAt(0).toUpperCase()}${status.slice(1)}`);

  return (
    <div ref={ref} className={`promo-card${menuOpen ? ' promo-card--frozen' : ''}`}
      onClick={() => onEdit()} {...handlers}>
      <div ref={glossRef} className="promo-card-gloss" />

      <div className="promo-card-head">
        <span className="promo-card-code">{code.code}</span>
        <button ref={menuBtnRef} type="button" className="org-list-menu-btn"
          aria-label={t('products.promo.options')}
          onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}>
          <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
        </button>
      </div>

      <div className="promo-card-value">{valueLabel}
        <span className="promo-card-type"> · {typeLabel}</span>
      </div>

      <div className="promo-card-meta">
        <div className="promo-card-meta-row">
          <span className="promo-card-meta-label">{t('products.promo.minOrder')}</span>
          <span>{formatMoney(code.min_order_amount || 0, currency)}</span>
        </div>
        <div className="promo-card-meta-row">
          <span className="promo-card-meta-label">{t('products.promo.used')}</span>
          <span>{usedLabel}</span>
        </div>
        <div className="promo-card-meta-row">
          <span className="promo-card-meta-label">{t('products.promo.validity')}</span>
          <span>{validLabel}</span>
        </div>
        {catCount > 0 && (
          <div className="promo-card-meta-row">
            <span className="promo-card-meta-label">{t('products.promo.categories')}</span>
            <span>{catCount}</span>
          </div>
        )}
      </div>

      <div className="promo-card-foot">
        <span className={`promo-status promo-status--${status}`}>{statusLabel}</span>
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
  const { t } = useTranslation();
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
        <PencilSimple className="org-card-dropdown-icon" /> {t('products.promo.menu.edit')}
      </button>
      <button className="org-card-dropdown-item"
        onClick={() => { onClose(); onToggleActive(); }}>
        <Power className="org-card-dropdown-icon" />
        {code.is_active ? t('products.promo.menu.deactivate') : t('products.promo.menu.activate')}
      </button>
      <div className="org-card-dropdown-sep" />
      <button className="org-card-dropdown-item org-card-dropdown-item--danger"
        onClick={() => { onClose(); onDelete(); }}>
        <Trash className="org-card-dropdown-icon" /> {t('products.promo.menu.delete')}
      </button>
    </div>,
    document.body,
  );
}

// ── Edit / Create modal — uses shared <Modal> shell (proper close button) ──
function PromoCodeModal({ code, categories, onSave, onClose }) {
  const { t } = useTranslation();
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
    { id: 'percentage', name: t('products.promo.modal.typePercentage') },
    { id: 'fixed',      name: t('products.promo.modal.typeFixed') },
  ];

  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">{isNew ? t('products.promo.modal.newTitle') : t('products.promo.modal.editTitle')}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {isNew
                    ? t('products.promo.modal.newSubtitle')
                    : t('products.promo.modal.editSubtitle', { code: code.code })}
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
              <label className="po-field-label">{t('products.promo.modal.code')}</label>
              <input className="crm-input" autoFocus value={c.code}
                autoComplete="off" spellCheck={false} maxLength={40}
                placeholder="SUMMER20" onChange={(e) => update('code', e.target.value)} />
            </div>

            <div className="cpm-section">
              <label className="po-field-label">{t('products.promo.modal.type')}</label>
              <CpmOptionSelect value={c.discount_type} options={TYPE_OPTIONS_FOR_MODAL}
                onChange={(v) => update('discount_type', v)} />
            </div>

            <div className="cpm-section">
              <label className="po-field-label">{t('products.promo.modal.discountValue')}</label>
              <input className="crm-input" type="number" min="0" step="0.01"
                placeholder={c.discount_type === 'percentage' ? '20' : '50'}
                value={c.discount_value} onChange={(e) => update('discount_value', e.target.value)} />
              <span className="cpm-section-hint">
                {c.discount_type === 'percentage' ? t('products.promo.modal.discountHintPercentage') : t('products.promo.modal.discountHintFixed')}
              </span>
            </div>

            <div className="cpm-section">
              <label className="po-field-label">{t('products.promo.modal.minOrderAmount')}</label>
              <input className="crm-input" type="number" min="0" step="0.01"
                placeholder="0" value={c.min_order_amount}
                onChange={(e) => update('min_order_amount', e.target.value)} />
            </div>

            {c.discount_type === 'percentage' && (
              <div className="cpm-section">
                <label className="po-field-label">{t('products.promo.modal.maxDiscount')}</label>
                <input className="crm-input" type="number" min="0" step="0.01"
                  placeholder={t('products.promo.modal.maxDiscountPlaceholder')} value={c.max_discount}
                  onChange={(e) => update('max_discount', e.target.value)} />
                <span className="cpm-section-hint">{t('products.promo.modal.maxDiscountHint')}</span>
              </div>
            )}

            <div className="cpm-section">
              <label className="po-field-label">{t('products.promo.modal.usageLimit')}</label>
              <input className="crm-input" type="number" min="1"
                placeholder={t('products.promo.modal.unlimited')} value={c.usage_limit}
                onChange={(e) => update('usage_limit', e.target.value)} />
              <span className="cpm-section-hint">{t('products.promo.modal.usageLimitHint')}</span>
            </div>

            <div className="cpm-section">
              <label className="po-field-label">{t('products.promo.modal.perUserLimit')}</label>
              <input className="crm-input" type="number" min="1"
                placeholder={t('products.promo.modal.unlimited')} value={c.per_user_limit}
                onChange={(e) => update('per_user_limit', e.target.value)} />
              <span className="cpm-section-hint">{t('products.promo.modal.perUserLimitHint')}</span>
            </div>

            <div className="cpm-section">
              <label className="po-field-label">{t('products.promo.modal.validFrom')}</label>
              <DateTimePicker value={c.valid_from} onChange={(v) => update('valid_from', v)} />
              <span className="cpm-section-hint">{t('products.promo.modal.validFromHint')}</span>
            </div>

            <div className="cpm-section">
              <label className="po-field-label">{t('products.promo.modal.validUntil')}</label>
              <DateTimePicker value={c.valid_until} onChange={(v) => update('valid_until', v)} />
              <span className="cpm-section-hint">{t('products.promo.modal.validUntilHint')}</span>
            </div>

            <CategoriesPicker
              categories={categories}
              selected={c.category_ids}
              onChange={(next) => update('category_ids', next)} />


            <div className="auth-actions">
              <button className="crm-submit-btn" type="submit">
                {isNew ? t('products.promo.modal.createCode') : t('products.promo.modal.saveChanges')}
              </button>
              <button className="crm-submit-btn auth-btn-secondary" type="button" onClick={onClose}>
                {t('products.promo.modal.cancel')}
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
      // Default to today if user picks time first. Use local date components —
      // toISOString() would roll to the wrong day for users east of UTC.
      onChange(`${todayLocalIsoDay()}T${t}`);
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
  const { t } = useTranslation();
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

  const selectedCount = allOn ? t('products.promo.categoriesPicker.allCategories') : t('products.promo.categoriesPicker.selected', { count: selected.length });

  return (
    <div className="cat-prod-section">
      <div className="cat-prod-section-head">
        <label className="po-field-label" style={{ margin: 0 }}>{t('products.promo.categoriesPicker.categories')}</label>
        <span className="cat-prod-count">{selectedCount}</span>
      </div>

      <span className="cpm-section-hint">
        {t('products.promo.categoriesPicker.hint')}
      </span>

      {categories.length > 0 && (
        <div className="cat-prod-search-wrap">
          <MagnifyingGlass className="cat-prod-search-icon" />
          <input className="crm-input cat-prod-search-input"
            placeholder={t('products.promo.categoriesPicker.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>
      )}

      <div className="cat-prod-list">
        {categories.length === 0 ? (
          <p className="cat-prod-empty">{t('products.promo.categoriesPicker.empty')}</p>
        ) : (
          <>
            {/* "All" pseudo-row — always first, default-checked. */}
            <label className={`cat-prod-row${allOn ? ' cat-prod-row--checked' : ''}`}>
              <input type="checkbox" className="cat-prod-checkbox"
                checked={allOn} onChange={toggleAll} />
              <span className="cat-prod-title" style={{ fontWeight: 500 }}>
                {t('products.promo.categoriesPicker.allCategories')}
              </span>
              <span className="cat-prod-badge">{t('products.promo.categoriesPicker.default')}</span>
            </label>

            {filtered.length === 0 && (
              <p className="cat-prod-empty">{t('products.promo.categoriesPicker.noMatch')}</p>
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
