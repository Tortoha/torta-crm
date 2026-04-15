import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Plus, Trash, PencilSimple, DotsThreeOutline, MagnifyingGlass, X, Image, List, SquaresFour, ArrowDown } from '@phosphor-icons/react';
import { Star } from '@phosphor-icons/react';
import { API_BASE } from '../api.js';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { InteractiveSection } from '../Utils/InteractiveSection.js';
import { encodeId } from '../Utils/hashids.js';
import '../Style/Organization.css';
import '../Style/Products.css';

// ── Tilt configs ───────────────────────────────────────────────

const CARD_TILT = {
  maxAngle: 12, lerp: 0.05, lerpOut: 0.07,
  scale: 1.04, perspective: 750,
  gloss: { opacity: 0.14, spread: 60 },
};

const ROW_TILT = {
  maxAngleX: 10, maxAngleY: 4, lerp: 0.05, lerpOut: 0.07,
  scale: 1.052, perspective: 900,
  gloss: { opacity: 0.14, spread: 40 },
};

// ── Sort options ───────────────────────────────────────────────

const SORT_OPTIONS = [
  { field: 'name',  label: 'Sort by name'  },
  { field: 'price', label: 'Sort by price' },
  { field: 'date',  label: 'Sort by date'  },
];

const DEFAULT_DIR = { name: 'asc', price: 'desc', date: 'desc' };

// ── ProdSortToggle ─────────────────────────────────────────────

function ProdSortToggle({ sort, onSort }) {
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

  const handleClick = field => {
    onSort(prev => ({
      field,
      dir: field === prev.field ? (prev.dir === 'asc' ? 'desc' : 'asc') : DEFAULT_DIR[field] ?? 'asc',
    }));
  };

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

// ── ProdMenu (portal dropdown) ─────────────────────────────────

function ProdMenu({ btnRef, onEdit, onDelete, onClose }) {
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: Math.max(8, r.right - 160) });
    }
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (!pos) return null;
  return createPortal(
    <div className="org-card-dropdown" style={{ top: pos.top, left: pos.left }}
      onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <button className="org-card-dropdown-item" onClick={onEdit}>
        <PencilSimple className="org-card-dropdown-icon" /> Edit
      </button>
      <div className="org-card-dropdown-sep" />
      <button className="org-card-dropdown-item org-card-dropdown-item--danger" onClick={onDelete}>
        <Trash className="org-card-dropdown-icon" /> Delete
      </button>
    </div>,
    document.body
  );
}

// ── Price label helper ─────────────────────────────────────────

function priceLabel(p) {
  if (p.min_price === 0 && p.max_price === 0) return '—';
  if (p.min_price === p.max_price) return `$${p.min_price.toFixed(0)}`;
  return `$${p.min_price.toFixed(0)}–${p.max_price.toFixed(0)}`;
}

// ── ProductCard ────────────────────────────────────────────────

function ProductCard({ p, onOpen, onDelete }) {
  const menuBtnRef = useRef(null);
  const { ref, glossRef, handlers } = InteractiveSection(CARD_TILT, false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const h = e => {
      if (!e.target.closest?.('.org-card-dropdown') && !menuBtnRef.current?.contains(e.target))
        setMenuOpen(false);
    };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [menuOpen]);

  return (
    <div ref={ref} className="org-card org-card--tilt prod-card" onClick={onOpen} {...handlers}>
      <div ref={glossRef} className="org-card-gloss prod-card-gloss" />
      <div className="pcard-inner">
        <div className="pcard-img-wrap">
          {p.first_image
            ? <img src={p.first_image} alt={p.title} className="pcard-img" />
            : <div className="pcard-img-empty"><Image size={22} /></div>}
        </div>
        <div className="pcard-body">
          <div className="pcard-title">{p.title}</div>
          <div className="pcard-row1">
            <span className="pcard-price">{priceLabel(p)}</span>
            {p.total_stock > 0 && <><span className="pcard-dot">·</span><span className="pcard-stock">Stock {p.total_stock}</span></>}
          </div>
          {(p.variations_count > 0 || p.reviews_count > 0) && (
            <div className="pcard-row2">
              {p.variations_count > 0 && <span className="pcard-vars">{p.variations_count} var.</span>}
              {p.reviews_count > 0 && (
                <span className="pcard-rating">
                  <Star className="pcard-star" weight="fill" /> {p.avg_rating.toFixed(1)}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <button ref={menuBtnRef} className="org-card-menu-btn pcard-menu-btn" type="button"
        onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}>
        <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
      </button>
      {menuOpen && (
        <ProdMenu btnRef={menuBtnRef}
          onEdit={() => { setMenuOpen(false); onOpen(); }}
          onDelete={() => { setMenuOpen(false); onDelete(); }}
          onClose={() => setMenuOpen(false)} />
      )}
    </div>
  );
}

// ── ProdListRow ────────────────────────────────────────────────

function ProdListRow({ p, onOpen, onDelete }) {
  const menuBtnRef = useRef(null);
  const { ref, glossRef, handlers } = InteractiveSection(ROW_TILT, false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const h = e => {
      if (!e.target.closest?.('.org-card-dropdown') && !menuBtnRef.current?.contains(e.target))
        setMenuOpen(false);
    };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [menuOpen]);

  return (
    <div ref={ref} className={`prow${menuOpen ? ' org-list-row--frozen' : ''}`}
      onClick={onOpen} {...handlers}>
      <div ref={glossRef} className="org-list-gloss" />
      <div className="prow-img-wrap">
        {p.first_image
          ? <img src={p.first_image} alt={p.title} className="prow-img" />
          : <div className="prow-img-empty"><Image size={14} /></div>}
      </div>
      <span className="prow-name">{p.title}</span>
      <span className="prow-cell">{priceLabel(p)}</span>
      <span className="prow-cell">{p.total_stock > 0 ? `Stock ${p.total_stock}` : '—'}</span>
      <span className="prow-cell">{p.variations_count > 0 ? `${p.variations_count} var.` : '—'}</span>
      <span className="prow-cell">
        {p.reviews_count > 0
          ? <><Star className="pcard-star" weight="fill" /> {p.avg_rating.toFixed(1)}</>
          : '—'}
      </span>
      <button ref={menuBtnRef} className="org-list-menu-btn" type="button"
        onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}>
        <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
      </button>
      {menuOpen && (
        <ProdMenu btnRef={menuBtnRef}
          onEdit={() => { setMenuOpen(false); onOpen(); }}
          onDelete={() => { setMenuOpen(false); onDelete(); }}
          onClose={() => setMenuOpen(false)} />
      )}
    </div>
  );
}

// ── NewProductDrawer (only for creating a new product) ─────────

function NewProductDrawer({ open, pq, onClose, onCreated }) {
  const [title,     setTitle]     = useState('');
  const [creating,  setCreating]  = useState(false);
  const [createErr, setCreateErr] = useState('');

  const handleCreate = async e => {
    e.preventDefault();
    if (!title.trim()) return setCreateErr('Title is required');
    setCreating(true); setCreateErr('');
    const res = await fetch(`${API_BASE}/api/products${pq}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim() }),
    });
    const data = await res.json();
    if (!res.ok) { setCreateErr(data.detail || 'Error'); setCreating(false); return; }
    setTitle('');
    onCreated(data);
    setCreating(false);
  };

  return (
    <div className={`prod-drawer${open ? ' prod-drawer--open' : ''}`}>
      <div className="prod-drawer-head">
        <span className="prod-drawer-title">New Product</span>
        <button className="crm-icon-btn" onClick={onClose} title="Close">
          <X className="crm-icon" />
        </button>
      </div>
      <div className="prod-tab-content">
        <p className="prod-tab-hint">Enter a title to create the product — you can add variations and details after.</p>
        <form onSubmit={handleCreate}>
          <div className="prod-field">
            <label className="prod-field-label">Title</label>
            <input className="prod-field-input" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Product name" autoFocus />
          </div>
          {createErr && <span className="crm-form-error">{createErr}</span>}
          <div className="prod-tab-footer">
            <button className="prod-save-btn" type="submit" disabled={creating}>
              {creating ? 'Creating…' : 'Create product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Products (main page) ───────────────────────────────────────

export default function Products() {
  const { projectId, project } = useOutletContext();
  const navigate = useNavigate();
  const pq = `?project_id=${projectId}`;

  const [products,    setProducts]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [view,        setView]        = useState('grid');
  const [viewHover,   setViewHover]   = useState(null);
  const [sort,        setSort]        = useState({ field: 'name', dir: 'asc' });
  const [showDrawer,  setShowDrawer]  = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/api/products${pq}`, { credentials: 'include' });
      const data = await res.json();
      setProducts(Array.isArray(data) ? data : []);
    } catch { setProducts([]); }
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const deleteProduct = async id => {
    if (!confirm('Delete this product? All variations, sizes and reviews will also be deleted.')) return;
    await fetch(`${API_BASE}/api/products/${id}${pq}`, { method: 'DELETE', credentials: 'include' });
    load();
  };

  const goToProduct = id => navigate(`/product/${encodeId(id)}`);

  const filtered = products.filter(p => !search || p.title.toLowerCase().includes(search.toLowerCase()));

  const sorted = [...filtered].sort((a, b) => {
    if (sort.field === 'name')  { const c = a.title.localeCompare(b.title); return sort.dir === 'asc' ? c : -c; }
    if (sort.field === 'price') return sort.dir === 'asc' ? a.min_price - b.min_price : b.min_price - a.min_price;
    return sort.dir === 'asc' ? a.id - b.id : b.id - a.id;
  });

  const curView = viewHover ?? view;

  return (
    <div className="prod-page">
      <h1 className="crm-page-title org-page-title">Products</h1>

      {/* Toolbar */}
      <div className={`org-toolbar${showDrawer ? ' prod-toolbar--shrink' : ''}`}>
        <div className="org-search-wrap">
          <MagnifyingGlass className="org-search-icon" />
          <input className="org-search-input" placeholder="Search products…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <ProdSortToggle sort={sort} onSort={setSort} />

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

        <button className="org-new-btn" onClick={() => setShowDrawer(true)} type="button">
          <Plus className="org-new-icon" /> New Product
        </button>
      </div>

      {/* Product list */}
      <div className={`prod-content${showDrawer ? ' prod-content--shrink' : ''}`}>
        {loading && <p className="crm-placeholder">Loading…</p>}

        {!loading && sorted.length === 0 && (
          <p className="crm-placeholder">
            {search ? 'No products match your search.' : 'No products yet. Click "New Product" to add one.'}
          </p>
        )}

        {!loading && sorted.length > 0 && view === 'grid' && (
          <div className="prod-grid">
            {sorted.map(p => (
              <ProductCard key={p.id} p={p}
                onOpen={() => goToProduct(p.id)}
                onDelete={() => deleteProduct(p.id)} />
            ))}
          </div>
        )}

        {!loading && sorted.length > 0 && view === 'list' && (
          <div className="prod-list">
            <div className="prod-list-head">
              <span /><span className="org-list-th">Title</span>
              <span className="org-list-th">Price</span><span className="org-list-th">Stock</span>
              <span className="org-list-th">Variations</span><span className="org-list-th">Rating</span>
              <span />
            </div>
            <div className="prod-list-block">
              {sorted.map(p => (
                <ProdListRow key={p.id} p={p}
                  onOpen={() => goToProduct(p.id)}
                  onDelete={() => deleteProduct(p.id)} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* New product drawer */}
      <div className={`prod-backdrop${showDrawer ? ' prod-backdrop--open' : ''}`} onClick={() => setShowDrawer(false)} />
      <NewProductDrawer
        open={showDrawer}
        pq={pq}
        onClose={() => setShowDrawer(false)}
        onCreated={newProduct => {
          setShowDrawer(false);
          load();
          goToProduct(newProduct.id);
        }}
      />
    </div>
  );
}
