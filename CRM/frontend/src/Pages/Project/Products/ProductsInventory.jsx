import { Fragment, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router-dom';
import { useLiveReload } from '../../../Utils/useLiveReload.js';
import { MagnifyingGlass, CaretRight, CaretDown, Folder, Cube, PencilSimple, X, ArrowDown, FolderSimple, Warehouse, Tag } from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { formatMoney } from '../../../Utils/currency.js';
import { PoListRow } from '../../../Utils/PoListRow.jsx';
import MediaThumb from '../../../Utils/MediaThumb.jsx';
import { Combobox } from '../Booking/BookingCreateModal.jsx';
import { DynamicBlock } from '../../../Utils/DynamicBlock.js';
import BulkTransferWizard, { BulkTransferButton } from './BulkTransferWizard.jsx';
import BulkReceiveWizard,  { BulkReceiveButton  } from './BulkReceiveWizard.jsx';
import '../../../Style/Authentication.css';
import '../../../Style/Products.css';
import '../../../Style/Organization.css';

// Inventory shows physical only — digital/service have no warehouse stock.
const VISIBLE_TYPES = new Set(['physical']);

const FILTERS = [
  { key: 'all', labelKey: 'products.inventory.filterAll' },
  { key: 'low', labelKey: 'products.inventory.filterLow' },
  { key: 'oos', labelKey: 'products.inventory.filterOos' },
];

// Low-stock threshold for the toolbar pills + per-SKU filter. A SKU is
// "low" when 0 < total_quantity ≤ LOW_STOCK_THRESHOLD. Made a constant so
// it's easy to tune later, or move to a per-project setting if merchants
// want different defaults. User asked for ≤10 here.
const LOW_STOCK_THRESHOLD = 10;

const SORT_OPTIONS = [
  { field: 'name',       labelKey: 'products.inventory.sortByName'  },
  { field: 'stock',      labelKey: 'products.inventory.sortByStock' },
  { field: 'variations', labelKey: 'products.inventory.sortBySkus'  },
];
const DEFAULT_DIR = { name: 'asc', stock: 'desc', variations: 'desc' };

// Unified with BulkReceiveWizard.REASON_OPTIONS + a few "outgoing" reasons that
// only make sense for manual adjustments. Order is intentional: incoming reasons
// at the top (most common), outgoing reasons below the divider.
const REASON_OPTIONS = [
  { value: 'supplier_delivery', labelKey: 'products.inventory.reason.supplierDelivery' },
  { value: 'initial_inventory', labelKey: 'products.inventory.reason.initialInventory' },
  { value: 'customer_return',   labelKey: 'products.inventory.reason.customerReturn' },
  { value: 'production',        labelKey: 'products.inventory.reason.production' },
  { value: 'recount_adjust',    labelKey: 'products.inventory.reason.recountAdjust' },
  { value: 'transfer_in',       labelKey: 'products.inventory.reason.transferIn' },
  { value: 'damage',            labelKey: 'products.inventory.reason.damage' },
  { value: 'transfer_out',      labelKey: 'products.inventory.reason.transferOut' },
  { value: 'manual',            labelKey: 'products.inventory.reason.manual' },
  { value: 'other',             labelKey: 'products.inventory.reason.other' },
];

// Inventory table layout (9 columns):
//   Name · Price · Cost · Profit · Margin · SKU code · Stock · Sold · Edit
// Financial columns sit next to Name (left side of the table) so the
// merchant's eye flows: "what is it → what it costs / earns → identifier
// + stock counters → Edit". Edit stays on the right where it always was.
// All 7 numeric columns share the same 0.85fr width — equal-cadence
// march across the row.
const COLS = '1.8fr 0.85fr 0.85fr 0.85fr 0.85fr 0.85fr 0.85fr 0.85fr 95px';
// Single style object reused on every row (head + body) so the column
// template AND the gap between cells stay in lock-step. 12 px gap keeps
// right-aligned values (Margin, Sold) from kissing the cell that follows
// (SKU code, Edit button) — without the gap they paint flush against
// each other and read as "33.0%76792801" / "230[Edit]".
const ROW_STYLE = { gridTemplateColumns: COLS, columnGap: 12 };

// ── Inline money/percent helpers ──────────────────────────────────────
// Returns "—" for null/undefined so empty cells read clearly, never $0
// or 0₸. The actual symbol is controlled by the project's currency,
// set via `setInventoryCurrency()` at mount. Same pattern as
// __BOOKING_CURRENCY in Booking.jsx — avoids prop-drilling currency
// through 4+ levels of nested tree rows.
let __INV_CURRENCY = 'USD';
const setInventoryCurrency = (c) => { __INV_CURRENCY = c || 'USD'; };
const fmtMoney = (v) =>
  v == null ? '—' : formatMoney(v, __INV_CURRENCY);
const fmtPct = (v) =>
  v == null ? '—' : `${Number(v).toFixed(1)}%`;
// < 20 % gets the red highlight. Anything else (including healthy +
// loss-makers ≥ 20 % which shouldn't exist in practice) reads in the
// default text colour. Green is intentionally off the palette per the
// project design language — only red ("bad") + blue accent ("good").
const marginTone = (pct) => {
  if (pct == null) return '';
  return pct < 20 ? ' po-margin--bad' : '';
};

// Resolve the per-unit Price / Cost / Profit / Margin for a list of SKUs.
//
// These come straight from the product configuration (cost_price +
// sell_price columns on product_configurations_l2). They DO NOT depend
// on orders, sales history, or sold_quantity — a SKU with 0 sales but
// a configured cost/price will show real numbers; a SKU with hundreds
// of sales but no cost set will show "—" for Cost. The "Sold" column
// is purely informational, not an input to these formulas.
//
// Lenient rollup: Price and Cost are computed INDEPENDENTLY. If only
// Price is set on a SKU, the Price column still shows but Cost shows
// "—" (and Profit/Margin follow Cost since they need both).
//
// Aggregation strategy (for variation / product rows that contain
// multiple SKUs with potentially different prices):
//   1. SKUs with stock — weighted average by quantity. This reflects
//      the realistic per-unit economics of CURRENT inventory.
//   2. No SKU has stock — fall back to simple average across SKUs
//      with the value configured. The aggregate still answers
//      "what's the typical unit-economics here?" when OOS.
//   3. No SKU has the value configured at all — that column shows
//      "—" so the merchant knows to fill it in on the product page.
function rollupFinancials(skus) {
  const avg = (key) => {
    const have = skus.filter(s => s[key] != null);
    if (have.length === 0) return null;
    let weighted = 0;
    let stockSum = 0;
    let simple = 0;
    for (const s of have) {
      const qty = Number(s.quantity) || 0;
      if (qty > 0) {
        weighted += qty * Number(s[key]);
        stockSum += qty;
      }
      simple += Number(s[key]);
    }
    return stockSum > 0 ? weighted / stockSum : simple / have.length;
  };

  const price = avg('sell_price');
  const cost  = avg('cost_price');
  const profit     = (price != null && cost != null) ? price - cost : null;
  const margin_pct = (profit != null && price > 0)
    ? (profit / price) * 100
    : null;
  return { price, cost, profit, margin_pct };
}

function ProductsInventory() {
  const { t } = useTranslation();
  const { projectId, project } = useOutletContext();
  // Sync the module-level currency global before any child row renders.
  // Read currency from project metadata; default to USD until project
  // loads.
  useEffect(() => { setInventoryCurrency(project?.currency || 'USD'); }, [project?.currency]);
  const pq = `?project_id=${projectId}`;

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [filter, setFilter]     = useState('all');
  const [sort, setSort]         = useState({ field: 'name', dir: 'asc' });
  const [categoryFilter, setCategoryFilter] = useState(null); // null | 'uncategorized' | <id>

  // expanded[productId] = { hydrated, data, loading }
  const [expanded, setExpanded] = useState({});
  const [openVar, setOpenVar]   = useState(new Set());

  const [editTarget, setEditTarget] = useState(null);
  const [toast, setToast] = useState('');
  const [showWizard,  setShowWizard]  = useState(false);  // Distribute
  const [showReceive, setShowReceive] = useState(false);  // Add stock
  const [warehouses, setWarehouses] = useState([]);
  // summary[i] = { warehouse_id, sku_id, quantity, sku_name, sku_code,
  //                variation_id, variation_name, product_id, product_title }
  const [summary, setSummary] = useState([]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2400);
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    let url = `${API_BASE}/api/products${pq}`;
    if (categoryFilter === 'uncategorized')        url += '&uncategorized=true';
    else if (typeof categoryFilter === 'number')   url += `&category_id=${categoryFilter}`;
    try {
      const [pr, sm] = await Promise.all([
        fetch(url, { credentials: 'include' }).then(r => r.ok ? r.json() : []),
        fetch(`${API_BASE}/api/projects/${projectId}/stock/per-warehouse-summary${pq}`,
              { credentials: 'include' }).then(r => r.ok ? r.json() : []),
      ]);
      setProducts((Array.isArray(pr) ? pr : []).filter(p => VISIBLE_TYPES.has(p.product_type || 'physical')));
      setSummary(Array.isArray(sm) ? sm : []);
      setExpanded({});
      setOpenVar(new Set());
    } finally { setLoading(false); }
  }, [pq, categoryFilter, projectId]);

  useEffect(() => { loadProducts(); }, [loadProducts]);
  // Live collaboration: stock / receive / transfer / warehouse changes refetch the inventory grid.
  useLiveReload(projectId, ['inventory_changed', 'products_changed', 'warehouse_changed'], loadProducts);

  useEffect(() => {
    fetch(`${API_BASE}/api/categories${pq}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setCategories(Array.isArray(d) ? d : []))
      .catch(() => setCategories([]));
    fetch(`${API_BASE}/api/warehouses${pq}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setWarehouses(Array.isArray(d) ? d.filter(w => w.is_active) : []))
      .catch(() => setWarehouses([]));
  }, [pq]);

  const hydrateProduct = useCallback(async (pid) => {
    setExpanded(prev => ({ ...prev, [pid]: { ...(prev[pid] || {}), loading: true } }));
    const r = await fetch(`${API_BASE}/api/products/${pid}${pq}`, { credentials: 'include' });
    if (r.ok) {
      const data = await r.json();
      setExpanded(prev => ({ ...prev, [pid]: { hydrated: true, loading: false, data } }));
    } else {
      setExpanded(prev => ({ ...prev, [pid]: { hydrated: false, loading: false } }));
    }
  }, [pq]);

  const toggleProduct = useCallback((pid) => {
    const e = expanded[pid];
    if (e?.hydrated) {
      setExpanded(prev => {
        const next = { ...prev };
        delete next[pid];
        return next;
      });
      return;
    }
    if (e?.loading) return;
    hydrateProduct(pid);
  }, [expanded, hydrateProduct]);

  const toggleVar = (pid, vid) => {
    setOpenVar(prev => {
      const k = `${pid}-${vid}`;
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  // Aggregate `summary` (per-warehouse rows) into per-SKU totals once.
  // Used by both the toolbar counters and the Low/OOS filter view, so
  // they don't depend on the user expanding every product first.
  const skuTotals = useMemo(() => {
    // bySku: sku_id → { quantity, sold, sku_code, sku_name,
    //                   variation_id, variation_name,
    //                   product_id, product_title,
    //                   cost_price, sell_price }
    // cost_price / sell_price are per-SKU (not per-warehouse) so the
    // first row we see for that SKU wins.
    const bySku = new Map();
    for (const r of summary) {
      const id = r.sku_id;
      const prev = bySku.get(id);
      if (prev) {
        prev.quantity += (+r.quantity      || 0);
        prev.sold     += (+r.sold_quantity || 0);
      } else {
        bySku.set(id, {
          quantity:       +r.quantity      || 0,
          sold:           +r.sold_quantity || 0,
          sku_code:       r.sku_code || '',
          sku_name:       r.sku_name || '—',
          variation_id:   r.variation_id,
          variation_name: r.variation_name || '—',
          product_id:     r.product_id,
          product_title:  r.product_title || '',
          cost_price:     r.cost_price ?? null,
          sell_price:     r.sell_price ?? null,
        });
      }
    }
    return bySku;
  }, [summary]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? products.filter(p => p.title.toLowerCase().includes(q))
      : products;
    const arr = [...base];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sort.field === 'name')             cmp = (a.title || '').localeCompare(b.title || '');
      else if (sort.field === 'stock')       cmp = (a.total_stock || 0) - (b.total_stock || 0);
      else if (sort.field === 'variations')  cmp = (a.variations_count || 0) - (b.variations_count || 0);
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [products, search, sort]);

  // For Low/OOS — render the matching SKUs straight from skuTotals,
  // no product-hydration needed. The summary endpoint already returns
  // every (sku, warehouse) pair with quantity.
  const flatMatches = useMemo(() => {
    if (filter === 'all') return null;
    // Optional search/category filter applied to product_id set so the
    // toolbar search box also constrains the Low/OOS view.
    const allowedProductIds = new Set(filteredProducts.map(p => p.id));
    const out = [];
    for (const [sku_id, info] of skuTotals) {
      if (!allowedProductIds.has(info.product_id)) continue;
      const stock = info.quantity;
      if (filter === 'oos' && stock > 0) continue;
      if (filter === 'low' && !(stock > 0 && stock <= LOW_STOCK_THRESHOLD)) continue;
      out.push({
        product_id:         info.product_id,
        product_title:      info.product_title,
        variation_name:     info.variation_name,
        configuration_name: info.sku_name,
        sku_id,
        sku_code:           info.sku_code,
        stock,
        sold:               info.sold,
        cost_price:         info.cost_price,
        sell_price:         info.sell_price,
        threshold:          LOW_STOCK_THRESHOLD,
      });
    }
    // Stable order: product title, then SKU code.
    out.sort((a, b) =>
      (a.product_title || '').localeCompare(b.product_title || '') ||
      (a.sku_code || '').localeCompare(b.sku_code || '')
    );
    return out;
  }, [filter, filteredProducts, skuTotals]);

  // Live counters for filter pills — computed from skuTotals (already
  // loaded for every SKU at page mount), so they're correct BEFORE the
  // user expands any product.
  const counters = useMemo(() => {
    let all = skuTotals.size, low = 0, oos = 0;
    for (const info of skuTotals.values()) {
      const q = info.quantity;
      if (q <= 0) oos += 1;
      else if (q <= LOW_STOCK_THRESHOLD) low += 1;
    }
    return { all, low, oos };
  }, [skuTotals]);

  return (
    <>
      <p className="po-block-hint"
        dangerouslySetInnerHTML={{ __html: t('products.inventory.hint') }} />

      <div className="org-toolbar">
        <div className="org-search-wrap">
          <MagnifyingGlass className="org-search-icon" />
          <input className="org-search-input" placeholder={t('products.inventory.searchPlaceholder')}
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="po-toolbar-right">
          <SortToggle sort={sort} onSort={setSort} />
          <CategoryFilter value={categoryFilter} categories={categories}
            onChange={setCategoryFilter} />
          <FilterToggle value={filter} onChange={setFilter} counters={counters} />
          <BulkTransferButton onClick={() => setShowWizard(true)}
            disabled={products.length === 0} />
          <BulkReceiveButton onClick={() => setShowReceive(true)}
            disabled={products.length === 0} />
        </div>
      </div>

      {showWizard && (
        <BulkTransferWizard projectId={projectId}
          onClose={() => setShowWizard(false)}
          onApplied={() => { setShowWizard(false); loadProducts(); }}
          showToast={showToast} />
      )}

      {showReceive && (
        <BulkReceiveWizard projectId={projectId}
          onClose={() => setShowReceive(false)}
          onApplied={() => { setShowReceive(false); loadProducts(); }}
          showToast={showToast} />
      )}

      {loading ? (
        <p className="crm-placeholder">{t('common.loading')}</p>
      ) : filteredProducts.length === 0 ? (
        <p className="crm-placeholder">
          {products.length === 0 ? t('products.inventory.emptyNoProducts') : t('products.inventory.noMatch')}
        </p>
      ) : filter !== 'all' ? (
        <FlatMatchList rows={flatMatches} onEdit={setEditTarget} />
      ) : (
        <WarehouseGroups
          warehouses={warehouses}
          products={filteredProducts}
          summary={summary}
          expanded={expanded}
          openVar={openVar}
          onToggleProduct={toggleProduct}
          onToggleVar={toggleVar}
          onEdit={setEditTarget} />
      )}

      {editTarget && (
        <EditStockModal
          target={editTarget}
          pq={pq}
          projectId={projectId}
          warehouses={warehouses}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            // Re-hydrate just that product so the row updates without full reload.
            hydrateProduct(editTarget.product_id);
            showToast(t('products.inventory.stockAdjusted'));
            setEditTarget(null);
          }}
          showToast={showToast} />
      )}

      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
    </>
  );
}

// ── Sort pill toggle (mirrors ProdSortToggle from ProductsList) ─────

function SortToggle({ sort, onSort }) {
  const { t } = useTranslation();
  const indRef  = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);
  const cur = hovered ?? sort.field;

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el  = btnRefs.current[cur];
      if (!ind || !el) return;
      ind.style.opacity   = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width     = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [cur, sort.field]);

  const handleClick = (field) => {
    onSort(prev => ({
      field,
      dir: field === prev.field ? (prev.dir === 'asc' ? 'desc' : 'asc') : (DEFAULT_DIR[field] ?? 'asc'),
    }));
  };

  return (
    <div className="org-sort-toggle" onMouseLeave={() => setHovered(null)}>
      <div ref={indRef} className="org-sort-indicator" />
      {SORT_OPTIONS.map(({ field, labelKey }) => {
        const active = sort.field === field;
        const isCur  = cur === field;
        return (
          <button key={field} ref={el => { btnRefs.current[field] = el; }}
            className={`org-sort-btn${isCur ? ' org-sort-btn--current' : ''}`}
            style={active ? { paddingLeft: 6 } : undefined}
            onMouseEnter={() => setHovered(field)}
            onClick={() => handleClick(field)} type="button">
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

// ── Category dropdown (read-only mirror of ProductsList's CategoryFilter) ─

function CategoryFilter({ value, categories, onChange }) {
  const { t } = useTranslation();
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos,  setPos]  = useState(null);
  const [hovered, setHovered] = useState(null);

  const activeKey = value === null ? 'all' : value === 'uncategorized' ? 'uncat' : `c:${value}`;
  const current   = hovered ?? activeKey;
  const { indRef, setItemRef } = DynamicBlock(current, open);

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left, width: Math.max(240, r.width) });
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    const onPd  = e => { if (!e.target.closest?.('.cat-filter-dropdown') && !btnRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPd);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPd);
    };
  }, [open]);

  const label = value === null ? t('products.inventory.allCategories')
    : value === 'uncategorized' ? t('products.inventory.uncategorized')
    : (categories.find(c => c.id === value)?.name || t('products.inventory.category'));

  return (
    <>
      <button ref={btnRef} className="cat-filter-btn" type="button"
        onClick={() => setOpen(v => !v)}>
        <FolderSimple className="cat-filter-icon" />
        <span>{label}</span>
        <CaretDown className="cat-filter-caret" weight="bold" />
      </button>
      {open && pos && createPortal(
        <div className="cat-filter-dropdown"
          style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
          onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
          onMouseLeave={() => setHovered(null)}>
          <div ref={indRef} className="cat-filter-indicator" />
          <button ref={setItemRef('all')}
            className={`cat-filter-item${current === 'all' ? ' cat-filter-item--current' : ''}`}
            onMouseEnter={() => setHovered('all')}
            onClick={() => { onChange(null); setOpen(false); }}>
            {t('products.inventory.allCategories')}
          </button>
          <button ref={setItemRef('uncat')}
            className={`cat-filter-item${current === 'uncat' ? ' cat-filter-item--current' : ''}`}
            onMouseEnter={() => setHovered('uncat')}
            onClick={() => { onChange('uncategorized'); setOpen(false); }}>
            {t('products.inventory.uncategorized')}
          </button>
          {categories.map(c => {
            const k = `c:${c.id}`;
            return (
              <button key={c.id}
                ref={setItemRef(k)}
                className={`cat-filter-item${current === k ? ' cat-filter-item--current' : ''}`}
                onMouseEnter={() => setHovered(k)}
                onClick={() => { onChange(c.id); setOpen(false); }}>
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

// ── Warehouse-grouped view: WH → product → variation → SKU; SKU click opens cell-edit modal.

function WarehouseGroups({ warehouses, products, summary, onEdit }) {
  const { t } = useTranslation();
  // openWh: WH ids expanded; defaults to all open, collapses remembered per-WH.
  const [openWh, setOpenWh]     = useState(() => new Set());
  const [openProd, setOpenProd] = useState(() => new Set());
  const [openVar2, setOpenVar2] = useState(() => new Set());

  useEffect(() => {
    setOpenWh(prev => prev.size === 0 && warehouses.length > 0
      ? new Set(warehouses.map(w => w.id))
      : prev);
  }, [warehouses]);

  const toggleWh   = (id)  => setOpenWh(p   => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleProd = (key) => setOpenProd(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleVar  = (key) => setOpenVar2(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const visibleProductIds = useMemo(() => new Set(products.map(p => p.id)), [products]);

  // Build { wh_id: Map<product_id, { product_id, product_title, variations: Map<vid, {variation_name, skus}> }> }
  const tree = useMemo(() => {
    const byWh = {};
    for (const r of summary) {
      if (!visibleProductIds.has(r.product_id)) continue;
      let wh = byWh[r.warehouse_id];
      if (!wh) wh = byWh[r.warehouse_id] = new Map();
      let prod = wh.get(r.product_id);
      if (!prod) {
        prod = {
          product_id:    r.product_id,
          product_title: r.product_title,
          product_sku:   r.product_sku || '',
          product_image: r.product_image || null,
          variations:    new Map(),
        };
        wh.set(r.product_id, prod);
      }
      let vr = prod.variations.get(r.variation_id);
      if (!vr) {
        vr = {
          variation_id:    r.variation_id,
          variation_name:  r.variation_name,
          variation_image: r.variation_image || null,
          skus:            [],
        };
        prod.variations.set(r.variation_id, vr);
      }
      vr.skus.push({
        sku_id:        r.sku_id,
        sku_name:      r.sku_name,
        sku_code:      r.sku_code,
        quantity:      r.quantity,
        sold_quantity: r.sold_quantity || 0,
        cost_price:    r.cost_price ?? null,
        sell_price:    r.sell_price ?? null,
      });
    }
    return byWh;
  }, [summary, visibleProductIds]);

  if (warehouses.length === 0) {
    return <p className="crm-placeholder">{t('products.inventory.noActiveWarehouses')}</p>;
  }

  return (
    <>
      {warehouses.map(w => {
        const productMap = tree[w.id];
        const productsList = productMap ? Array.from(productMap.values()) : [];
        const totalQty = productsList.reduce((a, p) =>
          a + Array.from(p.variations.values()).reduce((b, v) =>
            b + v.skus.reduce((c, s) => c + s.quantity, 0), 0), 0);
        const isOpen = openWh.has(w.id);

        return (
          <section key={w.id} className="prod-group po-wh-group">
            <h2 className="prod-group-title po-wh-group-title" onClick={() => toggleWh(w.id)}>
              <CaretDown weight="bold"
                className={`po-wh-group-caret${isOpen ? '' : ' po-wh-group-caret--closed'}`} />
              {w.name}
              {w.is_default && <span className="po-pwh-default-mark"> · {t('products.inventory.default')}</span>}
              <span className="prod-group-count">{productsList.length}</span>
              <span className="po-set-note po-tree-meta">· {t('products.inventory.unitsTotal', { count: totalQty })}</span>
            </h2>
            {isOpen && (
              productsList.length === 0 ? (
                <p className="crm-placeholder">{t('products.inventory.noStockInWarehouse')}</p>
              ) : (
                <div className="po-set-table">
                  <div className="po-set-row po-set-row--head" style={ROW_STYLE}>
                    <span>{t('products.inventory.colName')}</span>
                    <span className="po-num-head">{t('products.inventory.colPrice')}</span>
                    <span className="po-num-head">{t('products.inventory.colCost')}</span>
                    <span className="po-num-head">{t('products.inventory.colProfit')}</span>
                    <span className="po-num-head">{t('products.inventory.colMargin')}</span>
                    <span className="po-num-head">{t('products.inventory.colSkuCode')}</span>
                    <span className="po-num-head">{t('products.inventory.colStock')}</span>
                    <span className="po-num-head">{t('products.inventory.colSold')}</span>
                    <span></span>
                  </div>
                  {productsList.map(p => {
                    const pKey = `${w.id}:${p.product_id}`;
                    const pOpen = openProd.has(pKey);
                    const variations = Array.from(p.variations.values());
                    const skuCount = variations.reduce((a, v) => a + v.skus.length, 0);
                    const pQty = variations.reduce((a, v) =>
                      a + v.skus.reduce((b, s) => b + s.quantity, 0), 0);
                    const pSold = variations.reduce((a, v) =>
                      a + v.skus.reduce((b, s) => b + (s.sold_quantity || 0), 0), 0);
                    // Roll up cost / profit / margin across every SKU in
                    // every variation of this product (within this WH).
                    const allSkus = variations.flatMap(v => v.skus);
                    const pFin = rollupFinancials(allSkus);
                    return (
                      <Fragment key={pKey}>
                        <PoListRow className="po-tree-row"
                          style={ROW_STYLE}
                          onClick={() => toggleProd(pKey)}>
                          <NameCell depth={0}
                            chevron={pOpen ? 'open' : 'closed'}
                            onChevron={() => toggleProd(pKey)}
                            icon={<Folder weight="duotone" className="po-disc-cell--strong" />}>
                            <span className="po-set-strong">{p.product_title}</span>
                            <span className="po-set-note po-tree-meta">
                              · {variations.length === 1 ? t('products.inventory.variationOne', { count: variations.length }) : t('products.inventory.variationMany', { count: variations.length })}
                              {' · '}{skuCount === 1 ? t('products.inventory.skuOne', { count: skuCount }) : t('products.inventory.skuMany', { count: skuCount })}
                            </span>
                          </NameCell>
                          <span className="po-money-cell">{fmtMoney(pFin.price)}</span>
                          <span className="po-money-cell">{fmtMoney(pFin.cost)}</span>
                          <span className="po-money-cell">{fmtMoney(pFin.profit)}</span>
                          <span className={`po-money-cell po-margin${marginTone(pFin.margin_pct)}`}>
                            {fmtPct(pFin.margin_pct)}
                          </span>
                          <span className="po-set-note po-id-cell">{p.product_sku || '—'}</span>
                          <span className="po-stock-cell">{pQty}</span>
                          <span className="po-numeric-muted">{pSold}</span>
                          <span></span>
                        </PoListRow>

                        {pOpen && variations.map(v => {
                          const vKey = `${w.id}:${p.product_id}:${v.variation_id}`;
                          const vOpen = openVar2.has(vKey);
                          const vQty = v.skus.reduce((a, s) => a + s.quantity, 0);
                          const vSold = v.skus.reduce((a, s) => a + (s.sold_quantity || 0), 0);
                          const vFin = rollupFinancials(v.skus);
                          return (
                            <Fragment key={vKey}>
                              <PoListRow className="po-tree-row"
                                style={ROW_STYLE}
                                onClick={() => toggleVar(vKey)}>
                                <NameCell depth={1}
                                  chevron={vOpen ? 'open' : 'closed'}
                                  onChevron={() => toggleVar(vKey)}
                                  icon={v.variation_image
                                    ? <MediaThumb url={v.variation_image} alt="" className="po-tree-avatar" />
                                    : <span className="po-tree-avatar-fallback" />}>
                                  <span className="po-set-strong">{v.variation_name || '—'}</span>
                                  <span className="po-set-note po-tree-meta">
                                    · {v.skus.length === 1 ? t('products.inventory.skuOne', { count: v.skus.length }) : t('products.inventory.skuMany', { count: v.skus.length })}
                                  </span>
                                </NameCell>
                                <span className="po-money-cell">{fmtMoney(vFin.price)}</span>
                                <span className="po-money-cell">{fmtMoney(vFin.cost)}</span>
                                <span className="po-money-cell">{fmtMoney(vFin.profit)}</span>
                                <span className={`po-money-cell po-margin${marginTone(vFin.margin_pct)}`}>
                                  {fmtPct(vFin.margin_pct)}
                                </span>
                                <span></span>
                                <span className="po-stock-cell po-tree-stock--variation">{vQty}</span>
                                <span className="po-numeric-muted">{vSold}</span>
                                <span></span>
                              </PoListRow>
                              {vOpen && v.skus.map(s => {
                                const payload = {
                                  product_id:         p.product_id,
                                  product_title:      p.product_title,
                                  sku_id:             s.sku_id,
                                  variation_name:     v.variation_name,
                                  configuration_name: s.sku_name,
                                  current_stock:      s.quantity,
                                  warehouse_id:       w.id,
                                  warehouse_name:     w.name,
                                };
                                const sFin = rollupFinancials([s]);
                                return (
                                  <PoListRow key={`${vKey}-${s.sku_id}`}
                                    className="po-tree-row"
                                    style={ROW_STYLE}
                                    onClick={() => onEdit(payload)}>
                                    <NameCell depth={2} icon={<Cube className="po-disc-cell--muted" />}>
                                      <span>{s.sku_name || '—'}</span>
                                    </NameCell>
                                    <span className="po-money-cell">{fmtMoney(sFin.price)}</span>
                                    <span className="po-money-cell">{fmtMoney(sFin.cost)}</span>
                                    <span className="po-money-cell">{fmtMoney(sFin.profit)}</span>
                                    <span className={`po-money-cell po-margin${marginTone(sFin.margin_pct)}`}>
                                      {fmtPct(sFin.margin_pct)}
                                    </span>
                                    <span className="po-set-note po-id-cell">{s.sku_code || '—'}</span>
                                    <span className="po-stock-cell">{s.quantity}</span>
                                    <span className="po-numeric-muted">{s.sold_quantity || 0}</span>
                                    <button type="button" className="po-edit-btn"
                                      onClick={(e) => { e.stopPropagation(); onEdit(payload); }}>
                                      <PencilSimple weight="bold" /> {t('products.inventory.edit')}
                                    </button>
                                  </PoListRow>
                                );
                              })}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </div>
              )
            )}
          </section>
        );
      })}
    </>
  );
}

// ── (legacy) View toggle — kept exported in case Products page reuses it ─

function ViewToggle({ value, onChange }) {
  const { t } = useTranslation();
  const indRef  = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);
  const cur = hovered ?? value;

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el  = btnRefs.current[cur];
      if (!ind || !el) return;
      ind.style.opacity   = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width     = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [cur, value]);

  const opts = [
    { key: 'product',   label: t('products.inventory.byProduct'),   Icon: Tag       },
    { key: 'warehouse', label: t('products.inventory.byWarehouse'), Icon: Warehouse },
  ];

  return (
    <div className="org-sort-toggle" onMouseLeave={() => setHovered(null)}>
      <div ref={indRef} className="org-sort-indicator" />
      {opts.map(({ key, label, Icon }) => (
        <button key={key} ref={el => { btnRefs.current[key] = el; }}
          className={`org-sort-btn${cur === key ? ' org-sort-btn--current' : ''}`}
          onMouseEnter={() => setHovered(key)}
          onClick={() => onChange(key)} type="button">
          <Icon weight="bold" className="org-sort-icon" />
          {label}
        </button>
      ))}
    </div>
  );
}

// ── "By warehouse" view — folder per WH using accurate summary endpoint.

function WarehouseView({ projectId, pq, refreshKey, warehouses, onEdit }) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState(null);
  const [openWh, setOpenWh]   = useState(() => new Set());

  useEffect(() => {
    fetch(`${API_BASE}/api/projects/${projectId}/stock/per-warehouse-summary${pq}`,
          { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setSummary(Array.isArray(d) ? d : []))
      .catch(() => setSummary([]));
  }, [projectId, pq, refreshKey]);

  const grouped = useMemo(() => {
    const out = {};
    for (const w of warehouses) out[w.id] = [];
    for (const r of (summary || [])) {
      if (!out[r.warehouse_id]) continue;     // WH may have been deactivated since fetch
      out[r.warehouse_id].push(r);
    }
    return out;
  }, [summary, warehouses]);

  if (warehouses.length === 0) {
    return <p className="crm-placeholder">{t('products.inventory.noActiveWarehouses')}</p>;
  }
  if (summary === null) {
    return <p className="crm-placeholder">{t('common.loading')}</p>;
  }
  return (
    <div className="po-set-table">
      <div className="po-set-row po-set-row--head" style={{ gridTemplateColumns: '2.6fr 1fr 1fr 1fr 110px' }}>
        <span>{t('products.inventory.colWarehouseSku')}</span><span>{t('products.inventory.colSkuCode')}</span><span>{t('products.inventory.colQty')}</span><span></span><span></span>
      </div>
      {warehouses.map(w => {
        const skus = grouped[w.id] || [];
        const isOpen = openWh.has(w.id);
        const total = skus.reduce((a, s) => a + (s.quantity || 0), 0);
        const toggleWh = () => setOpenWh(prev => {
          const n = new Set(prev);
          if (n.has(w.id)) n.delete(w.id); else n.add(w.id);
          return n;
        });
        return (
          <Fragment key={w.id}>
            <PoListRow className="po-tree-row"
              style={{ gridTemplateColumns: '2.6fr 1fr 1fr 1fr 110px' }}
              onClick={toggleWh}>
              <NameCell depth={0} chevron={isOpen ? 'open' : 'closed'}
                onChevron={toggleWh}
                icon={<Warehouse weight="duotone" className="po-disc-cell--strong" />}>
                <span className="po-set-strong">{w.name}</span>
                {w.is_default && <span className="po-set-note po-pwh-default-mark"> · {t('products.inventory.default')}</span>}
                <span className="po-set-note po-tree-meta">
                  · {skus.length === 1 ? t('products.inventory.skuOne', { count: skus.length }) : t('products.inventory.skuMany', { count: skus.length })}
                </span>
              </NameCell>
              <span></span>
              <span className="po-stock-cell">{total}</span>
              <span></span>
              <span></span>
            </PoListRow>
            {isOpen && skus.length === 0 && (
              <div className="po-set-row po-tree-loading-row"
                style={{ gridTemplateColumns: '2.6fr 1fr 1fr 1fr 110px' }}>
                <span className="po-tree-loading-text">{t('products.inventory.noStockInWarehouse')}</span>
                <span></span><span></span><span></span><span></span>
              </div>
            )}
            {isOpen && skus.map(s => {
              const payload = {
                product_id: s.product_id,
                product_title: s.product_title,
                sku_id: s.sku_id,
                variation_name: s.variation_name,
                configuration_name: s.sku_name,
                current_stock: s.quantity,
              };
              return (
                <PoListRow key={`${w.id}-${s.sku_id}`} className="po-tree-row"
                  style={{ gridTemplateColumns: '2.6fr 1fr 1fr 1fr 110px' }}
                  onClick={() => onEdit(payload)}>
                  <NameCell depth={1} icon={<Cube className="po-disc-cell--muted" />}>
                    <span className="po-set-strong">{s.product_title}</span>
                    <span className="po-set-note"> / {s.variation_name} / {s.sku_name}</span>
                  </NameCell>
                  <span className="po-set-note">{s.sku_code || '—'}</span>
                  <span className="po-stock-cell">{s.quantity}</span>
                  <span className="po-numeric-muted"></span>
                  <button type="button" className="po-edit-btn"
                    onClick={(e) => { e.stopPropagation(); onEdit(payload); }}>
                    <PencilSimple weight="bold" /> {t('products.inventory.edit')}
                  </button>
                </PoListRow>
              );
            })}
          </Fragment>
        );
      })}
    </div>
  );
}

// ── Filter pill toggle with sliding Dynamic Block indicator ─────────

function FilterToggle({ value, onChange, counters }) {
  const { t } = useTranslation();
  const indRef  = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);
  const cur = hovered ?? value;

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el  = btnRefs.current[cur];
      if (!ind || !el) return;
      ind.style.opacity   = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width     = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [cur, value]);

  return (
    <div className="org-sort-toggle" onMouseLeave={() => setHovered(null)}>
      <div ref={indRef} className="org-sort-indicator" />
      {FILTERS.map(({ key, labelKey }) => (
        <button key={key} ref={el => { btnRefs.current[key] = el; }}
          className={`org-sort-btn${cur === key ? ' org-sort-btn--current' : ''}`}
          onMouseEnter={() => setHovered(key)}
          onClick={() => onChange(key)} type="button">
          {t(labelKey)} <span className="po-filter-count">({counters[key] ?? 0})</span>
        </button>
      ))}
    </div>
  );
}

// ── Product folder + nested variations + leaf SKUs ───────────────────

function ProductBranch({ product, isOpen, hydrated, detail, openVar, onToggleProduct, onToggleVar, onEdit }) {
  const { t } = useTranslation();
  const variations = detail?.variations || [];
  const skuCount = variations.reduce((sum, v) => sum + (v.configurations?.length || 0), 0);

  return (
    <>
      <PoListRow className="po-tree-row"
        style={{ gridTemplateColumns: COLS }}
        onClick={onToggleProduct}>
        <NameCell depth={0} chevron={isOpen ? 'open' : 'closed'} onChevron={onToggleProduct}
          icon={<Folder weight="duotone" className="po-disc-cell--strong" />}>
          <span className="po-set-strong">{product.title}</span>
          <span className="po-set-note po-tree-meta">
            · {product.variations_count === 1 ? t('products.inventory.variationOne', { count: product.variations_count }) : t('products.inventory.variationMany', { count: product.variations_count || 0 })}
            {hydrated ? ` · ${skuCount === 1 ? t('products.inventory.skuOne', { count: skuCount }) : t('products.inventory.skuMany', { count: skuCount })}` : ''}
          </span>
        </NameCell>
        <span className="po-set-note">{product.sku || '—'}</span>
        <span className="po-stock-cell">{product.total_stock || 0}</span>
        <span></span>
        <span></span>
      </PoListRow>

      {isOpen && !hydrated && (
        <div className="po-set-row po-tree-loading-row"
          style={{ gridTemplateColumns: COLS }}>
          <span className="po-tree-loading-text">{t('common.loading')}</span>
          <span></span><span></span><span></span><span></span>
        </div>
      )}

      {isOpen && hydrated && variations.map(v => {
        const vKey = `${product.id}-${v.id}`;
        const vOpen = openVar.has(vKey);
        const confs = v.configurations || [];
        const vStock = confs.reduce((s, c) => s + (c.stock_quantity || 0), 0);
        return (
          <Fragment key={v.id}>
            <PoListRow className="po-tree-row"
              style={{ gridTemplateColumns: COLS }}
              onClick={() => onToggleVar(v.id)}>
              <NameCell depth={1} chevron={vOpen ? 'open' : 'closed'}
                onChevron={() => onToggleVar(v.id)}
                icon={<VariationAvatar variation={v} />}>
                <span className="po-set-strong">{v.variation_name || v.name || '—'}</span>
                <span className="po-set-note po-tree-meta">
                  · {confs.length === 1 ? t('products.inventory.skuOne', { count: confs.length }) : t('products.inventory.skuMany', { count: confs.length })}
                </span>
              </NameCell>
              <span></span>
              <span className="po-stock-cell po-tree-stock--variation">{vStock}</span>
              <span></span>
              <span></span>
            </PoListRow>

            {vOpen && confs.map(c => (
              <PoListRow key={c.id}
                className="po-tree-row"
                style={{ gridTemplateColumns: COLS }}
                onClick={() => onEdit({
                  product_id: product.id,
                  product_title: product.title,
                  sku_id: c.id,
                  variation_name: v.variation_name || v.name || '—',
                  configuration_name: c.configuration_name || c.name || '—',
                  current_stock: c.stock_quantity || 0,
                })}>
                <NameCell depth={2} icon={<Cube className="po-disc-cell--muted" />}>
                  <span>{c.configuration_name || c.name || '—'}</span>
                </NameCell>
                <span className="po-set-note">{c.sku_code || '—'}</span>
                <StockCell stock={c.stock_quantity || 0} threshold={detail.low_stock_threshold || 0} />
                <span className="po-numeric-muted">{c.sold_quantity || 0}</span>
                <button type="button" className="po-edit-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit({
                      product_id: product.id,
                      product_title: product.title,
                      sku_id: c.id,
                      variation_name: v.variation_name || v.name || '—',
                      configuration_name: c.configuration_name || c.name || '—',
                      current_stock: c.stock_quantity || 0,
                    });
                  }}>
                  <PencilSimple weight="bold" /> {t('products.inventory.edit')}
                </button>
              </PoListRow>
            ))}
          </Fragment>
        );
      })}
    </>
  );
}

// ── Cells ────────────────────────────────────────────────────────────

function NameCell({ depth = 0, chevron, onChevron, icon, children }) {
  const { t } = useTranslation();
  // Padding is the only depth-variable bit; everything else lives in CSS.
  const padLeft = 8 + depth * 24;
  return (
    <span className="po-tree-name-cell" style={{ paddingLeft: padLeft }}>
      {chevron ? (
        <button type="button" className="po-tree-chevron"
          onClick={(e) => { e.stopPropagation(); onChevron?.(); }}
          aria-label={chevron === 'open' ? t('common.collapse') : t('products.inventory.expand')}>
          {chevron === 'open' ? <CaretDown weight="bold" /> : <CaretRight weight="bold" />}
        </button>
      ) : (
        <span className="po-tree-chevron-spacer" />
      )}
      {icon && <span className="po-tree-icon">{icon}</span>}
      {children}
    </span>
  );
}

function VariationAvatar({ variation }) {
  const img = variation.images?.[0];
  if (img) return <img src={img} alt="" className="po-tree-avatar" />;
  return <span className="po-tree-avatar-fallback" />;
}

function StockCell({ stock, threshold }) {
  const { t } = useTranslation();
  const oos = stock <= 0;
  const low = !oos && threshold > 0 && stock <= threshold;
  const cls = oos ? 'po-stock-cell po-stock-cell--out'
            : low ? 'po-stock-cell po-stock-cell--low'
            : 'po-stock-cell';
  return <span className={cls}>{oos ? t('products.inventory.stockOut') : low ? t('products.inventory.stockLow', { count: stock }) : stock}</span>;
}

// ── Flat list shown when filter = Low / OOS ─────────────────────────

function FlatMatchList({ rows, onEdit }) {
  const { t } = useTranslation();
  if (!rows) return <p className="crm-placeholder">{t('common.loading')}</p>;
  if (rows.length === 0) return <p className="crm-placeholder">{t('products.inventory.noSkusMatch')}</p>;
  return (
    <div className="po-set-table">
      <div className="po-set-row po-set-row--head" style={ROW_STYLE}>
        <span>{t('products.inventory.colProductVariationSku')}</span>
        <span className="po-num-head">{t('products.inventory.colPrice')}</span>
        <span className="po-num-head">{t('products.inventory.colCost')}</span>
        <span className="po-num-head">{t('products.inventory.colProfit')}</span>
        <span className="po-num-head">{t('products.inventory.colMargin')}</span>
        <span className="po-num-head">{t('products.inventory.colSkuCode')}</span>
        <span className="po-num-head">{t('products.inventory.colStock')}</span>
        <span className="po-num-head">{t('products.inventory.colSold')}</span>
        <span></span>
      </div>
      {rows.map(r => {
        const payload = {
          product_id: r.product_id,
          product_title: r.product_title,
          sku_id: r.sku_id,
          variation_name: r.variation_name,
          configuration_name: r.configuration_name,
          current_stock: r.stock,
        };
        // Same rollup helper as the tree view — single-SKU "rollup" so
        // the columns read identically whether we're in the tree or the
        // flat Low/OOS view.
        const fin = rollupFinancials([{
          quantity:   r.stock,
          cost_price: r.cost_price,
          sell_price: r.sell_price,
        }]);
        return (
          <PoListRow key={r.sku_id} className="po-tree-row po-flat-row"
            style={ROW_STYLE}
            onClick={() => onEdit(payload)}>
            <span className="po-flat-name-cell">
              <span className="po-set-strong">{r.product_title}</span>
              <span className="po-set-note"> · {r.variation_name} · {r.configuration_name}</span>
            </span>
            <span className="po-money-cell">{fmtMoney(fin.price)}</span>
            <span className="po-money-cell">{fmtMoney(fin.cost)}</span>
            <span className="po-money-cell">{fmtMoney(fin.profit)}</span>
            <span className={`po-money-cell po-margin${marginTone(fin.margin_pct)}`}>
              {fmtPct(fin.margin_pct)}
            </span>
            <span className="po-set-note po-id-cell">{r.sku_code || '—'}</span>
            <StockCell stock={r.stock} threshold={r.threshold} />
            <span className="po-numeric-muted">{r.sold}</span>
            <button type="button" className="po-edit-btn"
              onClick={(e) => { e.stopPropagation(); onEdit(payload); }}>
              <PencilSimple weight="bold" /> {t('products.inventory.edit')}
            </button>
          </PoListRow>
        );
      })}
    </div>
  );
}

// ── Edit stock modal ─────────────────────────────────────────────────

function EditStockModal({ target, pq, projectId, warehouses, onClose, onSaved, showToast }) {
  const { t } = useTranslation();
  const [delta,     setDelta]     = useState('');
  const [reason,    setReason]    = useState('supplier_delivery');
  const [note,      setNote]      = useState('');
  // Warehouse: preselect from target if known, else project default, else first active.
  const initialWh = target.warehouse_id
    ?? (warehouses.find(w => w.is_default)?.id ?? warehouses[0]?.id ?? '');
  const [warehouse, setWarehouse] = useState(initialWh);
  // Edit stock is EDIT only — can't create new batches here. Batch is REQUIRED and
  // must reference an existing inventory_batches row at (sku, warehouse).
  const [batchChoice, setBatchChoice] = useState('');         // '' | 'existing:<id>'
  const [batchOpts,   setBatchOpts]   = useState([]);
  const [busy,        setBusy]        = useState(false);

  const dInt = parseInt(delta, 10);
  const isPositive = Number.isFinite(dInt) && dInt > 0;
  const isNegative = Number.isFinite(dInt) && dInt < 0;

  // Refetch existing batches whenever (warehouse, sku) changes.
  useEffect(() => {
    if (!warehouse) { setBatchOpts([]); setBatchChoice(''); return; }
    let cancelled = false;
    fetch(
      `${API_BASE}/api/projects/${projectId}/batches/lookup?sku_id=${target.sku_id}&warehouse_id=${warehouse}`,
      { credentials: 'include' }
    ).then(r => r.ok ? r.json() : [])
     .then(list => {
       if (cancelled) return;
       const arr = Array.isArray(list) ? list : [];
       setBatchOpts(arr);
       // Reset the picker — old batch_id may not exist at the new warehouse.
       setBatchChoice('');
     });
    return () => { cancelled = true; };
  }, [projectId, target.sku_id, warehouse]);

  // Pick currently-selected batch (for clamping negative delta).
  const selectedBatch = batchChoice.startsWith('existing:')
    ? batchOpts.find(b => b.id === Number(batchChoice.slice(9)))
    : null;

  const submit = async () => {
    if (!dInt || isNaN(dInt)) { showToast(t('products.inventory.editModal.errNonZero')); return; }
    if (!warehouse) { showToast(t('products.inventory.editModal.errPickWarehouse')); return; }
    if (!batchChoice.startsWith('existing:')) { showToast(t('products.inventory.editModal.errPickBatch')); return; }
    // Client-side guard — backend also rejects this but a clear message is nicer.
    if (isNegative && selectedBatch && Math.abs(dInt) > selectedBatch.quantity_remaining) {
      showToast(t('products.inventory.editModal.errOnlyLeft', { count: selectedBatch.quantity_remaining })); return;
    }
    setBusy(true);
    try {
      const body = {
        sku_id:       target.sku_id,
        delta:        dInt,
        reason,
        note,
        warehouse_id: Number(warehouse),
        batch_id:     Number(batchChoice.slice(9)),
      };
      const r = await fetch(`${API_BASE}/api/products/${target.product_id}/stock/adjust${pq}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.ok) { onSaved?.(); }
      else { const j = await r.json().catch(() => ({})); showToast(j.detail || t('products.inventory.editModal.failed')); }
    } finally { setBusy(false); }
  };

  const preview = (() => {
    if (!Number.isFinite(dInt)) return null;
    return Math.max(0, target.current_stock + dInt);
  })();

  // Only existing batches — Edit stock doesn't create new ones (use Plan stock receipt for that).
  const batchSelectOptions = batchOpts.map(b => {
    const verb = isNegative ? t('products.inventory.editModal.takeFrom') : isPositive ? t('products.inventory.editModal.addTo') : t('products.inventory.edit');
    return {
      value: `existing:${b.id}`,
      label: t('products.inventory.editModal.batchOption', { verb, name: b.batch_name, count: b.quantity_remaining }),
    };
  });
  const noBatches = warehouse && batchOpts.length === 0;

  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal po-edit-stock-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">{t('products.inventory.editModal.title')}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {target.product_title} · {target.variation_name} · {target.configuration_name}
                  {' · '}{t('products.inventory.editModal.current')}{' '}<strong>{target.current_stock}</strong>
                </span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body">
          <form className="cpm-form"
            onSubmit={(e) => { e.preventDefault(); submit(); }}
            autoComplete="off">

            <div className="cpm-datetime-row">
              <div className="cpm-section">
                <label className="po-field-label">{t('products.inventory.editModal.warehouse')}</label>
                <Combobox value={warehouse === '' ? '' : Number(warehouse)}
                  placeholder={t('products.inventory.editModal.pickWarehouse')}
                  options={warehouses.map(w => ({
                    value: w.id,
                    label: w.is_default ? `${w.name} · ${t('products.inventory.default')}` : w.name,
                  }))}
                  onChange={(v) => setWarehouse(v === '' ? '' : Number(v))} />
              </div>
              <div className="cpm-section">
                <label className="po-field-label">{t('products.inventory.editModal.change')}</label>
                <input className="crm-input" type="number" autoFocus
                  placeholder={t('products.inventory.editModal.changePlaceholder')}
                  value={delta} onChange={e => setDelta(e.target.value)} />
                <span className="cpm-section-hint">
                  {t('products.inventory.editModal.changeHint')}
                  {preview !== null && (
                    <> &nbsp;·&nbsp; {t('products.inventory.editModal.newStock')}{' '}
                      <strong className="po-disc-cell--strong">{preview}</strong>
                    </>
                  )}
                </span>
              </div>
            </div>

            <div className="cpm-section">
              <label className="po-field-label">{t('products.inventory.editModal.batch')} <span className="po-field-required">*</span></label>
              <Combobox value={batchChoice}
                options={batchSelectOptions}
                placeholder={noBatches ? t('products.inventory.editModal.noBatchesPlaceholder') : t('products.inventory.editModal.pickBatchPlaceholder')}
                onChange={(v) => setBatchChoice(v)} />
              <span className="cpm-section-hint">
                {noBatches
                  ? <span dangerouslySetInnerHTML={{ __html: t('products.inventory.editModal.noBatchesHint') }} />
                  : isNegative
                    ? <>{t('products.inventory.editModal.negativeHint')}{selectedBatch ? ` ${t('products.inventory.editModal.available', { count: selectedBatch.quantity_remaining })}` : ''}</>
                    : <span dangerouslySetInnerHTML={{ __html: t('products.inventory.editModal.editHint') }} />}
              </span>
            </div>

            <div className="cpm-section">
              <label className="po-field-label">{t('products.inventory.editModal.reason')}</label>
              <Combobox value={reason} options={REASON_OPTIONS.map(o => ({ value: o.value, label: t(o.labelKey) }))}
                onChange={(v) => setReason(v)} />
            </div>

            <div className="cpm-section">
              <label className="po-field-label">{t('products.inventory.editModal.note')}</label>
              <input className="crm-input" type="text"
                placeholder={t('products.inventory.editModal.notePlaceholder')}
                value={note} onChange={e => setNote(e.target.value)} maxLength={1000} />
            </div>

            <div className="auth-actions">
              <button className="crm-submit-btn" type="submit" disabled={busy}>
                {busy ? t('products.inventory.editModal.applying') : t('products.inventory.editModal.apply')}
              </button>
              <button className="crm-submit-btn auth-btn-secondary"
                type="button" disabled={busy} onClick={onClose}>
                {t('common.cancel')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default ProductsInventory