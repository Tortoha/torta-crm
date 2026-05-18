import { Fragment, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import {
  MagnifyingGlass, CaretRight, CaretDown,
  Folder, Cube, PencilSimple, X, Percent, CurrencyDollar, Tag,
  ArrowDown, FolderSimple,
} from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { formatMoney } from '../../../Utils/currency.js';
import { PoListRow } from '../../../Utils/PoListRow.jsx';
import { DateTimePicker } from '../../../Utils/DateTimePicker.jsx';
import { DynamicBlock } from '../../../Utils/DynamicBlock.js';
import '../../../Style/Authentication.css';
import '../../../Style/Products.css';
import '../../../Style/Organization.css';

const SORT_OPTIONS = [
  { field: 'name',       label: 'Sort by name'  },
  { field: 'stock',      label: 'Sort by stock' },
  { field: 'variations', label: 'Sort by SKUs'  },
];
const DEFAULT_DIR = { name: 'asc', stock: 'desc', variations: 'desc' };

const COLS = '2.4fr 1fr 0.9fr 1.4fr 1.2fr 110px';

// Walk-up sale resolver — mirrors External logic for matching storefront effective discount.
function resolveActiveSale(now, ...layers) {
  for (const layer of layers) {
    if (!layer) continue;
    const [st, sv, ss, se] = layer;
    if (!st || sv == null) continue;
    const ssDate = ss ? new Date(ss) : null;
    const seDate = se ? new Date(se) : null;
    if (ssDate && ssDate > now) continue;
    if (seDate && seDate < now) continue;
    return { type: st, value: Number(sv), starts: ss, ends: se };
  }
  return null;
}

function ownSaleTuple(node) {
  // Reads sale_type/value/start/end — legacy sale_price already migrated server-side.
  if (!node) return null;
  if (!node.sale_type) return null;
  return [node.sale_type, node.sale_value, node.sale_starts_at, node.sale_ends_at];
}

function formatDiscountSummary(sale) {
  if (!sale) return '—';
  if (sale.type === 'percent') return `−${sale.value}%`;
  // Amount-off and fixed-price summaries — render in project currency
  // (e.g. "−5₸" instead of always "−$5"). `__DISC_CURRENCY` is synced
  // by the page-level effect; no per-call param needed.
  if (sale.type === 'amount')  return `−${formatMoney(sale.value, __DISC_CURRENCY)}`;
  if (sale.type === 'fixed')   return formatMoney(sale.value, __DISC_CURRENCY);
  return '—';
}

// Returns {min,max} of effective prices across all leaf SKUs under a node (null if none).
function collectPrices(node) {
  const out = [];
  const push = (p) => { if (p != null) out.push(Number(p)); };
  if (node?.configurations) {
    for (const c of node.configurations) push(c.effective_price ?? c.price);
  } else if (node?.variations) {
    for (const v of node.variations) {
      for (const c of (v.configurations || [])) push(c.effective_price ?? c.price);
    }
  } else if (node) {
    push(node.effective_price ?? node.price);
  }
  return out;
}

function priceRange(node) {
  if (!node) return null;
  // Walk-down — handles hydrated tree and already-leaf configuration rows.
  const ps = collectPrices(node);
  if (ps.length > 0) return { min: Math.min(...ps), max: Math.max(...ps) };
  // Fallback for list-endpoint product rows carrying only min/max aggregates.
  if (node.min_price !== undefined && node.max_price !== undefined) {
    if (node.min_price === 0 && node.max_price === 0) return null;
    return { min: node.min_price, max: node.max_price };
  }
  return null;
}

function applySale(price, sale) {
  if (price == null || !sale) return price;
  if (sale.type === 'percent') return Math.max(0, price * (1 - sale.value / 100));
  if (sale.type === 'amount')  return Math.max(0, price - sale.value);
  if (sale.type === 'fixed')   return Math.max(0, sale.value);
  return price;
}

function applySaleToRange(range, sale) {
  if (!range || !sale) return range;
  return { min: applySale(range.min, sale), max: applySale(range.max, sale) };
}

// Project-currency-aware price formatter. The Discounts page sets
// __DISC_CURRENCY at mount from project metadata, then every fmtPrice
// call inside SaleWindowCell / fmtRange picks it up automatically.
let __DISC_CURRENCY = 'USD';
const setDiscountsCurrency = (c) => { __DISC_CURRENCY = c || 'USD'; };
function fmtPrice(p) {
  if (p == null) return '—';
  const n = Number(p);
  // Whole-number prices render without decimals — "$30" not "$30.00"
  // — when the underlying value is integer, matching how merchants
  // expect a $30 / $30.00 distinction on a busy comparison view.
  const opts = (n % 1 === 0) ? { decimals: 0 } : undefined;
  return formatMoney(n, __DISC_CURRENCY, opts);
}

function fmtRange(range) {
  if (!range) return '—';
  if (range.min === range.max) return fmtPrice(range.min);
  return `${fmtPrice(range.min)}–${fmtPrice(range.max)}`;
}

export default function Discounts() {
  const { projectId, project } = useOutletContext();
  // Push project's currency into the module global so fmtPrice picks
  // it up. Without this every price would render as USD regardless
  // of the merchant's choice.
  useEffect(() => { setDiscountsCurrency(project?.currency || 'USD'); }, [project?.currency]);
  const pq = `?project_id=${projectId}`;

  const [products, setProducts]   = useState([]);   // list endpoint rows (cheap)
  const [categories, setCategories] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [sort, setSort]           = useState({ field: 'name', dir: 'asc' });
  const [categoryFilter, setCategoryFilter] = useState(null); // null | 'uncategorized' | <id>
  // expanded[pid] = { hydrated, loading, data }  — full product tree lives here
  const [expanded, setExpanded]   = useState({});
  const [openVar, setOpenVar]     = useState(new Set());
  const [editTarget, setEditTarget] = useState(null);
  const [toast, setToast] = useState('');

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2400);
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    let url = `${API_BASE}/api/products${pq}`;
    if (categoryFilter === 'uncategorized')      url += '&uncategorized=true';
    else if (typeof categoryFilter === 'number') url += `&category_id=${categoryFilter}`;
    try {
      const r = await fetch(url, { credentials: 'include' });
      if (r.ok) {
        const list = await r.json();
        setProducts(list);
        setExpanded({});
        setOpenVar(new Set());
      } else { setProducts([]); }
    } finally { setLoading(false); }
  }, [pq, categoryFilter]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  useEffect(() => {
    fetch(`${API_BASE}/api/categories${pq}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setCategories(Array.isArray(d) ? d : []))
      .catch(() => setCategories([]));
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

  // Picks URL by scope; returns { ok, error } so callers surface backend message verbatim.
  const saveDiscount = async (target, body) => {
    let url;
    if (target.scope === 'product') {
      url = `${API_BASE}/api/products/${target.product_id}${pq}`;
    } else if (target.scope === 'variation') {
      url = `${API_BASE}/api/products/${target.product_id}/layers/1/${target.entity_id}${pq}`;
    } else {
      url = `${API_BASE}/api/products/${target.product_id}/layers/2/${target.entity_id}${pq}`;
    }
    try {
      const r = await fetch(url, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.ok) return { ok: true };
      const j = await r.json().catch(() => ({}));
      return { ok: false, error: j.detail || `HTTP ${r.status}` };
    } catch (e) {
      return { ok: false, error: e.message || 'Network error' };
    }
  };

  // After-save sync: only touches the affected row (re-hydrate for non-product scope).
  const refreshAfterSave = async (target, body) => {
    if (target.scope === 'product') {
      setProducts(prev => prev.map(p => p.id === target.product_id
        ? {
            ...p,
            sale_type:      body.sale_type,
            sale_value:     body.sale_value,
            sale_starts_at: body.sale_starts_at,
            sale_ends_at:   body.sale_ends_at,
          }
        : p));
    } else {
      await hydrateProduct(target.product_id);
    }
  };

  return (
    <>
      <p className="po-block-hint">
        Automatic time-based discounts. Apply to a whole product, a single
        variation, or one specific SKU — children inherit unless they have
        their own. Pick type (percent / amount / fixed price) + window, and
        the storefront automatically renders strike-through + "On sale" badge
        while the window is open. For customer-entered codes use the Promo
        codes tab.
      </p>

      <div className="org-toolbar">
        <div className="org-search-wrap">
          <MagnifyingGlass className="org-search-icon" />
          <input className="org-search-input" placeholder="Search products…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="po-toolbar-right">
          <SortToggle sort={sort} onSort={setSort} />
          <CategoryFilter value={categoryFilter} categories={categories}
            onChange={setCategoryFilter} />
        </div>
      </div>

      {loading ? (
        <p className="crm-placeholder">Loading…</p>
      ) : filteredProducts.length === 0 ? (
        <p className="crm-placeholder">
          {products.length === 0 ? 'No products yet.' : 'No products match the search.'}
        </p>
      ) : (
        <div className="po-set-table">
          <div className="po-set-row po-set-row--head" style={{ gridTemplateColumns: COLS }}>
            <span>Name</span><span>Type</span><span>Value</span><span>Price</span><span>Window</span><span></span>
          </div>
          {filteredProducts.map(p => {
            const e = expanded[p.id];
            return (
              <ProductBranch key={p.id} product={p}
                isOpen={!!e?.hydrated || !!e?.loading}
                hydrated={e?.hydrated}
                detail={e?.data}
                openVar={openVar}
                onToggleProduct={() => toggleProduct(p.id)}
                onToggleVar={(vid) => toggleVar(p.id, vid)}
                onEdit={setEditTarget} />
            );
          })}
        </div>
      )}

      {editTarget && (
        <EditDiscountModal target={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={async (body) => {
            const res = await saveDiscount(editTarget, body);
            if (res.ok) {
              await refreshAfterSave(editTarget, body);
              showToast('Saved');
              setEditTarget(null);
            } else { showToast(`Save failed: ${res.error}`); }
          }}
          onDelete={async () => {
            const cleared = {
              sale_type: null, sale_value: null,
              sale_starts_at: null, sale_ends_at: null,
            };
            const res = await saveDiscount(editTarget, cleared);
            if (res.ok) {
              await refreshAfterSave(editTarget, cleared);
              showToast('Discount removed');
              setEditTarget(null);
            } else { showToast(`Delete failed: ${res.error}`); }
          }} />
      )}

      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
    </>
  );
}

// ── Branch components ────────────────────────────────────────────────

function ProductBranch({ product, isOpen, hydrated, detail, openVar, onToggleProduct, onToggleVar, onEdit }) {
  const now = new Date();
  const variations = detail?.variations || [];
  const skuCount = variations.reduce((sum, v) => sum + (v.configurations?.length || 0), 0);
  const prodTuple = ownSaleTuple(product);
  const prodSale  = prodTuple ? resolveActiveSale(now, prodTuple) : null;

  const openEditProduct = () => onEdit({
    scope: 'product',
    product_id: product.id,
    entity_id: product.id,
    title: product.title,
    breadcrumb: product.title,
    range: priceRange(product),
    initial: {
      sale_type:      product.sale_type      || 'percent',
      sale_value:     product.sale_value     ?? '',
      sale_starts_at: product.sale_starts_at || '',
      sale_ends_at:   product.sale_ends_at   || '',
    },
    has_existing: !!product.sale_type,
  });

  return (
    <>
      <PoListRow className="po-tree-row"
        style={{ gridTemplateColumns: COLS }}
        onClick={openEditProduct}>
        <NameCell depth={0}
          chevron={isOpen ? 'open' : 'closed'}
          onChevron={onToggleProduct}
          icon={<Folder weight="duotone" className="po-disc-cell--strong" />}>
          <span className="po-set-strong">{product.title}</span>
          <span className="po-set-note po-tree-meta">
            · {product.variations_count || 0} variation{product.variations_count === 1 ? '' : 's'}
            {hydrated ? ` · ${skuCount} SKU${skuCount === 1 ? '' : 's'}` : ''}
          </span>
        </NameCell>
        <SaleTypeCell sale={prodSale} ownTuple={prodTuple} />
        <SaleValueCell sale={prodSale} ownTuple={prodTuple} />
        <PriceCell node={product} sale={prodSale} />
        <SaleWindowCell sale={prodSale} fallback={prodTuple} />
        <button type="button" className="po-edit-btn"
          onClick={(e) => { e.stopPropagation(); openEditProduct(); }}>
          <PencilSimple weight="bold" /> Edit
        </button>
      </PoListRow>

      {isOpen && !hydrated && (
        <div className="po-set-row po-tree-loading-row"
          style={{ gridTemplateColumns: COLS }}>
          <span className="po-tree-loading-text">Loading…</span>
          <span></span><span></span><span></span><span></span><span></span>
        </div>
      )}

      {isOpen && hydrated && variations.map(v => {
        const vKey = `${product.id}-${v.id}`;
        const vOpen = openVar.has(vKey);
        const confs = v.configurations || [];
        const varTuple = ownSaleTuple(v);
        const varSale  = resolveActiveSale(now, varTuple, prodTuple);

        const openEditVar = () => onEdit({
          scope: 'variation',
          product_id: product.id,
          entity_id: v.id,
          title: v.variation_name || v.name || '—',
          breadcrumb: `${product.title} / ${v.variation_name || v.name || '—'}`,
          range: priceRange(v),
          initial: {
            sale_type:      v.sale_type      || 'percent',
            sale_value:     v.sale_value     ?? '',
            sale_starts_at: v.sale_starts_at || '',
            sale_ends_at:   v.sale_ends_at   || '',
          },
          has_existing: !!v.sale_type,
        });

        return (
          <Fragment key={v.id}>
            <PoListRow className="po-tree-row"
              style={{ gridTemplateColumns: COLS }}
              onClick={openEditVar}>
              <NameCell depth={1}
                chevron={vOpen ? 'open' : 'closed'}
                onChevron={() => onToggleVar(v.id)}
                icon={<VariationAvatar variation={v} />}>
                <span className="po-set-strong">{v.variation_name || v.name || '—'}</span>
                <span className="po-set-note po-tree-meta">
                  · {confs.length} SKU{confs.length === 1 ? '' : 's'}
                </span>
              </NameCell>
              <SaleTypeCell sale={varSale} ownTuple={varTuple} />
              <SaleValueCell sale={varSale} ownTuple={varTuple} />
              <PriceCell node={v} sale={varSale} />
              <SaleWindowCell sale={varSale} fallback={varTuple} />
              <button type="button" className="po-edit-btn"
                onClick={(e) => { e.stopPropagation(); openEditVar(); }}>
                <PencilSimple weight="bold" /> Edit
              </button>
            </PoListRow>

            {vOpen && confs.map(c => {
              const cTuple = ownSaleTuple(c);
              const cSale  = resolveActiveSale(now, cTuple, varTuple, prodTuple);
              const openEditCfg = () => onEdit({
                scope: 'configuration',
                product_id: product.id,
                entity_id: c.id,
                title: c.configuration_name || c.name || '—',
                breadcrumb: `${product.title} / ${v.variation_name || v.name} / ${c.configuration_name || c.name}`,
                range: priceRange(c),
                initial: {
                  sale_type:      c.sale_type      || 'percent',
                  sale_value:     c.sale_value     ?? '',
                  sale_starts_at: c.sale_starts_at || '',
                  sale_ends_at:   c.sale_ends_at   || '',
                },
                has_existing: !!c.sale_type,
              });
              return (
                <PoListRow key={c.id} className="po-tree-row"
                  style={{ gridTemplateColumns: COLS }}
                  onClick={openEditCfg}>
                  <NameCell depth={2} icon={<Cube className="po-disc-cell--muted" />}>
                    <span>{c.configuration_name || c.name || '—'}</span>
                    {c.sku_code && <span className="po-set-note po-tree-meta">· {c.sku_code}</span>}
                  </NameCell>
                  <SaleTypeCell sale={cSale} ownTuple={cTuple} />
                  <SaleValueCell sale={cSale} ownTuple={cTuple} />
                  <PriceCell node={c} sale={cSale} />
                  <SaleWindowCell sale={cSale} fallback={cTuple} />
                  <button type="button" className="po-edit-btn"
                    onClick={(e) => { e.stopPropagation(); openEditCfg(); }}>
                    <PencilSimple weight="bold" /> Edit
                  </button>
                </PoListRow>
              );
            })}
          </Fragment>
        );
      })}
    </>
  );
}

// ── Sort + Category toolbar widgets (mirrors Inventory) ─────────────

function SortToggle({ sort, onSort }) {
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
      {SORT_OPTIONS.map(({ field, label }) => {
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
            {label}
          </button>
        );
      })}
    </div>
  );
}

function CategoryFilter({ value, categories, onChange }) {
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

  const label = value === null ? 'All Categories'
    : value === 'uncategorized' ? 'Uncategorized'
    : (categories.find(c => c.id === value)?.name || 'Category');

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
            All Categories
          </button>
          <button ref={setItemRef('uncat')}
            className={`cat-filter-item${current === 'uncat' ? ' cat-filter-item--current' : ''}`}
            onMouseEnter={() => setHovered('uncat')}
            onClick={() => { onChange('uncategorized'); setOpen(false); }}>
            Uncategorized
          </button>
          {categories.map(c => {
            const k = `c:${c.id}`;
            return (
              <button key={c.id} ref={setItemRef(k)}
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

function NameCell({ depth = 0, chevron, onChevron, icon, children }) {
  const padLeft = 8 + depth * 24;
  return (
    <span className="po-tree-name-cell" style={{ paddingLeft: padLeft }}>
      {chevron ? (
        <button type="button" className="po-tree-chevron"
          onClick={(e) => { e.stopPropagation(); onChevron?.(); }}>
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

function SaleTypeCell({ sale, ownTuple }) {
  if (!sale) return <span className="po-set-note">—</span>;
  const inherited = !ownTuple;
  const label = sale.type === 'percent' ? 'Percent'
              : sale.type === 'amount'  ? 'Amount'
              : 'Fixed price';
  return (
    <span className="po-disc-cell--active">
      {label}
      {inherited && <span className="po-set-note po-tree-inherited">(inherited)</span>}
    </span>
  );
}

function SaleValueCell({ sale }) {
  if (!sale) return <span className="po-set-note">—</span>;
  return <span className="po-disc-cell--strong">{formatDiscountSummary(sale)}</span>;
}

function PriceCell({ node, sale }) {
  const range = priceRange(node);
  if (!range) return <span className="po-set-note">—</span>;
  if (!sale) return <span className="po-disc-price-plain">{fmtRange(range)}</span>;
  const after = applySaleToRange(range, sale);
  return (
    <span className="po-disc-price-cell">
      <span className="po-disc-price-before">{fmtRange(range)}</span>
      <span className="po-disc-price-arrow">→</span>
      <span className="po-disc-price-after">{fmtRange(after)}</span>
    </span>
  );
}

function SaleWindowCell({ sale, fallback }) {
  const tup = sale ? [sale.type, sale.value, sale.starts, sale.ends] : fallback;
  if (!tup) return <span className="po-set-note">—</span>;
  const [, , ss, se] = tup;
  if (!ss && !se) return <span className="po-set-note">Always</span>;
  const fmt = (s) => s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '∞';
  return <span className="po-disc-cell--muted">{fmt(ss)} → {fmt(se)}</span>;
}

// ── Edit modal ───────────────────────────────────────────────────────

const TYPE_OPTIONS = [
  { value: 'percent', label: 'Percent off',     Icon: Percent,         hint: 'e.g. 20 → 20% off the price' },
  { value: 'amount',  label: 'Amount off',      Icon: CurrencyDollar,  hint: 'e.g. 5 → minus 5 from the price' },
  { value: 'fixed',   label: 'Fixed final price', Icon: Tag,           hint: 'e.g. 99 → exact price during the window' },
];

function EditDiscountModal({ target, onClose, onSave, onDelete }) {
  const init = target.initial || {};
  const [type, setType]     = useState(init.sale_type || 'percent');
  const [value, setValue]   = useState(init.sale_value === '' ? '' : String(init.sale_value ?? ''));
  const [starts, setStarts] = useState((init.sale_starts_at || '').slice(0, 16));
  const [ends, setEnds]     = useState((init.sale_ends_at || '').slice(0, 16));
  const [busy, setBusy]     = useState(false);

  const submit = async () => {
    const v = parseFloat(value);
    if (isNaN(v) || v < 0) return;
    if (type === 'percent' && v > 100) return;
    setBusy(true);
    try {
      await onSave({
        sale_type:      type,
        sale_value:     v,
        sale_starts_at: starts || null,
        sale_ends_at:   ends || null,
      });
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!confirm('Remove discount? Pricing returns to the regular price.')) return;
    setBusy(true);
    try { await onDelete(); } finally { setBusy(false); }
  };

  const valueLabel = type === 'percent' ? 'Percent (0–100)'
                   : type === 'amount'  ? 'Amount to subtract'
                   : 'Final sale price';

  // Live preview — recomputes on value/type change.
  const previewSale = (() => {
    const v = parseFloat(value);
    if (isNaN(v) || v < 0) return null;
    if (type === 'percent' && v > 100) return null;
    return { type, value: v };
  })();
  const beforeRange = target.range;
  const afterRange  = applySaleToRange(beforeRange, previewSale);

  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal po-disc-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">
                {target.has_existing ? 'Edit discount' : 'New discount'}
              </div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  Scope: <strong>{target.scope}</strong> · {target.breadcrumb}
                </span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body">
          <form className="cpm-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <div className="cpm-section">
              <label className="po-field-label">Discount type</label>
              <div className="po-disc-type-list">
                {TYPE_OPTIONS.map(o => (
                  <TypeOption key={o.value} option={o}
                    selected={type === o.value} onSelect={() => setType(o.value)} />
                ))}
              </div>
            </div>

            <div className="cpm-section">
              <label className="po-field-label">{valueLabel}</label>
              <input className="crm-input" type="number" autoFocus
                min="0" step="0.01"
                placeholder={type === 'percent' ? '20' : type === 'amount' ? '5' : '99'}
                value={value} onChange={e => setValue(e.target.value)} />
              <PreviewBlock before={beforeRange} after={afterRange} />
            </div>

            <div className="cpm-section">
              <label className="po-field-label">Starts at</label>
              <DateTimePicker value={starts} onChange={setStarts} />
              <span className="cpm-section-hint">Empty = effective immediately</span>
            </div>

            <div className="cpm-section">
              <label className="po-field-label">Ends at</label>
              <DateTimePicker value={ends} onChange={setEnds} />
              <span className="cpm-section-hint">Empty = no end date</span>
            </div>

            <div className="auth-actions po-disc-actions">
              <button className="crm-submit-btn" type="submit" disabled={busy || !value}>
                {busy ? 'Saving…' : (target.has_existing ? 'Save changes' : 'Create discount')}
              </button>
              {target.has_existing && (
                <button type="button" className="auth-btn-danger"
                  disabled={busy} onClick={remove}>
                  Delete
                </button>
              )}
              <button type="button" className="crm-submit-btn auth-btn-secondary po-disc-cancel-btn"
                disabled={busy} onClick={onClose}>
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

function PreviewBlock({ before, after }) {
  if (!before) {
    return <span className="cpm-section-hint">No SKU prices yet — add a configuration first to see the effect.</span>;
  }
  if (!after) {
    return (
      <span className="cpm-section-hint">
        Current price: <strong>{fmtRange(before)}</strong>. Type a value to preview the sale price.
      </span>
    );
  }
  return (
    <div className="po-disc-preview">
      <span className="po-disc-preview-label">Preview:</span>
      <span className="po-disc-price-before">{fmtRange(before)}</span>
      <span className="po-disc-price-arrow">→</span>
      <span className="po-disc-price-after">{fmtRange(after)}</span>
    </div>
  );
}

function TypeOption({ option, selected, onSelect }) {
  const { label, Icon, hint } = option;
  const cls = `po-disc-type-option${selected ? ' po-disc-type-option--selected' : ''}`;
  return (
    <button type="button" className={cls} onClick={onSelect}>
      <Icon weight="bold" size={18} className="po-disc-type-option-icon" />
      <div className="po-disc-type-option-body">
        <div className="po-disc-type-option-label">{label}</div>
        <div className="po-disc-type-option-hint">{hint}</div>
      </div>
      {selected && <span className="po-disc-type-option-check">✓</span>}
    </button>
  );
}
