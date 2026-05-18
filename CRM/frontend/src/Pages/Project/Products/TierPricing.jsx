// Tier pricing — wholesale "buy N+ for $X" ladders per leaf SKU; tree+lazy hydration mirror Inventory/Discount.

import { Fragment, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import {
  MagnifyingGlass, CaretRight, CaretDown,
  Folder, Cube, PencilSimple, X, ArrowDown, FolderSimple, Trash, Plus,
} from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { formatMoney } from '../../../Utils/currency.js';
import { PoListRow } from '../../../Utils/PoListRow.jsx';
import { DynamicBlock } from '../../../Utils/DynamicBlock.js';
import '../../../Style/Authentication.css';
import '../../../Style/Products.css';
import '../../../Style/Organization.css';

const COLS = '2.4fr 1fr 1.6fr 1.2fr 110px';

const SORT_OPTIONS = [
  { field: 'name',       label: 'Sort by name'  },
  { field: 'stock',      label: 'Sort by stock' },
  { field: 'variations', label: 'Sort by SKUs'  },
];
const DEFAULT_DIR = { name: 'asc', stock: 'desc', variations: 'desc' };

// Project-currency-aware tier formatter. Set via setTierCurrency() on
// page mount; identical pattern to Discounts.jsx (the two pages share
// the "render a price the way the merchant chose" requirement).
let __TIER_CURRENCY = 'USD';
const setTierCurrency = (c) => { __TIER_CURRENCY = c || 'USD'; };
function fmtPrice(p) {
  if (p == null) return '—';
  const n = Number(p);
  const opts = (n % 1 === 0) ? { decimals: 0 } : undefined;
  return formatMoney(n, __TIER_CURRENCY, opts);
}

export default function TierPricing() {
  const { projectId, project } = useOutletContext();
  useEffect(() => { setTierCurrency(project?.currency || 'USD'); }, [project?.currency]);
  const pq = `?project_id=${projectId}`;

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ field: 'name', dir: 'asc' });
  const [categoryFilter, setCategoryFilter] = useState(null);
  // expanded[pid] = { hydrated, loading, data, tiers }
  const [expanded, setExpanded] = useState({});
  const [openVar, setOpenVar] = useState(new Set());
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
        setProducts(await r.json());
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
    const [pd, ti] = await Promise.all([
      fetch(`${API_BASE}/api/products/${pid}${pq}`,             { credentials: 'include' }).then(r => r.ok ? r.json() : null),
      fetch(`${API_BASE}/api/products/${pid}/tier-pricing${pq}`, { credentials: 'include' }).then(r => r.ok ? r.json() : []),
    ]);
    if (pd) {
      const tiersBySku = {};
      for (const t of (Array.isArray(ti) ? ti : [])) {
        (tiersBySku[t.sku_id] ||= []).push(t);
      }
      for (const arr of Object.values(tiersBySku)) {
        arr.sort((a, b) => a.min_qty - b.min_qty);
      }
      setExpanded(prev => ({
        ...prev,
        [pid]: { hydrated: true, loading: false, data: pd, tiers: tiersBySku },
      }));
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

  return (
    <>
      <p className="po-block-hint">
        Wholesale-style ladders. Set "buy N+ for $X each" per SKU and the
        storefront automatically picks the highest tier whose threshold ≤ cart
        quantity at checkout. Stacks with discounts: tier resolves first, then
        the active sale (if any) applies on top.
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
            <span>Name</span><span>Base price</span><span>Tier ladder</span><span>SKU code</span><span></span>
          </div>
          {filteredProducts.map(p => {
            const e = expanded[p.id];
            return (
              <ProductBranch key={p.id} product={p}
                isOpen={!!e?.hydrated || !!e?.loading}
                hydrated={e?.hydrated}
                detail={e?.data}
                tiersBySku={e?.tiers || {}}
                openVar={openVar}
                onToggleProduct={() => toggleProduct(p.id)}
                onToggleVar={(vid) => toggleVar(p.id, vid)}
                onEdit={setEditTarget} />
            );
          })}
        </div>
      )}

      {editTarget && (
        <EditTiersModal target={editTarget} pq={pq}
          onClose={() => setEditTarget(null)}
          onChanged={async () => { await hydrateProduct(editTarget.product_id); }}
          showToast={showToast} />
      )}

      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
    </>
  );
}

// ── Product / Variation / Configuration tree ───────────────────────

function ProductBranch({ product, isOpen, hydrated, detail, tiersBySku,
                          openVar, onToggleProduct, onToggleVar, onEdit }) {
  const variations = detail?.variations || [];
  const skuCount = variations.reduce((sum, v) => sum + (v.configurations?.length || 0), 0);
  // Pre-hydration uses cheap list aggregate `tier_count`; post-hydration counts exact rows.
  const tierCount = hydrated
    ? Object.values(tiersBySku).reduce((s, arr) => s + arr.length, 0)
    : (product.tier_count || 0);

  return (
    <>
      <PoListRow className="po-tree-row"
        style={{ gridTemplateColumns: COLS }}
        onClick={onToggleProduct}>
        <NameCell depth={0} chevron={isOpen ? 'open' : 'closed'} onChevron={onToggleProduct}
          icon={<Folder weight="duotone" className="po-disc-cell--strong" />}>
          <span className="po-set-strong">{product.title}</span>
          <span className="po-set-note po-tree-meta">
            · {product.variations_count || 0} variation{product.variations_count === 1 ? '' : 's'}
            {hydrated ? ` · ${skuCount} SKU${skuCount === 1 ? '' : 's'}` : ''}
          </span>
        </NameCell>
        <span className="po-numeric-muted">
          {(product.min_price || product.max_price)
            ? (product.min_price === product.max_price
                ? fmtPrice(product.min_price)
                : `${fmtPrice(product.min_price)}–${fmtPrice(product.max_price)}`)
            : '—'}
        </span>
        <span className={tierCount > 0 ? 'po-disc-cell--strong' : 'po-set-note'}>
          {tierCount > 0 ? `${tierCount} tier${tierCount === 1 ? '' : 's'}` : 'No tiers'}
        </span>
        <span className="po-set-note">{product.sku || '—'}</span>
        <span></span>
      </PoListRow>

      {isOpen && !hydrated && (
        <div className="po-set-row po-tree-loading-row" style={{ gridTemplateColumns: COLS }}>
          <span className="po-tree-loading-text">Loading…</span>
          <span></span><span></span><span></span><span></span>
        </div>
      )}

      {isOpen && hydrated && variations.map(v => {
        const vKey = `${product.id}-${v.id}`;
        const vOpen = openVar.has(vKey);
        const confs = v.configurations || [];
        const vTierCount = confs.reduce((s, c) => s + ((tiersBySku[c.id] || []).length), 0);
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
                  · {confs.length} SKU{confs.length === 1 ? '' : 's'}
                </span>
              </NameCell>
              <span></span>
              <span className={vTierCount > 0 ? 'po-disc-cell--strong' : 'po-set-note'}>
                {vTierCount > 0 ? `${vTierCount} tier${vTierCount === 1 ? '' : 's'}` : 'No tiers'}
              </span>
              <span></span>
              <span></span>
            </PoListRow>

            {vOpen && confs.map(c => {
              const tiers = tiersBySku[c.id] || [];
              const basePrice = c.effective_price ?? c.price ?? null;
              const openEdit = () => onEdit({
                product_id: product.id,
                product_title: product.title,
                sku_id: c.id,
                breadcrumb: `${product.title} / ${v.variation_name || v.name} / ${c.configuration_name || c.name}`,
                base_price: basePrice,
                sku_code: c.sku_code || '',
                tiers,
              });
              return (
                <PoListRow key={c.id} className="po-tree-row"
                  style={{ gridTemplateColumns: COLS }}
                  onClick={openEdit}>
                  <NameCell depth={2} icon={<Cube className="po-disc-cell--muted" />}>
                    <span>{c.configuration_name || c.name || '—'}</span>
                  </NameCell>
                  <span className="po-numeric-muted">{fmtPrice(basePrice)}</span>
                  <TierLadderCell tiers={tiers} />
                  <span className="po-set-note">{c.sku_code || '—'}</span>
                  <button type="button" className="po-edit-btn"
                    onClick={(e) => { e.stopPropagation(); openEdit(); }}>
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

function TierLadderCell({ tiers }) {
  if (!tiers || tiers.length === 0) return <span className="po-set-note">No tiers</span>;
  return (
    <span className="po-tier-ladder">
      {tiers.map(t => (
        <span key={t.id} className="po-tier-chip">
          {t.min_qty}+ {fmtPrice(t.price)}
        </span>
      ))}
    </span>
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

// ── Sort + Category filter (mirror of Inventory / Discount) ────────

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

// ── Edit tiers modal — list + add row, immediate persist on add/delete ─

function EditTiersModal({ target, pq, onClose, onChanged, showToast }) {
  // Local list for optimistic UX. Synced with backend via add/delete calls.
  const [tiers, setTiers] = useState(target.tiers || []);
  const [newQty, setNewQty]   = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [busy, setBusy] = useState(false);

  const addTier = async () => {
    const q = parseInt(newQty, 10);
    const p = parseFloat(newPrice);
    if (!q || q < 1) { showToast('min qty must be ≥ 1'); return; }
    if (isNaN(p) || p < 0) { showToast('price must be ≥ 0'); return; }
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/products/${target.product_id}/tier-pricing${pq}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku_id: target.sku_id, min_qty: q, price: p }),
      });
      if (r.ok) {
        const created = await r.json();
        setTiers(prev => [...prev, created].sort((a, b) => a.min_qty - b.min_qty));
        setNewQty(''); setNewPrice('');
        onChanged?.();
      } else {
        const j = await r.json().catch(() => ({}));
        showToast(j.detail || 'Failed to add tier');
      }
    } finally { setBusy(false); }
  };

  const removeTier = async (tierId) => {
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/products/${target.product_id}/tier-pricing/${tierId}${pq}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (r.ok) {
        setTiers(prev => prev.filter(t => t.id !== tierId));
        onChanged?.();
      } else { showToast('Failed to remove tier'); }
    } finally { setBusy(false); }
  };

  const basePrice = target.base_price;

  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal po-disc-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">Tier pricing</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {target.breadcrumb}
                  {target.sku_code && <> · {target.sku_code}</>}
                  {basePrice != null && <> · base {fmtPrice(basePrice)}</>}
                </span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body">
          <div className="cpm-form">
            {tiers.length === 0 ? (
              <p className="cpm-section-hint">No tiers yet — add one below to start the wholesale ladder.</p>
            ) : (
              <div className="po-tier-list">
                {tiers.map(t => (
                  <div key={t.id} className="po-tier-row">
                    <span className="po-tier-row-qty">{t.min_qty}+</span>
                    <span className="po-tier-row-price">{fmtPrice(t.price)} / pc</span>
                    {basePrice != null && t.price < basePrice && (
                      <span className="po-tier-row-saving">
                        −{Math.round((1 - t.price / basePrice) * 100)}%
                      </span>
                    )}
                    <button type="button" className="po-tier-row-del"
                      disabled={busy} onClick={() => removeTier(t.id)}
                      aria-label="Remove tier">
                      <Trash weight="bold" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="cpm-section">
              <label className="po-field-label">Add a tier</label>
              <div className="po-tier-add-row">
                <input className="crm-input po-tier-add-input" type="number"
                  min="1" placeholder="Min quantity (e.g. 5)"
                  value={newQty} onChange={e => setNewQty(e.target.value)} />
                <input className="crm-input po-tier-add-input" type="number"
                  min="0" step="0.01" placeholder="Price per piece"
                  value={newPrice} onChange={e => setNewPrice(e.target.value)} />
                <button type="button" className="crm-submit-btn"
                  disabled={busy || !newQty || !newPrice} onClick={addTier}>
                  <Plus weight="bold" /> Add
                </button>
              </div>
              <span className="cpm-section-hint">
                Storefront picks the highest tier whose threshold ≤ cart qty.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
