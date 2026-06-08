import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router-dom';
import {
  MagnifyingGlass, DotsThreeOutline, PencilSimple, Snowflake, Sun, Trash,
  ArrowDown, X, CaretRight, CaretDown, Folder, Cube,
} from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { useLiveReload } from '../../../Utils/useLiveReload.js';
import { Combobox, DatePicker } from '../Booking/BookingCreateModal.jsx';
import '../../../Style/Booking.css';   // .bk-date-pop / calendar grid styles for DatePicker

// User's browser tz — DatePicker uses it to highlight "today" correctly.
const USER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
import { PoListRow } from '../../../Utils/PoListRow.jsx';
import { useInfiniteList } from '../../../Utils/useInfiniteList.js';
import { useInfiniteScroll } from '../../../Utils/useInfiniteScroll.js';
import '../../../Style/Authentication.css';
import '../../../Style/Products.css';
import '../../../Style/Organization.css';

const STATUS_OPTIONS = [
  { value: 'all',     labelKey: 'products.batches.statusAll' },
  { value: 'active',  labelKey: 'products.batches.statusActive'  },
  { value: 'frozen',  labelKey: 'products.batches.statusFrozen'  },
  { value: 'depleted',labelKey: 'products.batches.statusDepleted'},
];

const SORT_OPTIONS = [
  { field: 'date',     labelKey: 'products.batches.sortByDate'     },
  { field: 'name',     labelKey: 'products.batches.sortByName'     },
  { field: 'remaining',labelKey: 'products.batches.sortByRemaining'},
];
const SORT_DEFAULT_DIR = { date: 'desc', name: 'asc', remaining: 'desc' };

function statusOf(b) {
  if (b.is_frozen) return 'frozen';
  if (b.quantity_remaining === 0) return 'depleted';
  return 'active';
}

// Group a flat list of inventory_batches rows into:
//   batch_name → { aggregate, products: [{ product, aggregate, leaves: [row…] }] }
// `aggregate` is summed received/remaining + earliest received_at + first non-empty
// production / expiry dates + a derived status (any active wins, then frozen, then
// depleted). The status logic mirrors statusOf() but on a multi-row set.
function buildBatchTree(rows) {
  const byName = new Map();
  for (const r of rows) {
    if (!byName.has(r.batch_name)) {
      byName.set(r.batch_name, { batch_name: r.batch_name, products: new Map() });
    }
    const node = byName.get(r.batch_name);
    if (!node.products.has(r.product_id)) {
      node.products.set(r.product_id, {
        product_id:    r.product_id,
        product_title: r.product_title,
        leaves: [],
      });
    }
    node.products.get(r.product_id).leaves.push(r);
  }

  // Convert nested Maps → arrays + compute aggregates.
  const out = [];
  for (const node of byName.values()) {
    const products = [];
    let bReceived = 0, bRemaining = 0, anyActive = false, anyFrozen = false, anyDepleted = false;
    let bReceivedAt = null, bProdDate = null, bExpDate = null;
    for (const prod of node.products.values()) {
      let pReceived = 0, pRemaining = 0;
      for (const leaf of prod.leaves) {
        pReceived  += leaf.quantity_received  || 0;
        pRemaining += leaf.quantity_remaining || 0;
        const s = statusOf(leaf);
        if (s === 'active')   anyActive   = true;
        if (s === 'frozen')   anyFrozen   = true;
        if (s === 'depleted') anyDepleted = true;
        if (!bReceivedAt || (leaf.received_at && leaf.received_at < bReceivedAt))
          bReceivedAt = leaf.received_at;
        if (!bProdDate && leaf.production_date) bProdDate = leaf.production_date;
        if (!bExpDate  && leaf.expiry_date)     bExpDate  = leaf.expiry_date;
      }
      prod.quantity_received  = pReceived;
      prod.quantity_remaining = pRemaining;
      products.push(prod);
      bReceived  += pReceived;
      bRemaining += pRemaining;
    }
    // Derived status: active wins, then frozen, then depleted (matches single-row rule).
    const status = anyActive ? 'active' : anyFrozen ? 'frozen' : anyDepleted ? 'depleted' : 'active';
    out.push({
      batch_name: node.batch_name,
      products,
      quantity_received:  bReceived,
      quantity_remaining: bRemaining,
      received_at:        bReceivedAt,
      production_date:    bProdDate,
      expiry_date:        bExpDate,
      status,
    });
  }
  return out;
}

const STATUS_LABEL = {
  active:   { labelKey: 'products.batches.labelActive',   cls: 'promo-status--active'   },
  frozen:   { labelKey: 'products.batches.labelFrozen',   cls: 'promo-status--inactive' },
  depleted: { labelKey: 'products.batches.labelDepleted', cls: 'promo-status--expired'  },
};

export default function Batches() {
  const { t } = useTranslation();
  const { projectId } = useOutletContext();
  const pq = `?project_id=${projectId}`;

  const [skus,       setSkus]       = useState([]);   // all L2 SKUs in project for receive modal
  const [warehouses, setWarehouses] = useState([]);
  const [search,     setSearch]     = useState('');
  const [statusF,    setStatusF]    = useState('all');
  const [sort,       setSort]       = useState({ field: 'date', dir: 'desc' });

  const [editing,   setEditing]   = useState(null);     // batch object
  const [toast,     setToast]     = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2400); };

  // Infinite-scroll batches feed.
  const {
    items: batches, hasMore, loading, loadMore, reload,
  } = useInfiniteList({
    url: `${API_BASE}/api/projects/${projectId}/batches`,
    pageSize: 100,
  });
  const sentinelRef = useInfiniteScroll(loadMore);
  const load = reload;     // alias for receive/edit/freeze callbacks
  // Live collaboration: batch receive / edit / freeze / delete + stock changes refetch here.
  useLiveReload(projectId, ['batch_changed', 'inventory_changed'], reload);

  // SKUs + warehouses are loaded once (small lists, used by the Receive modal).
  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/warehouses${pq}`, { credentials: 'include' }).then(r => r.ok ? r.json() : []),
      fetch(`${API_BASE}/api/products${pq}`,    { credentials: 'include' }).then(r => r.ok ? r.json() : []),
    ]).then(([w, p]) => {
      setWarehouses(Array.isArray(w) ? w : []);
      const flat = [];
      for (const prod of (Array.isArray(p) ? p : [])) {
        for (const v of (prod.variations || [])) {
          for (const c of (v.configurations || [])) {
            flat.push({
              sku_id: c.id, product_id: prod.id,
              label: `${prod.title} — ${v.variation_name} / ${c.configuration_name}`,
              sku_code: c.sku_code,
            });
          }
        }
      }
      setSkus(flat);
    });
  }, [projectId, pq]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filt = batches.filter(b => {
      const hay = `${b.batch_name} ${b.product_title} ${b.sku_name}`.toLowerCase();
      if (q && !hay.includes(q)) return false;
      if (statusF !== 'all' && statusOf(b) !== statusF) return false;
      return true;
    });
    const dir = sort.dir === 'asc' ? 1 : -1;
    filt.sort((a, b) => {
      let av, bv;
      if (sort.field === 'name') { av = (a.batch_name || '').toLowerCase(); bv = (b.batch_name || '').toLowerCase(); }
      else if (sort.field === 'remaining') { av = a.quantity_remaining || 0; bv = b.quantity_remaining || 0; }
      else { av = a.received_at || ''; bv = b.received_at || ''; }
      return av < bv ? -dir : av > bv ? dir : 0;
    });
    return filt;
  }, [batches, search, statusF, sort]);

  const handleSetSort = (field) => {
    setSort(prev => ({
      field,
      dir: field === prev.field ? (prev.dir === 'asc' ? 'desc' : 'asc') : (SORT_DEFAULT_DIR[field] || 'desc'),
    }));
  };

  // Batch-level actions operate on the *whole* logical batch — every
  // inventory_batches row sharing this batch_name. We loop the existing
  // per-id PUT/DELETE endpoints in parallel; for the diploma scale (dozens of
  // rows per batch max) this is fine.

  const toggleFreezeGroup = async (group) => {
    const leaves = group.products.flatMap(p => p.leaves);
    // Treat the group as "frozen" only when every row is frozen — otherwise we
    // freeze all rows. This makes the toggle predictable from a tree view.
    const allFrozen = leaves.every(l => l.is_frozen);
    const nextFrozen = !allFrozen;
    await Promise.all(leaves.map(l =>
      fetch(`${API_BASE}/api/projects/${projectId}/batches/${l.id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_frozen: nextFrozen }),
      })
    ));
    showToast(nextFrozen ? t('products.batches.toast.frozen') : t('products.batches.toast.unfrozen')); load();
  };

  const removeGroup = async (group) => {
    const leaves = group.products.flatMap(p => p.leaves);
    if (!confirm(t('products.batches.confirmDelete', { name: group.batch_name, count: leaves.length }))) return;
    const results = await Promise.all(leaves.map(l =>
      fetch(`${API_BASE}/api/projects/${projectId}/batches/${l.id}`, {
        method: 'DELETE', credentials: 'include',
      })
    ));
    const failed = results.filter(r => !r.ok).length;
    if (failed === 0) { showToast(t('products.batches.toast.deleted')); load(); }
    else { showToast(t('products.batches.toast.deleteFailed', { count: failed })); load(); }
  };

  // Edit dialog operates on the first leaf as the form source, but on save
  // applies the patch to every leaf with that batch_name. EditBatchModal
  // receives the array of sibling leaf ids and PUTs each.
  const openGroupEdit = (group) => {
    const leaves = group.products.flatMap(p => p.leaves);
    setEditing({ ...leaves[0], _siblings: leaves.map(l => l.id) });
  };

  return (
    <>
      <p className="po-block-hint">
        {t('products.batches.hint')}
      </p>

      <div className="org-toolbar">
        <div className="org-search-wrap">
          <MagnifyingGlass className="org-search-icon" />
          <input className="org-search-input" placeholder={t('products.batches.searchPlaceholder')}
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <SortToggle sort={sort} onSort={handleSetSort} />

        <div className="po-cb-wrap po-cb-wrap--toolbar" style={{ width: 180, minWidth: 180 }}>
          <Combobox value={statusF} options={STATUS_OPTIONS.map(o => ({ value: o.value, label: t(o.labelKey) }))}
            onChange={(v) => setStatusF(v)} />
        </div>

      </div>

      {filtered.length === 0 ? (
        <div className="crm-placeholder">
          {search || statusF !== 'all'
            ? t('products.batches.noMatch')
            : t('products.batches.empty')}
        </div>
      ) : (
        <div className="po-set-table">
          <div className="po-set-row po-set-row--head po-set-row--batch-tree">
            <span>{t('products.batches.colBatchProductSku')}</span>
            <span>{t('products.batches.colRemaining')}</span>
            <span>{t('products.batches.colReceived')}</span>
            <span>{t('products.batches.colProduction')}</span>
            <span>{t('products.batches.colExpiry')}</span>
            <span>{t('products.batches.colStatus')}</span>
            <span />
          </div>
          {buildBatchTree(filtered).map(group => (
            <BatchTreeGroup key={group.batch_name} group={group}
              onEdit={() => openGroupEdit(group)}
              onToggleFreeze={() => toggleFreezeGroup(group)}
              onDelete={() => removeGroup(group)} />
          ))}
          {hasMore && <div ref={sentinelRef} className="inf-sentinel">{t('products.batches.loadingMore')}</div>}
        </div>
      )}


      {editing && (
        <EditBatchModal projectId={projectId} batch={editing}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); load(); showToast(t('products.batches.toast.updated')); }} />
      )}

      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
    </>
  );
}

// ── Sort toggle (mirrors PromoCodes) ────────────────────

function SortToggle({ sort, onSort }) {
  const { t } = useTranslation();
  const indRef = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);
  const curField = hovered ?? sort.field;

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el = btnRefs.current[curField];
      if (!ind || !el) return;
      ind.style.opacity = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [curField, sort.field]);

  return (
    <div className="org-sort-toggle" onMouseLeave={() => setHovered(null)}>
      <div ref={indRef} className="org-sort-indicator" />
      {SORT_OPTIONS.map(({ field, labelKey }) => {
        const active = sort.field === field;
        return (
          <button key={field} ref={el => { btnRefs.current[field] = el; }}
            className={`org-sort-btn${curField === field ? ' org-sort-btn--current' : ''}`}
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

// ── Tree rows ────────────────────────────────────────────
// Three-level hierarchy mirroring the Inventory page: Batch → Product → SKU/WH.
// Click anywhere on a row = expand/collapse. The "…" actions menu lives on the
// LEAF (per (sku × warehouse × batch) inventory_batches row) where it can
// unambiguously target a single DB row for Edit / Freeze / Delete.

function BatchTreeGroup({ group, onEdit, onToggleFreeze, onDelete }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const menuBtnRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const pct = group.quantity_received > 0
    ? Math.round(group.quantity_remaining / group.quantity_received * 100)
    : 0;
  const meta = STATUS_LABEL[group.status];

  // Group-level menu: synthesise a "batch-like" object for the BatchMenu — it
  // only reads `is_frozen`, `quantity_remaining`, `quantity_received` to decide
  // which actions to show. We pass aggregated values so "Delete" is enabled
  // only when EVERY row of the batch is still untouched.
  const leaves       = group.products.flatMap(p => p.leaves);
  const groupAsBatch = {
    is_frozen:          leaves.every(l => l.is_frozen),
    quantity_remaining: group.quantity_remaining,
    quantity_received:  group.quantity_received,
  };

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e) => {
      if (!e.target.closest?.('.org-card-dropdown') && !menuBtnRef.current?.contains(e.target))
        setMenuOpen(false);
    };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [menuOpen]);

  return (
    <>
      <PoListRow className="po-set-row--batch-tree po-set-row--batch-l0" frozen={menuOpen}
        onClick={() => setOpen(v => !v)} style={{ cursor: 'pointer' }}>
        <span className="batch-tree-name">
          <CaretChevron open={open} />
          <Folder weight="duotone" className="batch-tree-icon" />
          <span className="po-set-strong">{group.batch_name}</span>
          <span className="po-set-note batch-tree-sub">
            · {group.products.length === 1 ? t('products.batches.productOne', { count: group.products.length }) : t('products.batches.productMany', { count: group.products.length })}
          </span>
        </span>
        <span className="batch-remaining">
          <span className="batch-remaining-line">
            <b>{group.quantity_remaining}</b>
            <span className="po-set-note">/ {group.quantity_received}</span>
          </span>
          <span className="batch-bar"><span className="batch-bar-fill" style={{ width: `${pct}%` }} /></span>
        </span>
        <span className="po-set-note">{fmtDate(group.received_at)}</span>
        <span className="po-set-note">{group.production_date || '—'}</span>
        <span className="po-set-note">{group.expiry_date     || '—'}</span>
        <span>
          <span className={`promo-status ${meta.cls}`}>{t(meta.labelKey)}</span>
        </span>
        <button ref={menuBtnRef} className="org-list-menu-btn" type="button"
          onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}>
          <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
        </button>
        {menuOpen && createPortal(
          <BatchMenu btnRef={menuBtnRef} batch={groupAsBatch}
            onEdit={() => { setMenuOpen(false); onEdit(); }}
            onToggleFreeze={() => { setMenuOpen(false); onToggleFreeze(); }}
            onDelete={() => { setMenuOpen(false); onDelete(); }}
            onClose={() => setMenuOpen(false)} />,
          document.body
        )}
      </PoListRow>

      {open && group.products.map(prod => (
        <ProductSubtree key={prod.product_id} product={prod} />
      ))}
    </>
  );
}

function ProductSubtree({ product }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);  // products auto-open since they're cheap
  const pct = product.quantity_received > 0
    ? Math.round(product.quantity_remaining / product.quantity_received * 100)
    : 0;

  return (
    <>
      <PoListRow className="po-set-row--batch-tree po-set-row--batch-l1"
        onClick={() => setOpen(v => !v)} style={{ cursor: 'pointer' }}>
        <span className="batch-tree-name batch-tree-name--l1">
          <CaretChevron open={open} />
          <span className="po-set-strong">{product.product_title}</span>
          <span className="po-set-note batch-tree-sub">
            · {product.leaves.length === 1 ? t('products.batches.skuOne', { count: product.leaves.length }) : t('products.batches.skuMany', { count: product.leaves.length })}
          </span>
        </span>
        <span className="batch-remaining">
          <span className="batch-remaining-line">
            <b>{product.quantity_remaining}</b>
            <span className="po-set-note">/ {product.quantity_received}</span>
          </span>
          <span className="batch-bar"><span className="batch-bar-fill" style={{ width: `${pct}%` }} /></span>
        </span>
        <span /><span /><span /><span /><span />
      </PoListRow>

      {open && product.leaves.map(leaf => (
        <LeafRow key={leaf.id} leaf={leaf} />
      ))}
    </>
  );
}

function LeafRow({ leaf }) {
  const { t } = useTranslation();
  // Read-only leaf — all actions live on the batch (L0) row now. Click on the
  // leaf has no effect; mutations propagate from the batch-level menu.
  const status = statusOf(leaf);
  const meta = STATUS_LABEL[status];
  const pct = leaf.quantity_received > 0
    ? Math.round(leaf.quantity_remaining / leaf.quantity_received * 100)
    : 0;

  return (
    <PoListRow className="po-set-row--batch-tree po-set-row--batch-l2">
      <span className="batch-tree-name batch-tree-name--l2">
        <Cube className="batch-tree-icon batch-tree-icon--leaf" />
        <span>{leaf.variation_name} / {leaf.sku_name}</span>
        <span className="po-set-note batch-tree-sub">· {leaf.warehouse_name}</span>
      </span>
      <span className="batch-remaining">
        <span className="batch-remaining-line">
          <b>{leaf.quantity_remaining}</b>
          <span className="po-set-note">/ {leaf.quantity_received}</span>
        </span>
        <span className="batch-bar"><span className="batch-bar-fill" style={{ width: `${pct}%` }} /></span>
      </span>
      <span className="po-set-note">{fmtDate(leaf.received_at)}</span>
      <span className="po-set-note">{leaf.production_date || '—'}</span>
      <span className="po-set-note">{leaf.expiry_date     || '—'}</span>
      <span>
        <span className={`promo-status ${meta.cls}`}>{t(meta.labelKey)}</span>
      </span>
      <span />
    </PoListRow>
  );
}

function CaretChevron({ open }) {
  return open
    ? <CaretDown weight="bold" className="batch-tree-chevron" />
    : <CaretRight weight="bold" className="batch-tree-chevron" />;
}

function BatchMenu({ btnRef, batch, onEdit, onToggleFreeze, onDelete, onClose }) {
  const { t } = useTranslation();
  const [pos, setPos] = useState(null);
  const [hovered, setHovered] = useState(null);
  const indRef = useRef(null);
  const itemEls = useRef({});

  useEffect(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: Math.max(8, r.right - 180) });
  }, []);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      if (!ind) return;
      const el = hovered != null ? itemEls.current[hovered] : null;
      if (!el) { ind.style.opacity = '0'; ind.style.height = '0'; return; }
      ind.style.opacity = '1';
      ind.style.transform = `translateY(${el.offsetTop}px)`;
      ind.style.height = `${el.offsetHeight}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [hovered, pos]);

  if (!pos) return null;
  const canDelete = batch.quantity_remaining === batch.quantity_received;
  const items = [
    { key: 'edit',   label: t('products.batches.menu.edit'),                                icon: <PencilSimple className="org-card-dropdown-icon" />, onClick: onEdit },
    { key: 'freeze', label: batch.is_frozen ? t('products.batches.menu.unfreeze') : t('products.batches.menu.freeze'),
      icon: batch.is_frozen
        ? <Sun       className="org-card-dropdown-icon" />
        : <Snowflake className="org-card-dropdown-icon" />,
      onClick: onToggleFreeze },
  ];
  if (canDelete) {
    items.push({ key: 'delete', label: t('products.batches.menu.delete'),
      icon: <Trash className="org-card-dropdown-icon" />, onClick: onDelete, danger: true });
  }

  return (
    <div className="org-card-dropdown" style={{ top: pos.top, left: pos.left }}
      onPointerDown={e => e.stopPropagation()}>
      <div className="org-menu-block" onMouseLeave={() => setHovered(null)}>
        <div ref={indRef}
          className={`org-menu-indicator${hovered && items.find(x => x.key === hovered)?.danger ? ' org-menu-indicator--danger' : ''}`} />
        {items.map(it => (
          <button key={it.key} type="button"
            ref={el => { if (el) itemEls.current[it.key] = el; }}
            className={`org-card-dropdown-item org-menu-item${it.danger ? ' org-card-dropdown-item--danger' : ''}${hovered === it.key ? ' org-menu-item--current' : ''}`}
            onMouseEnter={() => setHovered(it.key)}
            onClick={it.onClick}>
            {it.icon} {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Receive batch modal ────────────────────────────────

export function ReceiveBatchModal({ projectId, pq, skus, warehouses, presetSkuId,
                                     onClose, onDone }) {
  const { t } = useTranslation();
  const [skuId,     setSkuId]     = useState(presetSkuId || (skus[0]?.sku_id ?? ''));
  const [whId,      setWhId]      = useState(warehouses.find(w => w.is_default)?.id ?? warehouses[0]?.id ?? '');
  const [batchName, setBatchName] = useState('');
  const [qty,       setQty]       = useState('');
  const [cost,      setCost]      = useState('');
  const [prodDate,  setProdDate]  = useState('');
  const [expDate,   setExpDate]   = useState('');
  const [notes,     setNotes]     = useState('');
  const [orgFormat, setOrgFormat] = useState(null);  // {mode, format}
  const [busy,      setBusy]      = useState(false);
  const [err,       setErr]       = useState('');

  // Look up org's batch_naming format for the placeholder.
  useEffect(() => {
    fetch(`${API_BASE}/api/projects/${projectId}/batch-settings`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setOrgFormat({ mode: d.batch_naming_mode, format: d.batch_naming_format }); })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e) => {
    e?.preventDefault();
    const q = parseInt(qty, 10);
    if (!skuId)         { setErr(t('products.batches.receiveModal.errSelectSku')); return; }
    if (!whId)          { setErr(t('products.batches.receiveModal.errSelectWarehouse')); return; }
    if (!isFinite(q) || q <= 0) { setErr(t('products.batches.receiveModal.errQty')); return; }
    setErr(''); setBusy(true);
    const r = await fetch(`${API_BASE}/api/projects/${projectId}/inventory/receive`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku_id:           Number(skuId),
        warehouse_id:     Number(whId),
        batch_name:       batchName.trim() || null,
        quantity_received: q,
        production_date:  prodDate || null,
        expiry_date:      expDate  || null,
        cost_per_unit:    cost ? parseFloat(cost) : null,
        notes:            notes.trim() || null,
      }),
    });
    setBusy(false);
    if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.detail || t('products.batches.receiveModal.failed')); return; }
    onDone();
  };

  const skuOptions = useMemo(() => skus.map(s => ({ id: s.sku_id, name: s.label })), [skus]);
  const whOptions  = useMemo(() => warehouses.map(w => ({ id: w.id, name: `${w.name}${w.code ? ` (${w.code})` : ''}` })), [warehouses]);
  const namePlaceholder = orgFormat?.mode === 'auto' && orgFormat?.format
    ? t('products.batches.receiveModal.namePlaceholderAuto', { format: orgFormat.format })
    : t('products.batches.receiveModal.namePlaceholderManual');

  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">{t('products.batches.receiveModal.title')}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {t('products.batches.receiveModal.subtitle')}
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
              <label className="po-field-label">{t('products.batches.receiveModal.sku')}</label>
              <Combobox value={skuId} options={skuOptions} onChange={setSkuId} placeholder={t('products.batches.receiveModal.pickSku')} />
            </div>

            <div className="cpm-section">
              <label className="po-field-label">{t('products.batches.receiveModal.warehouse')}</label>
              <Combobox value={whId} options={whOptions} onChange={setWhId} placeholder={t('products.batches.receiveModal.pickWarehouse')} />
            </div>

            <div className="cpm-datetime-row">
              <div className="cpm-section">
                <label className="po-field-label">{t('products.batches.receiveModal.quantityReceived')}</label>
                <input className="crm-input" type="number" min="1" step="1"
                  value={qty} onChange={e => setQty(e.target.value)} placeholder="100" />
              </div>
              <div className="cpm-section">
                <label className="po-field-label">{t('products.batches.receiveModal.costPerUnit')}</label>
                <input className="crm-input" type="number" min="0" step="0.01"
                  value={cost} onChange={e => setCost(e.target.value)} placeholder="0.00" />
                <span className="cpm-section-hint">{t('products.batches.receiveModal.costHint')}</span>
              </div>
            </div>

            <div className="cpm-section">
              <label className="po-field-label">{t('products.batches.receiveModal.batchName')}</label>
              <input className="crm-input" value={batchName}
                onChange={e => setBatchName(e.target.value)}
                placeholder={namePlaceholder} maxLength={80} />
              <span className="cpm-section-hint">
                {t('products.batches.receiveModal.nameHint', { format: orgFormat?.format || 'B-{YYYY}{MM}-{seq:03}' })}
              </span>
            </div>

            <div className="cpm-datetime-row">
              <div className="cpm-section">
                <label className="po-field-label">{t('products.batches.receiveModal.productionDate')}</label>
                <DatePicker value={prodDate} onChange={setProdDate} tz={USER_TZ} />
              </div>
              <div className="cpm-section">
                <label className="po-field-label">{t('products.batches.receiveModal.expiryDate')}</label>
                <DatePicker value={expDate} onChange={setExpDate} tz={USER_TZ} />
              </div>
            </div>

            <div className="cpm-section">
              <label className="po-field-label">{t('products.batches.receiveModal.notes')}</label>
              <textarea className="crm-input" rows={2}
                value={notes} onChange={e => setNotes(e.target.value)}
                placeholder={t('products.batches.receiveModal.notesPlaceholder')} />
            </div>

            <div className="auth-actions">
              <button className="crm-submit-btn" type="submit" disabled={busy}>
                {busy ? t('products.batches.receiveModal.receiving') : t('products.batches.receiveModal.receive')}
              </button>
              <button className="crm-submit-btn auth-btn-secondary" type="button" onClick={onClose}>
                {t('common.cancel')}
              </button>
            </div>
            {err && <p className="auth-msg auth-msg--err">{err}</p>}
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Edit batch modal ────────────────────────────────────

function EditBatchModal({ projectId, batch, onClose, onDone }) {
  const { t } = useTranslation();
  const [batchName, setBatchName] = useState(batch.batch_name);
  const [prodDate,  setProdDate]  = useState(batch.production_date || '');
  const [expDate,   setExpDate]   = useState(batch.expiry_date || '');
  const [notes,     setNotes]     = useState(batch.notes || '');
  const [busy,      setBusy]      = useState(false);
  const [err,       setErr]       = useState('');

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e) => {
    e?.preventDefault();
    setErr(''); setBusy(true);
    // If the caller passed `_siblings` (array of leaf ids that share this batch_name),
    // apply the same patch to all of them so renames + date edits propagate across
    // the whole logical batch. Otherwise just edit the single row.
    const ids = batch._siblings && batch._siblings.length > 0
      ? batch._siblings
      : [batch.id];
    const payload = {
      batch_name:      batchName.trim(),
      production_date: prodDate || null,
      expiry_date:     expDate || null,
      notes:           notes,
    };
    const results = await Promise.all(ids.map(id =>
      fetch(`${API_BASE}/api/projects/${projectId}/batches/${id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    ));
    setBusy(false);
    const failed = results.find(r => !r.ok);
    if (failed) {
      const j = await failed.json().catch(() => ({}));
      setErr(j.detail || t('products.batches.editModal.failed'));
      return;
    }
    onDone();
  };

  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">{t('products.batches.editModal.title')}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {batch._siblings && batch._siblings.length > 1
                    ? <>{t('products.batches.editModal.appliesPrefix')} <b>{t('products.batches.editModal.appliesRows', { count: batch._siblings.length })}</b> {t('products.batches.editModal.appliesSuffix')}</>
                    : <>{batch.product_title} — {batch.variation_name} / {batch.sku_name} · {batch.warehouse_name}</>}
                </span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>
        <div className="auth-modal-body">
          <form className="cpm-form" onSubmit={submit}>
            <div className="cpm-section">
              <label className="po-field-label">{t('products.batches.editModal.batchName')}</label>
              <input className="crm-input" value={batchName}
                onChange={e => setBatchName(e.target.value)} maxLength={80} />
            </div>
            <div className="cpm-datetime-row">
              <div className="cpm-section">
                <label className="po-field-label">{t('products.batches.editModal.productionDate')}</label>
                <DatePicker value={prodDate} onChange={setProdDate} tz={USER_TZ} />
              </div>
              <div className="cpm-section">
                <label className="po-field-label">{t('products.batches.editModal.expiryDate')}</label>
                <DatePicker value={expDate} onChange={setExpDate} tz={USER_TZ} />
              </div>
            </div>
            <div className="cpm-section">
              <label className="po-field-label">{t('products.batches.editModal.notes')}</label>
              <textarea className="crm-input" rows={2}
                value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
            <div className="auth-actions">
              <button className="crm-submit-btn" type="submit" disabled={busy}>
                {busy ? t('products.batches.editModal.saving') : t('products.batches.editModal.saveChanges')}
              </button>
              <button className="crm-submit-btn auth-btn-secondary" type="button" onClick={onClose}>
                {t('common.cancel')}
              </button>
            </div>
            {err && <p className="auth-msg auth-msg--err">{err}</p>}
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
