// Warehouses tab — CRUD for project warehouses (default selection + structured address); layout mirrors Promo Codes.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router-dom';
import {
  Plus, MagnifyingGlass, DotsThreeOutline, PencilSimple, Power, Trash,
  ArrowDown, SquaresFour, List, Star, X,
} from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { Combobox } from '../Booking/BookingCreateModal.jsx';
import { PoListRow } from '../../../Utils/PoListRow.jsx';
import { CountryCombo } from '../../../Utils/CountryCombo.jsx';
import { InteractiveSection } from '../../../Utils/InteractiveSection.js';
import '../../../Style/Authentication.css';
import '../../../Style/Products.css';
import '../../../Style/Organization.css';

// Status filter options for the toolbar combobox.
const STATUS_OPTIONS = [
  { value: 'all',      labelKey: 'products.warehouses.statusAll' },
  { value: 'active',   labelKey: 'products.warehouses.statusActive' },
  { value: 'inactive', labelKey: 'products.warehouses.statusInactive' },
];

// Sort options mirror Promo Codes; defaults are intuitive per field (alpha asc, dates desc).
const SORT_OPTIONS = [
  { field: 'name', labelKey: 'products.warehouses.sortByName' },
  { field: 'code', labelKey: 'products.warehouses.sortByCode' },
  { field: 'date', labelKey: 'products.warehouses.sortByDate' },
];
const SORT_DEFAULT_DIR = { name: 'asc', code: 'asc', date: 'desc' };

const TILT = {
  maxAngle: 14, lerp: 0.05, lerpOut: 0.07,
  scale: 1.04, perspective: 700,
  gloss: { opacity: 0.16, spread: 50 },
};

// Status badge — warehouses are simply active/inactive (no expiry/scheduling).
function statusOf(w) {
  return w.is_active ? 'active' : 'inactive';
}

// Single-line address; falls back to legacy free-form `address` column if structured fields are empty.
function formatAddress(w) {
  const parts = [w.street, w.city, w.region, w.postal_code, w.country]
    .map(s => (s || '').trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : (w.address || '');
}

// "City, Country" — compact location column; falls back to whichever half exists, then formatAddress.
function shortLocation(w) {
  const city    = (w.city    || '').trim();
  const country = (w.country || '').trim();
  if (city && country) return `${city}, ${country}`;
  return city || country || formatAddress(w);
}

export default function Warehouses() {
  const { t } = useTranslation();
  const { projectId } = useOutletContext();
  const pq = `?project_id=${projectId}`;
  const [list, setList] = useState([]);
  const [search, setSearch] = useState('');
  const [statusF, setStatusF] = useState('all');
  // Default name-asc — warehouses are a small hand-curated set, alpha is natural.
  const [sort, setSort] = useState({ field: 'name', dir: 'asc' });
  const [view, setView] = useState('list');
  const [viewHover, setViewHover] = useState(null);
  const curView = viewHover ?? view;
  const [editing, setEditing] = useState(null);   // null | 'new' | warehouse object
  const [toast, setToast] = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2400); };

  const load = useCallback(async () => {
    const r = await fetch(`${API_BASE}/api/warehouses${pq}`, { credentials: 'include' });
    if (r.ok) setList(await r.json());
  }, [pq]);

  useEffect(() => { load(); }, [load]);

  // Single create/update path — POST when id is null, PUT otherwise.
  const persist = async (body, id) => {
    const url = id
      ? `${API_BASE}/api/warehouses/${id}${pq}`
      : `${API_BASE}/api/warehouses${pq}`;
    const r = await fetch(url, {
      method: id ? 'PUT' : 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) { showToast(id ? t('products.warehouses.toast.saved') : t('products.warehouses.toast.created')); setEditing(null); load(); return true; }
    const j = await r.json().catch(() => ({}));
    showToast(j.detail || t('products.warehouses.toast.failed'));
    return false;
  };

  // Lightweight inline updates (Make default, toggle Active) — single-field PUT, no modal.
  const patch = async (id, body) => {
    const r = await fetch(`${API_BASE}/api/warehouses/${id}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) { load(); }
    else { const j = await r.json().catch(() => ({})); showToast(j.detail || t('products.warehouses.toast.failed')); }
  };

  const remove = async (id) => {
    if (!confirm(t('products.warehouses.confirmDelete'))) return;
    const r = await fetch(`${API_BASE}/api/warehouses/${id}${pq}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (r.ok) { showToast(t('products.warehouses.toast.deleted')); load(); }
    else { const j = await r.json().catch(() => ({})); showToast(j.detail || t('products.warehouses.toast.failed')); }
  };

  // Filter+sort. Search matches name/code/any address field (so "Berlin" finds a "EU" warehouse).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filt = list.filter(w => {
      if (statusF === 'active'   && !w.is_active) return false;
      if (statusF === 'inactive' &&  w.is_active) return false;
      if (q) {
        const hay = [
          w.name, w.code, w.city, w.country, w.region,
          w.street, w.postal_code, w.contact_name,
        ].map(s => (s || '').toLowerCase()).join(' ');
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const dir = sort.dir === 'asc' ? 1 : -1;
    filt.sort((a, b) => {
      // Default warehouse always pinned top — operational anchor, users expect it first.
      if (a.is_default && !b.is_default) return -1;
      if (!a.is_default && b.is_default) return 1;
      let av, bv;
      if (sort.field === 'name')      { av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase(); }
      else if (sort.field === 'code') { av = (a.code || '').toLowerCase(); bv = (b.code || '').toLowerCase(); }
      else                            { av = a.created_at || '';            bv = b.created_at || ''; }
      return av < bv ? -dir : av > bv ? dir : 0;
    });
    return filt;
  }, [list, search, statusF, sort]);

  const handleSetSort = (field) => {
    setSort(prev => ({
      field,
      dir: field === prev.field
        ? (prev.dir === 'asc' ? 'desc' : 'asc')
        : (SORT_DEFAULT_DIR[field] || 'asc'),
    }));
  };

  return (
    <>
      {/* Hint directly under page title — same pattern as Promo Codes / Tier Pricing. */}
      <p className="po-block-hint">
        {t('products.warehouses.hintPrefix')} <code className="po-api-code">stock_quantity</code> {t('products.warehouses.hintSuffix')}
      </p>

      <div className="org-toolbar">
        {/* Search ALWAYS on the left. */}
        <div className="org-search-wrap">
          <MagnifyingGlass className="org-search-icon" />
          <input className="org-search-input" placeholder={t('products.warehouses.searchPlaceholder')}
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {/* Right-side cluster: Sort + Status filter + View toggle + New btn. */}
        <SortToggle sort={sort} onSort={handleSetSort} />

        <div className="po-cb-wrap po-cb-wrap--toolbar" style={{ width: 180, minWidth: 180 }}>
          <Combobox value={statusF} options={STATUS_OPTIONS.map(o => ({ value: o.value, label: t(o.labelKey) }))}
            onChange={(v) => setStatusF(v)} />
        </div>

        <div className="org-view-toggle" onMouseLeave={() => setViewHover(null)}>
          <div className="org-view-indicator"
            style={{ transform: `translateX(${curView === 'list' ? 30 : 0}px)` }} />
          <button className={`org-view-btn${curView === 'grid' ? ' org-view-btn--current' : ''}`}
            onClick={() => setView('grid')} onMouseEnter={() => setViewHover('grid')}
            title={t('products.warehouses.gridView')} type="button">
            <SquaresFour className="org-view-icon" />
          </button>
          <button className={`org-view-btn${curView === 'list' ? ' org-view-btn--current' : ''}`}
            onClick={() => setView('list')} onMouseEnter={() => setViewHover('list')}
            title={t('products.warehouses.listView')} type="button">
            <List className="org-view-icon" />
          </button>
        </div>

        <button type="button" className="org-new-btn" onClick={() => setEditing('new')}>
          <Plus className="org-new-icon" /> {t('products.warehouses.newWarehouse')}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="crm-placeholder">
          {search || statusF !== 'all'
            ? t('products.warehouses.noMatch')
            : t('products.warehouses.empty')}
        </div>
      ) : view === 'list' ? (
        <div className="po-set-table">
          <div className="po-set-row po-set-row--head po-set-row--wh">
            <span>{t('products.warehouses.colName')}</span><span>{t('products.warehouses.colCode')}</span><span>{t('products.warehouses.colLocation')}</span>
            <span>{t('products.warehouses.colRegion')}</span><span>{t('products.warehouses.colContact')}</span>
            <span>{t('products.warehouses.colStatus')}</span><span>{t('products.warehouses.colDefault')}</span><span></span>
          </div>
          {filtered.map(w => (
            <WarehouseRow key={w.id} w={w}
              onEdit={() => setEditing(w)}
              onDelete={() => remove(w.id)}
              onToggleActive={() => patch(w.id, { is_active: !w.is_active })}
              onMakeDefault={() => patch(w.id, { is_default: true })} />
          ))}
        </div>
      ) : (
        <div className="wh-grid">
          {filtered.map(w => (
            <WarehouseCard key={w.id} w={w}
              onEdit={() => setEditing(w)}
              onDelete={() => remove(w.id)}
              onToggleActive={() => patch(w.id, { is_active: !w.is_active })}
              onMakeDefault={() => patch(w.id, { is_default: true })} />
          ))}
        </div>
      )}

      {editing && (
        <WarehouseModal
          warehouse={editing === 'new' ? null : editing}
          onSave={(body) => persist(body, editing === 'new' ? null : editing.id)}
          onClose={() => setEditing(null)}
        />
      )}

      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
    </>
  );
}

// ── Sort toggle (mirrors Organization / Promo Codes) ─────────────────
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

// ── Warehouse row (list view) — clickable, opens edit on row click ───
function WarehouseRow({ w, onEdit, onDelete, onToggleActive, onMakeDefault }) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef(null);
  const status = statusOf(w);
  const statusLabel = status === 'active' ? t('products.warehouses.labelActive') : t('products.warehouses.labelInactive');
  const location = shortLocation(w);
  const contact = (w.contact_name || '').trim();
  const phone   = (w.contact_phone || '').trim();

  return (
    <PoListRow className="po-set-row--wh" frozen={menuOpen}
      onClick={() => onEdit()} style={{ cursor: 'pointer' }}>
      <span className="po-set-strong">{w.name}</span>
      <span>{w.code || '—'}</span>
      <span className="po-set-note" title={formatAddress(w)}>
        {location || '—'}
      </span>
      <span className="po-set-note">{w.region || '—'}</span>
      <span className="wh-contact-cell">
        {contact || phone ? (
          <>
            {contact && <span className="wh-contact-name">{contact}</span>}
            {phone   && <span className="wh-contact-phone">{phone}</span>}
          </>
        ) : '—'}
      </span>
      <span>
        <span className={`promo-status promo-status--${status}`}>{statusLabel}</span>
      </span>
      <span>
        {w.is_default ? (
          <span className="po-wh-default-pill">
            <Star weight="fill" /> {t('products.warehouses.default')}
          </span>
        ) : (
          <button type="button" className="po-mod-required-btn"
            onClick={(e) => { e.stopPropagation(); onMakeDefault(); }}>
            {t('products.warehouses.makeDefault')}
          </button>
        )}
      </span>
      <button ref={menuBtnRef} type="button" className="org-list-menu-btn" aria-label={t('products.warehouses.options')}
        onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}>
        <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
      </button>
      {menuOpen && (
        <WarehouseMenu w={w} btnRef={menuBtnRef}
          onClose={() => setMenuOpen(false)}
          onEdit={onEdit} onDelete={onDelete}
          onToggleActive={onToggleActive}
          onMakeDefault={onMakeDefault} />
      )}
    </PoListRow>
  );
}

// ── Warehouse card (grid view) — Organization-style 3D tilt card ─────
function WarehouseCard({ w, onEdit, onDelete, onToggleActive, onMakeDefault }) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef(null);
  const { ref, glossRef, handlers } = InteractiveSection(TILT, menuOpen);
  const status = statusOf(w);
  const statusLabel = status === 'active' ? t('products.warehouses.labelActive') : t('products.warehouses.labelInactive');
  const location = shortLocation(w);
  const contact = (w.contact_name || '').trim();
  const phone   = (w.contact_phone || '').trim();

  return (
    <div ref={ref} className={`wh-card${menuOpen ? ' wh-card--frozen' : ''}`}
      onClick={() => onEdit()} {...handlers}>
      <div ref={glossRef} className="wh-card-gloss" />

      <div className="wh-card-head">
        <div className="wh-card-title-wrap">
          <span className="wh-card-name">{w.name}</span>
          {w.code && <span className="wh-card-code">{w.code}</span>}
        </div>
        <button ref={menuBtnRef} type="button" className="org-list-menu-btn"
          aria-label={t('products.warehouses.options')}
          onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}>
          <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
        </button>
      </div>

      <div className="wh-card-location">{location || t('products.warehouses.noAddress')}</div>

      <div className="wh-card-meta">
        {w.region && (
          <div className="wh-card-meta-row">
            <span className="wh-card-meta-label">{t('products.warehouses.region')}</span>
            <span>{w.region}</span>
          </div>
        )}
        {contact && (
          <div className="wh-card-meta-row">
            <span className="wh-card-meta-label">{t('products.warehouses.contact')}</span>
            <span>{contact}</span>
          </div>
        )}
        {phone && (
          <div className="wh-card-meta-row">
            <span className="wh-card-meta-label">{t('products.warehouses.phone')}</span>
            <span>{phone}</span>
          </div>
        )}
      </div>

      <div className="wh-card-foot">
        <span className={`promo-status promo-status--${status}`}>{statusLabel}</span>
        {w.is_default ? (
          <span className="po-wh-default-pill">
            <Star weight="fill" /> {t('products.warehouses.default')}
          </span>
        ) : (
          <button type="button" className="po-mod-required-btn"
            onClick={(e) => { e.stopPropagation(); onMakeDefault(); }}>
            {t('products.warehouses.makeDefault')}
          </button>
        )}
      </div>

      {menuOpen && (
        <WarehouseMenu w={w} btnRef={menuBtnRef}
          onClose={() => setMenuOpen(false)}
          onEdit={onEdit} onDelete={onDelete}
          onToggleActive={onToggleActive}
          onMakeDefault={onMakeDefault} />
      )}
    </div>
  );
}

// Dropdown — portal'd to body so row overflow+tilt don't clip; right-aligned via trigger rect.
function WarehouseMenu({ w, btnRef, onClose, onEdit, onDelete, onToggleActive, onMakeDefault }) {
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

  // Default WH can't be deactivated/deleted (backend blocks); non-default also get "Make default" quick action.
  return createPortal(
    <div className="org-card-dropdown" style={{ top: pos.top, left: pos.left }}
      onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <button className="org-card-dropdown-item"
        onClick={() => { onClose(); onEdit(); }}>
        <PencilSimple className="org-card-dropdown-icon" /> {t('products.warehouses.menu.edit')}
      </button>
      {!w.is_default && (
        <>
          <button className="org-card-dropdown-item"
            onClick={() => { onClose(); onMakeDefault(); }}>
            <Star className="org-card-dropdown-icon" /> {t('products.warehouses.menu.makeDefault')}
          </button>
          <button className="org-card-dropdown-item"
            onClick={() => { onClose(); onToggleActive(); }}>
            <Power className="org-card-dropdown-icon" />
            {w.is_active ? t('products.warehouses.menu.deactivate') : t('products.warehouses.menu.activate')}
          </button>
          <div className="org-card-dropdown-sep" />
          <button className="org-card-dropdown-item org-card-dropdown-item--danger"
            onClick={() => { onClose(); onDelete(); }}>
            <Trash className="org-card-dropdown-icon" /> {t('products.warehouses.menu.delete')}
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}

// ── New / Edit modal — same shell, different defaults + button text ──
function WarehouseModal({ warehouse, onSave, onClose }) {
  const { t } = useTranslation();
  const isNew = !warehouse;
  const [form, setForm] = useState({
    name:          warehouse?.name          || '',
    code:          warehouse?.code          || '',
    country:       warehouse?.country       || '',
    city:          warehouse?.city          || '',
    street:        warehouse?.street        || '',
    postal_code:   warehouse?.postal_code   || '',
    region:        warehouse?.region        || '',
    contact_name:  warehouse?.contact_name  || '',
    contact_phone: warehouse?.contact_phone || '',
    notes:         warehouse?.notes         || '',
    is_default:    !!warehouse?.is_default,
    // Customer-facing (storefront)
    is_pickup_enabled:     !!warehouse?.is_pickup_enabled,
    pickup_hours:          warehouse?.pickup_hours          || '',
    delivery_eta_min_days: warehouse?.delivery_eta_min_days ?? '',
    delivery_eta_max_days: warehouse?.delivery_eta_max_days ?? '',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Esc closes — same hook pattern as PromoCodeModal.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = (e) => {
    e?.preventDefault?.();
    if (!form.name.trim()) return;
    const body = {
      name:          form.name.trim(),
      code:          form.code.trim(),
      country:       form.country.trim(),
      city:          form.city.trim(),
      street:        form.street.trim(),
      postal_code:   form.postal_code.trim(),
      region:        form.region.trim(),
      contact_name:  form.contact_name.trim(),
      contact_phone: form.contact_phone.trim(),
      notes:         form.notes.trim(),
      is_pickup_enabled: !!form.is_pickup_enabled,
      pickup_hours:      form.pickup_hours.trim(),
      // Empty input → null on backend (clears ETA). Parsing twice via Number()
      // because parseInt('') = NaN which would be sent as 0 by JSON.stringify.
      delivery_eta_min_days: form.delivery_eta_min_days === ''
        ? null : parseInt(form.delivery_eta_min_days, 10),
      delivery_eta_max_days: form.delivery_eta_max_days === ''
        ? null : parseInt(form.delivery_eta_max_days, 10),
    };
    // Only PUT is_default on create or when turning ON — backend rejects unflagging the only default.
    if (isNew || form.is_default) body.is_default = !!form.is_default;
    onSave(body);
  };

  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">
                {isNew ? t('products.warehouses.modal.newTitle') : t('products.warehouses.modal.editTitle')}
              </div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {isNew
                    ? t('products.warehouses.modal.newSubtitle')
                    : t('products.warehouses.modal.editSubtitle', { name: warehouse.name })}
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

            {/* — Identification — */}
            <div className="po-wh-section-label">{t('products.warehouses.modal.identification')}</div>
            <div className="cpm-section">
              <label className="po-field-label">{t('products.warehouses.modal.name')}</label>
              <input className="crm-input" autoFocus maxLength={120}
                placeholder={t('products.warehouses.modal.namePlaceholder')}
                value={form.name} onChange={e => set('name', e.target.value)} />
              <span className="cpm-section-hint">{t('products.warehouses.modal.nameHint')}</span>
            </div>
            <div className="cpm-section">
              <label className="po-field-label">{t('products.warehouses.modal.code')}</label>
              <input className="crm-input" maxLength={40}
                placeholder={t('products.warehouses.modal.codePlaceholder')}
                value={form.code} onChange={e => set('code', e.target.value)} />
              <span className="cpm-section-hint">{t('products.warehouses.modal.codeHint')}</span>
            </div>

            {/* — Address — */}
            <div className="po-wh-section-label">{t('products.warehouses.modal.address')}</div>
            <div className="po-wh-grid">
              <div className="cpm-section">
                <label className="po-field-label">{t('products.warehouses.modal.country')}</label>
                <CountryCombo
                  value={form.country}
                  onChange={(name) => set('country', name)} />
              </div>
              <div className="cpm-section">
                <label className="po-field-label">{t('products.warehouses.modal.regionState')}</label>
                <input className="crm-input" maxLength={120}
                  placeholder={t('products.warehouses.modal.regionPlaceholder')}
                  value={form.region} onChange={e => set('region', e.target.value)} />
              </div>
              <div className="cpm-section">
                <label className="po-field-label">{t('products.warehouses.modal.city')}</label>
                <input className="crm-input" maxLength={120}
                  placeholder={t('products.warehouses.modal.cityPlaceholder')}
                  value={form.city} onChange={e => set('city', e.target.value)} />
              </div>
              <div className="cpm-section">
                <label className="po-field-label">{t('products.warehouses.modal.postalCode')}</label>
                <input className="crm-input" maxLength={40}
                  placeholder={t('products.warehouses.modal.postalPlaceholder')}
                  value={form.postal_code} onChange={e => set('postal_code', e.target.value)} />
              </div>
            </div>
            <div className="cpm-section">
              <label className="po-field-label">{t('products.warehouses.modal.street')}</label>
              <input className="crm-input" maxLength={255}
                placeholder={t('products.warehouses.modal.streetPlaceholder')}
                value={form.street} onChange={e => set('street', e.target.value)} />
              <span className="cpm-section-hint">{t('products.warehouses.modal.streetHint')}</span>
            </div>

            {/* — Operations contact (optional) — */}
            <div className="po-wh-section-label">{t('products.warehouses.modal.opsContact')}</div>
            <div className="po-wh-grid">
              <div className="cpm-section">
                <label className="po-field-label">{t('products.warehouses.modal.contactName')}</label>
                <input className="crm-input" maxLength={120}
                  placeholder={t('products.warehouses.modal.contactNamePlaceholder')}
                  value={form.contact_name} onChange={e => set('contact_name', e.target.value)} />
              </div>
              <div className="cpm-section">
                <label className="po-field-label">{t('products.warehouses.modal.phone')}</label>
                <input className="crm-input" maxLength={40}
                  placeholder={t('products.warehouses.modal.phonePlaceholder')}
                  value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)} />
              </div>
            </div>

            {/* — Notes — */}
            <div className="cpm-section">
              <label className="po-field-label">{t('products.warehouses.modal.notes')}</label>
              <textarea className="crm-input cpm-textarea" rows={3} maxLength={2000}
                placeholder={t('products.warehouses.modal.notesPlaceholder')}
                value={form.notes} onChange={e => set('notes', e.target.value)} />
            </div>

            {/* — Customer fulfillment — pickup toggle + delivery ETA used by
                 the storefront. Pickup makes this warehouse appear in the
                 checkout location picker; ETA fields populate the
                 "Delivery in 2–4 days" hint for courier orders. */}
            <div className="po-wh-section-label">{t('products.warehouses.modal.customerFulfillment')}</div>
            <div className="cpm-section">
              <label className="po-set-field po-set-field--toggle po-wh-toggle-row">
                <input type="checkbox" className="cat-prod-checkbox po-include-cb"
                  checked={form.is_pickup_enabled}
                  onChange={e => set('is_pickup_enabled', e.target.checked)} />
                <span className="po-set-toggle-text">{t('products.warehouses.modal.allowPickup')}</span>
              </label>
              <span className="cpm-section-hint">
                {t('products.warehouses.modal.pickupHint')}
              </span>
            </div>
            {form.is_pickup_enabled && (
              <div className="cpm-section">
                <label className="po-field-label">{t('products.warehouses.modal.pickupHours')}</label>
                <input className="crm-input" maxLength={200}
                  placeholder={t('products.warehouses.modal.pickupHoursPlaceholder')}
                  value={form.pickup_hours} onChange={e => set('pickup_hours', e.target.value)} />
                <span className="cpm-section-hint">
                  {t('products.warehouses.modal.pickupHoursHint')}
                </span>
              </div>
            )}
            <div className="po-wh-grid">
              <div className="cpm-section">
                <label className="po-field-label">{t('products.warehouses.modal.etaMin')}</label>
                <input className="crm-input" type="number" min={0} max={180}
                  placeholder="2"
                  value={form.delivery_eta_min_days}
                  onChange={e => set('delivery_eta_min_days', e.target.value)} />
              </div>
              <div className="cpm-section">
                <label className="po-field-label">{t('products.warehouses.modal.etaMax')}</label>
                <input className="crm-input" type="number" min={0} max={180}
                  placeholder="4"
                  value={form.delivery_eta_max_days}
                  onChange={e => set('delivery_eta_max_days', e.target.value)} />
              </div>
            </div>
            <span className="cpm-section-hint">
              {t('products.warehouses.modal.etaHint')}
            </span>

            {/* Default flag only on create — when editing, "Make default" lives on row/card. */}
            {isNew && (
              <div className="cpm-section">
                <label className="po-set-field po-set-field--toggle po-wh-toggle-row">
                  <input type="checkbox" className="cat-prod-checkbox po-include-cb"
                    checked={form.is_default}
                    onChange={e => set('is_default', e.target.checked)} />
                  <span className="po-set-toggle-text">{t('products.warehouses.modal.makeThisDefault')}</span>
                </label>
                <span className="cpm-section-hint">
                  {t('products.warehouses.modal.makeDefaultHint')}
                </span>
              </div>
            )}

            <div className="auth-actions">
              <button type="submit" className="crm-submit-btn" disabled={!form.name.trim()}>
                {isNew ? t('products.warehouses.modal.createWarehouse') : t('products.warehouses.modal.saveChanges')}
              </button>
              <button type="button" className="crm-submit-btn auth-btn-secondary"
                onClick={onClose}>{t('products.warehouses.modal.cancel')}</button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  );
}
