import { Fragment, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import { MagnifyingGlass, CaretRight, CaretDown, Folder, Cube, PencilSimple, X, ArrowDown, FolderSimple, Warehouse, Tag } from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { PoListRow } from '../../../Utils/PoListRow.jsx';
import { Combobox } from '../Booking/BookingCreateModal.jsx';
import { DynamicBlock } from '../../../Utils/DynamicBlock.js';
import BulkTransferWizard, { BulkTransferButton } from './BulkTransferWizard.jsx';
import '../../../Style/Authentication.css';
import '../../../Style/Products.css';
import '../../../Style/Organization.css';

// Inventory shows physical+event only — digital/service have no warehouse stock.
const VISIBLE_TYPES = new Set(['physical', 'event']);

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'low', label: 'Low stock' },
  { key: 'oos', label: 'Out of stock' },
];

const SORT_OPTIONS = [
  { field: 'name',       label: 'Sort by name'  },
  { field: 'stock',      label: 'Sort by stock' },
  { field: 'variations', label: 'Sort by SKUs'  },
];
const DEFAULT_DIR = { name: 'asc', stock: 'desc', variations: 'desc' };

const REASON_OPTIONS = [
  { value: 'restock', label: 'Restock' },
  { value: 'manual',  label: 'Manual correction' },
  { value: 'damage',  label: 'Damage / write-off' },
  { value: 'transfer',label: 'Transfer' },
  { value: 'return',  label: 'Customer return' },
];

const COLS = '2.6fr 1fr 1fr 1fr 110px';

function ProductsInventory() {
  const { projectId } = useOutletContext();
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
  const [showWizard, setShowWizard] = useState(false);
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

  // Filter Low/OOS — hydrate every product so we can flatten + match.
  useEffect(() => {
    if (filter === 'all') return;
    const toLoad = products.filter(p => !expanded[p.id]?.hydrated && !expanded[p.id]?.loading);
    if (toLoad.length === 0) return;
    Promise.all(toLoad.map(p => hydrateProduct(p.id)));
  }, [filter, products, expanded, hydrateProduct]);

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

  // For Low/OOS — collect matching leaf SKUs across all hydrated products.
  const flatMatches = useMemo(() => {
    if (filter === 'all') return null;
    const out = [];
    for (const p of filteredProducts) {
      const detail = expanded[p.id]?.data;
      if (!detail) continue;
      const lst = detail.low_stock_threshold || 0;
      for (const v of (detail.variations || [])) {
        for (const c of (v.configurations || [])) {
          const stock = c.stock_quantity || 0;
          if (filter === 'oos' && stock > 0) continue;
          if (filter === 'low') {
            if (lst <= 0) continue;
            if (stock <= 0 || stock > lst) continue;
          }
          out.push({
            product_id:    p.id,
            product_title: p.title,
            variation_name: v.variation_name || v.name || '—',
            configuration_name: c.configuration_name || c.name || '—',
            sku_id:    c.id,
            sku_code:  c.sku_code || '',
            stock,
            sold:      c.sold_quantity || 0,
            threshold: lst,
          });
        }
      }
    }
    return out;
  }, [filter, filteredProducts, expanded]);

  // Live counters for filter pills (require hydration to be exact).
  const counters = useMemo(() => {
    let total = 0, low = 0, oos = 0;
    for (const p of products) {
      const detail = expanded[p.id]?.data;
      if (detail) {
        const lst = detail.low_stock_threshold || 0;
        for (const v of (detail.variations || [])) {
          for (const c of (v.configurations || [])) {
            total += 1;
            const s = c.stock_quantity || 0;
            if (s <= 0) oos += 1;
            else if (lst > 0 && s <= lst) low += 1;
          }
        }
      } else {
        total += 0; // unknown until hydrated
      }
    }
    return { all: total, low, oos };
  }, [products, expanded]);

  return (
    <>
      <p className="po-block-hint">
        Click a product to load its variations and SKUs. Clicking <em>Edit</em>{' '}
        on a SKU opens the same adjustment dialog as the per-product Inventory
        page (writes to the stock audit log).
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
          <FilterToggle value={filter} onChange={setFilter} counters={counters} />
          <BulkTransferButton onClick={() => setShowWizard(true)}
            disabled={products.length === 0} />
        </div>
      </div>

      {showWizard && (
        <BulkTransferWizard projectId={projectId}
          onClose={() => setShowWizard(false)}
          onApplied={() => { setShowWizard(false); loadProducts(); }}
          showToast={showToast} />
      )}

      {loading ? (
        <p className="crm-placeholder">Loading…</p>
      ) : filteredProducts.length === 0 ? (
        <p className="crm-placeholder">
          {products.length === 0 ? 'No products yet — create one first.' : 'No products match the search.'}
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
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            // Re-hydrate just that product so the row updates without full reload.
            hydrateProduct(editTarget.product_id);
            showToast('Stock adjusted');
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

// ── Category dropdown (read-only mirror of ProductsList's CategoryFilter) ─

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
      });
    }
    return byWh;
  }, [summary, visibleProductIds]);

  if (warehouses.length === 0) {
    return <p className="crm-placeholder">No active warehouses.</p>;
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
              {w.is_default && <span className="po-pwh-default-mark"> · default</span>}
              <span className="prod-group-count">{productsList.length}</span>
              <span className="po-set-note po-tree-meta">· {totalQty} units total</span>
            </h2>
            {isOpen && (
              productsList.length === 0 ? (
                <p className="crm-placeholder">No stock in this warehouse yet.</p>
              ) : (
                <div className="po-set-table">
                  <div className="po-set-row po-set-row--head" style={{ gridTemplateColumns: COLS }}>
                    <span>Name</span><span>SKU code</span><span>Stock</span><span>Sold</span><span></span>
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
                    return (
                      <Fragment key={pKey}>
                        <PoListRow className="po-tree-row"
                          style={{ gridTemplateColumns: COLS }}
                          onClick={() => toggleProd(pKey)}>
                          <NameCell depth={0}
                            chevron={pOpen ? 'open' : 'closed'}
                            onChevron={() => toggleProd(pKey)}
                            icon={<Folder weight="duotone" className="po-disc-cell--strong" />}>
                            <span className="po-set-strong">{p.product_title}</span>
                            <span className="po-set-note po-tree-meta">
                              · {variations.length} variation{variations.length === 1 ? '' : 's'}
                              {' · '}{skuCount} SKU{skuCount === 1 ? '' : 's'}
                            </span>
                          </NameCell>
                          <span className="po-set-note">{p.product_sku || '—'}</span>
                          <span className="po-stock-cell">{pQty}</span>
                          <span className="po-numeric-muted">{pSold}</span>
                          <span></span>
                        </PoListRow>

                        {pOpen && variations.map(v => {
                          const vKey = `${w.id}:${p.product_id}:${v.variation_id}`;
                          const vOpen = openVar2.has(vKey);
                          const vQty = v.skus.reduce((a, s) => a + s.quantity, 0);
                          const vSold = v.skus.reduce((a, s) => a + (s.sold_quantity || 0), 0);
                          return (
                            <Fragment key={vKey}>
                              <PoListRow className="po-tree-row"
                                style={{ gridTemplateColumns: COLS }}
                                onClick={() => toggleVar(vKey)}>
                                <NameCell depth={1}
                                  chevron={vOpen ? 'open' : 'closed'}
                                  onChevron={() => toggleVar(vKey)}
                                  icon={v.variation_image
                                    ? <img src={v.variation_image} alt="" className="po-tree-avatar" />
                                    : <span className="po-tree-avatar-fallback" />}>
                                  <span className="po-set-strong">{v.variation_name || '—'}</span>
                                  <span className="po-set-note po-tree-meta">
                                    · {v.skus.length} SKU{v.skus.length === 1 ? '' : 's'}
                                  </span>
                                </NameCell>
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
                                return (
                                  <PoListRow key={`${vKey}-${s.sku_id}`}
                                    className="po-tree-row"
                                    style={{ gridTemplateColumns: COLS }}
                                    onClick={() => onEdit(payload)}>
                                    <NameCell depth={2} icon={<Cube className="po-disc-cell--muted" />}>
                                      <span>{s.sku_name || '—'}</span>
                                    </NameCell>
                                    <span className="po-set-note">{s.sku_code || '—'}</span>
                                    <span className="po-stock-cell">{s.quantity}</span>
                                    <span className="po-numeric-muted">{s.sold_quantity || 0}</span>
                                    <button type="button" className="po-edit-btn"
                                      onClick={(e) => { e.stopPropagation(); onEdit(payload); }}>
                                      <PencilSimple weight="bold" /> Edit
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
    { key: 'product',   label: 'By product',   Icon: Tag       },
    { key: 'warehouse', label: 'By warehouse', Icon: Warehouse },
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
    return <p className="crm-placeholder">No active warehouses.</p>;
  }
  if (summary === null) {
    return <p className="crm-placeholder">Loading…</p>;
  }
  return (
    <div className="po-set-table">
      <div className="po-set-row po-set-row--head" style={{ gridTemplateColumns: '2.6fr 1fr 1fr 1fr 110px' }}>
        <span>Warehouse · SKU</span><span>SKU code</span><span>Qty</span><span></span><span></span>
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
                {w.is_default && <span className="po-set-note po-pwh-default-mark"> · default</span>}
                <span className="po-set-note po-tree-meta">
                  · {skus.length} SKU{skus.length === 1 ? '' : 's'}
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
                <span className="po-tree-loading-text">No stock in this warehouse.</span>
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
                    <PencilSimple weight="bold" /> Edit
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
      {FILTERS.map(({ key, label }) => (
        <button key={key} ref={el => { btnRefs.current[key] = el; }}
          className={`org-sort-btn${cur === key ? ' org-sort-btn--current' : ''}`}
          onMouseEnter={() => setHovered(key)}
          onClick={() => onChange(key)} type="button">
          {label} <span className="po-filter-count">({counters[key] ?? 0})</span>
        </button>
      ))}
    </div>
  );
}

// ── Product folder + nested variations + leaf SKUs ───────────────────

function ProductBranch({ product, isOpen, hydrated, detail, openVar, onToggleProduct, onToggleVar, onEdit }) {
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
            · {product.variations_count || 0} variation{product.variations_count === 1 ? '' : 's'}
            {hydrated ? ` · ${skuCount} SKU${skuCount === 1 ? '' : 's'}` : ''}
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
          <span className="po-tree-loading-text">Loading…</span>
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
                  · {confs.length} SKU{confs.length === 1 ? '' : 's'}
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
                  <PencilSimple weight="bold" /> Edit
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
  // Padding is the only depth-variable bit; everything else lives in CSS.
  const padLeft = 8 + depth * 24;
  return (
    <span className="po-tree-name-cell" style={{ paddingLeft: padLeft }}>
      {chevron ? (
        <button type="button" className="po-tree-chevron"
          onClick={(e) => { e.stopPropagation(); onChevron?.(); }}
          aria-label={chevron === 'open' ? 'Collapse' : 'Expand'}>
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
  const oos = stock <= 0;
  const low = !oos && threshold > 0 && stock <= threshold;
  const cls = oos ? 'po-stock-cell po-stock-cell--out'
            : low ? 'po-stock-cell po-stock-cell--low'
            : 'po-stock-cell';
  return <span className={cls}>{oos ? 'Out' : low ? `${stock} · low` : stock}</span>;
}

// ── Flat list shown when filter = Low / OOS ─────────────────────────

function FlatMatchList({ rows, onEdit }) {
  if (!rows) return <p className="crm-placeholder">Loading…</p>;
  if (rows.length === 0) return <p className="crm-placeholder">No SKUs match this filter.</p>;
  return (
    <div className="po-set-table">
      <div className="po-set-row po-set-row--head" style={{ gridTemplateColumns: COLS }}>
        <span>Product · Variation · SKU</span><span>SKU code</span><span>Stock</span><span>Sold</span><span></span>
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
        return (
          <PoListRow key={r.sku_id} className="po-tree-row po-flat-row"
            style={{ gridTemplateColumns: COLS }}
            onClick={() => onEdit(payload)}>
            <span className="po-flat-name-cell">
              <span className="po-set-strong">{r.product_title}</span>
              <span className="po-set-note"> · {r.variation_name} · {r.configuration_name}</span>
            </span>
            <span className="po-set-note">{r.sku_code || '—'}</span>
            <StockCell stock={r.stock} threshold={r.threshold} />
            <span className="po-numeric-muted">{r.sold}</span>
            <button type="button" className="po-edit-btn"
              onClick={(e) => { e.stopPropagation(); onEdit(payload); }}>
              <PencilSimple weight="bold" /> Edit
            </button>
          </PoListRow>
        );
      })}
    </div>
  );
}

// ── Edit stock modal ─────────────────────────────────────────────────

function EditStockModal({ target, pq, onClose, onSaved, showToast }) {
  const [delta, setDelta]   = useState('');
  const [reason, setReason] = useState('restock');
  const [note, setNote]     = useState('');
  const [busy, setBusy]     = useState(false);

  const submit = async () => {
    const d = parseInt(delta, 10);
    if (!d || isNaN(d)) { showToast('Change must be a non-zero integer'); return; }
    setBusy(true);
    try {
      const body = { sku_id: target.sku_id, delta: d, reason, note };
      // Pin change to specific WH when modal opened from a WH-scoped row; else default WH.
      if (target.warehouse_id != null) body.warehouse_id = target.warehouse_id;
      const r = await fetch(`${API_BASE}/api/products/${target.product_id}/stock/adjust${pq}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.ok) { onSaved?.(); }
      else { const j = await r.json().catch(() => ({})); showToast(j.detail || 'Failed'); }
    } finally { setBusy(false); }
  };

  const preview = (() => {
    const d = parseInt(delta, 10);
    if (!d || isNaN(d)) return null;
    return Math.max(0, target.current_stock + d);
  })();

  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal po-edit-stock-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">Edit stock</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {target.product_title} · {target.variation_name} · {target.configuration_name}
                  {target.warehouse_name && <> · <strong>{target.warehouse_name}</strong></>}
                  {' · current '}<strong>{target.current_stock}</strong>
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

            <div className="cpm-section">
              <label className="po-field-label">Change</label>
              <input className="crm-input" type="number" autoFocus
                placeholder="e.g. +1000 or -3"
                value={delta} onChange={e => setDelta(e.target.value)} />
              <span className="cpm-section-hint">
                Positive adds stock, negative removes it.
                {preview !== null && (
                  <> &nbsp;·&nbsp; new stock:{' '}
                    <strong className="po-disc-cell--strong">{preview}</strong>
                  </>
                )}
              </span>
            </div>

            <div className="cpm-section">
              <label className="po-field-label">Reason</label>
              <Combobox value={reason} options={REASON_OPTIONS}
                onChange={(v) => setReason(v)} />
            </div>

            <div className="cpm-section">
              <label className="po-field-label">Note (optional)</label>
              <input className="crm-input" type="text"
                placeholder="e.g. Restock from supplier #4521"
                value={note} onChange={e => setNote(e.target.value)} maxLength={1000} />
            </div>

            <div className="auth-actions">
              <button className="crm-submit-btn" type="submit" disabled={busy}>
                {busy ? 'Applying…' : 'Apply'}
              </button>
              <button className="crm-submit-btn auth-btn-secondary"
                type="button" disabled={busy} onClick={onClose}>
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

export default ProductsInventory