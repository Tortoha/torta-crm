import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Plus, Trash, PencilSimple, DotsThreeOutline, MagnifyingGlass, X,
  ArrowDown, ArrowsLeftRight, Warning,
} from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { InteractiveSection } from '../../../Utils/InteractiveSection.js';
import { DynamicBlock } from '../../../Utils/DynamicBlock.js';
import '../../../Style/Organization.css';
import '../../../Style/Products.css';
import '../../../Style/Authentication.css';

// ── Tilt config ──────────────────────────────────────────────────────────
const CARD_TILT = { maxAngle: 10, lerp: 0.05, lerpOut: 0.07, scale: 1.03, perspective: 800, gloss: { opacity: 0.12, spread: 50 } };

// ── Sort options ─────────────────────────────────────────────────────────
const SORT_OPTIONS = [
  { field: 'name',  label: 'Sort by name'     },
  { field: 'count', label: 'Sort by products' },
  { field: 'date',  label: 'Sort by date'     },
];
const DEFAULT_DIR = { name: 'asc', count: 'desc', date: 'desc' };

// ─── Sort toggle (mirror of ProductsList) ───────────────────────────────
function CatSortToggle({ sort, onSort }) {
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

function CatMenu({ btnRef, hasProducts, onEdit, onDeleteKeep, onDeleteMove, onDeleteAll, onClose }) {
  const [pos, setPos] = useState(null);
  const [hovered, setHovered] = useState(null);
  const { indRef, setItemRef } = DynamicBlock(hovered);

  useEffect(() => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: Math.max(8, r.right - 240) });
    }
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  if (!pos) return null;

  const dangerItems = [
    { key: 'delKeep', label: 'Delete (keep products)',   Icon: Trash,           onClick: onDeleteKeep, disabled: false },
    { key: 'delMove', label: 'Delete & move products…',  Icon: ArrowsLeftRight, onClick: onDeleteMove, disabled: !hasProducts },
    { key: 'delAll',  label: 'Delete with all products', Icon: Warning,         onClick: onDeleteAll,  disabled: !hasProducts },
  ];

  return createPortal(
    <div className="org-card-dropdown" style={{ top: pos.top, left: pos.left, minWidth: 240 }}
      onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>

      <div className="org-menu-block" onMouseLeave={() => setHovered(null)}>
        <div ref={indRef} className="org-menu-indicator" />
        <button ref={setItemRef('edit')}
          className={`org-card-dropdown-item org-menu-item${hovered === 'edit' ? ' org-menu-item--current' : ''}`}
          onMouseEnter={() => setHovered('edit')}
          onClick={onEdit}>
          <PencilSimple className="org-card-dropdown-icon" /> Edit
        </button>
      </div>

      <div className="org-card-dropdown-sep" />

      {dangerItems.map(({ key, label, Icon, onClick, disabled }) => (
        <button key={key}
          className={`org-card-dropdown-item org-card-dropdown-item--danger${disabled ? ' org-card-dropdown-item--disabled' : ''}`}
          onClick={() => !disabled && onClick()}
          disabled={disabled}>
          <Icon className="org-card-dropdown-icon" /> {label}
        </button>
      ))}
    </div>,
    document.body
  );
}

// ─── Category card — minimal: text + 3-dot on a single row ─────────────
function CategoryCard({ c, onEdit, onDeleteKeep, onDeleteMove, onDeleteAll }) {
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

  const handleCardClick = e => {
    if (e.target.closest?.('.org-card-dropdown')) return;
    onEdit();
  };

  return (
    <div ref={ref} className="org-card org-card--tilt cat-card1 cat-card--clickable" {...handlers}
      onClick={handleCardClick} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(); } }}>
      <div ref={glossRef} className="org-card-gloss cat-card-gloss" />
      <div className="cat-card-body">
        <span className="cat-card-title">{c.name}</span>
        <span className="cat-card-meta">
          {c.products_count === 0 ? 'No products' : c.products_count === 1 ? '1 product' : `${c.products_count} products`}
        </span>
      </div>
      <button ref={menuBtnRef} className="org-card-menu-btn cat-card-menu-btn" type="button"
        onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
        aria-label="Menu">
        <DotsThreeOutline weight="fill" />
      </button>
      {menuOpen && (
        <CatMenu btnRef={menuBtnRef} hasProducts={c.products_count > 0}
          onEdit={()         => { setMenuOpen(false); onEdit(); }}
          onDeleteKeep={()   => { setMenuOpen(false); onDeleteKeep(); }}
          onDeleteMove={()   => { setMenuOpen(false); onDeleteMove(); }}
          onDeleteAll={()    => { setMenuOpen(false); onDeleteAll(); }}
          onClose={()        => setMenuOpen(false)} />
      )}
    </div>
  );
}

function CategoryEditModal({ open, initial, pq, onClose, onSaved }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');

  // Products picker state
  const [products,  setProducts]  = useState([]);
  const [selected,  setSelected]  = useState(() => new Set());
  const [prodLoading, setProdLoading] = useState(false);
  const [prodSearch,  setProdSearch]  = useState('');

  const isEdit  = !!initial?.id;
  const dirty   = useRef(false);
  const lastSavedName = useRef(initial?.name ?? '');

  // Re-init form + reload products every time the modal opens
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setErr('');
    setProdSearch('');
    setProducts([]);
    setSelected(new Set());
    setProdLoading(true);
    dirty.current = false;
    lastSavedName.current = initial?.name ?? '';
    const url = isEdit
      ? `${API_BASE}/api/products${pq}&category_id=${initial.id}&include_uncategorized=true`
      : `${API_BASE}/api/products${pq}&uncategorized=true`;
    fetch(url, { credentials: 'include' })
      .then(r => r.json())
      .then(rows => {
        const list = Array.isArray(rows) ? rows : [];
        setProducts(list);
        // Pre-select products already in this category (edit mode only)
        if (isEdit) {
          setSelected(new Set(list.filter(p => p.category_id === initial.id).map(p => p.id)));
        }
      })
      .catch(() => setProducts([]))
      .finally(() => setProdLoading(false));
  }, [open, initial, isEdit, pq]);

  // ── Edit-mode auto-save: name is debounced (400ms after last keystroke) ──
  useEffect(() => {
    if (!open || !isEdit) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === lastSavedName.current) return;
    const t = setTimeout(async () => {
      const res = await fetch(`${API_BASE}/api/categories/${initial.id}${pq}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        lastSavedName.current = trimmed;
        dirty.current = true;
        setErr('');
      } else {
        const d = await res.json().catch(() => ({}));
        setErr(d.detail || 'Error');
      }
    }, 400);
    return () => clearTimeout(t);
  }, [name, isEdit, open, initial, pq]);

  if (!open) return null;

  // ── Edit-mode auto-save: each checkbox toggle is persisted instantly ────
  const persistSelection = async (nextSet) => {
    const res = await fetch(`${API_BASE}/api/categories/${initial.id}/products${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_ids: Array.from(nextSet) }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErr(d.detail || 'Failed to assign products');
      return false;
    }
    dirty.current = true;
    setErr('');
    return true;
  };

  const toggle = async (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
    if (!isEdit) return;          // create mode: persist once on submit
    const ok = await persistSelection(next);
    if (!ok) {
      // Revert optimistic change on failure
      setSelected(selected);
      return;
    }
    // Reflect new category_id locally so the "Uncategorized" badge updates immediately
    setProducts(prev => prev.map(p =>
      p.id === id ? { ...p, category_id: next.has(id) ? initial.id : null } : p
    ));
  };

  const filteredProducts = products.filter(p =>
    !prodSearch || (p.title || '').toLowerCase().includes(prodSearch.toLowerCase())
  );

  // Closing in edit mode after any change → reload parent list
  const handleClose = () => {
    if (isEdit && dirty.current) onSaved();
    else onClose();
  };

  // Create-mode flow: explicit Create button persists name + selection
  const submit = async e => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setErr('Name is required');
    setBusy(true); setErr('');

    const res = await fetch(`${API_BASE}/api/categories${pq}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(data.detail || 'Error'); setBusy(false); return; }

    if (data.id && selected.size > 0) {
      const res2 = await fetch(`${API_BASE}/api/categories/${data.id}/products${pq}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_ids: Array.from(selected) }),
      });
      if (!res2.ok) {
        const d2 = await res2.json().catch(() => ({}));
        setErr(d2.detail || 'Failed to assign products');
        setBusy(false);
        return;
      }
    }

    onSaved();
    setBusy(false);
  };

  const selectedCount = selected.size;

  return createPortal(
    <div className="auth-modal-overlay" onMouseDown={e => e.target === e.currentTarget && handleClose()}>
      <div className="auth-modal cat-edit-modal">
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">{isEdit ? 'Edit category' : 'New category'}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {isEdit ? 'Changes are saved automatically.' : 'A URL slug will be auto-generated from the name.'}
                </span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={handleClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body">
          <form onSubmit={submit} className="cat-edit-form">
            <div className="auth-field cat-edit-field">
              <label className="auth-label">Name</label>
              <input className="crm-input" autoFocus value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Trousers, Shoes, Drinks…" maxLength={100} />
            </div>

            {/* ── Products picker ─────────────────────────────────────── */}
            <div className="cat-prod-section">
              <div className="cat-prod-section-head">
                <label className="auth-label" style={{ margin: 0 }}>
                  {isEdit ? 'Products in this category' : 'Add products'}
                </label>
                <span className="cat-prod-count">
                  {selectedCount} selected
                </span>
              </div>

              <div className="cat-prod-search-wrap">
                <MagnifyingGlass className="cat-prod-search-icon" />
                <input className="crm-input cat-prod-search-input"
                  placeholder="Search products…"
                  value={prodSearch}
                  onChange={e => setProdSearch(e.target.value)} />
              </div>

              <div className="cat-prod-list">
                {prodLoading && <p className="cat-prod-empty">Loading…</p>}
                {!prodLoading && filteredProducts.length === 0 && (
                  <p className="cat-prod-empty">
                    {prodSearch
                      ? 'No products match your search.'
                      : isEdit
                        ? 'No products in this category yet, and nothing uncategorized to add.'
                        : 'No uncategorized products available.'}
                  </p>
                )}
                {!prodLoading && filteredProducts.map(p => {
                  const checked = selected.has(p.id);
                  const inThisCat = p.category_id === initial?.id;
                  return (
                    <label key={p.id}
                      className={`cat-prod-row${checked ? ' cat-prod-row--checked' : ''}`}>
                      <input type="checkbox" className="cat-prod-checkbox"
                        checked={checked} onChange={() => toggle(p.id)} />
                      <div className="cat-prod-thumb-wrap">
                        {p.first_image
                          ? <img className="cat-prod-thumb" src={p.first_image} alt="" />
                          : <div className="cat-prod-thumb-empty" />}
                      </div>
                      <span className="cat-prod-title">{p.title || 'Untitled'}</span>
                      {isEdit && !inThisCat && (
                        <span className="cat-prod-badge">Uncategorized</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>

            {err && <span className="crm-form-error">{err}</span>}
            {!isEdit && (
              <div className="auth-actions">
                <button className="crm-submit-btn" type="submit" disabled={busy}>
                  {busy ? 'Saving…' : 'Create'}
                </button>
                <button className="crm-submit-btn auth-btn-secondary" type="button" onClick={onClose}>
                  Cancel
                </button>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
}

function slugifyPreview(name) {
  const s = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return s.slice(0, 30) || 'category';
}

// ─── Delete: keep products (simple confirm) ─────────────────────────────
function DeleteKeepModal({ category, pq, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  if (!category) return null;
  const count = category.products_count;
  const go = async () => {
    setBusy(true);
    await fetch(`${API_BASE}/api/categories/${category.id}${pq}&mode=keep_products`, {
      method: 'DELETE', credentials: 'include',
    });
    onDone(); setBusy(false);
  };
  return createPortal(
    <div className="auth-modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="auth-modal cat-edit-modal">
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">Delete category</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">Products inside will become uncategorized — they are NOT deleted.</span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>
        <div className="auth-modal-body">
          <p className="cat-modal-text">
            Delete <b>{category.name}</b>?
            {count > 0 && <> {count === 1 ? '1 product' : `${count} products`} will move to <b>Uncategorized</b>.</>}
          </p>
          <div className="auth-actions">
            <button className="crm-submit-btn auth-btn-danger" onClick={go} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete category'}
            </button>
            <button className="crm-submit-btn auth-btn-secondary" type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Delete & move (pick destination) ───────────────────────────────────
function DeleteMoveModal({ category, allCategories, pq, onClose, onDone }) {
  const [target, setTarget] = useState('');
  const [busy,   setBusy]   = useState(false);
  const [err,    setErr]    = useState('');
  if (!category) return null;
  const choices = allCategories.filter(c => c.id !== category.id);
  const count = category.products_count;

  const go = async () => {
    if (!target) return setErr('Pick a destination category');
    setBusy(true); setErr('');
    const res = await fetch(`${API_BASE}/api/categories/${category.id}${pq}&mode=move&target_id=${target}`, {
      method: 'DELETE', credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(data.detail || 'Error'); setBusy(false); return; }
    onDone(); setBusy(false);
  };

  return createPortal(
    <div className="auth-modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="auth-modal cat-edit-modal">
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">Delete &amp; move products</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">All products will be moved to another category before deletion.</span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>
        <div className="auth-modal-body">
          <p className="cat-modal-text">
            Move {count === 1 ? '1 product' : `${count} products`} from <b>{category.name}</b> to:
          </p>
          {choices.length === 0 ? (
            <p className="cat-modal-hint">No other categories exist. Create one first, or use a different delete option.</p>
          ) : (
            <div className="auth-field cat-edit-field">
              <label className="auth-label">Destination</label>
              <select className="crm-input" value={target} onChange={e => setTarget(e.target.value)}>
                <option value="">— Select destination —</option>
                {choices.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.products_count})</option>
                ))}
              </select>
            </div>
          )}
          {err && <span className="crm-form-error">{err}</span>}
          <div className="auth-actions">
            <button className="crm-submit-btn auth-btn-danger" onClick={go}
              disabled={busy || !target || choices.length === 0}>
              {busy ? 'Moving…' : 'Move & Delete'}
            </button>
            <button className="crm-submit-btn auth-btn-secondary" type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Delete with all products (type-to-confirm) ─────────────────────────
function DeleteAllModal({ category, pq, onClose, onDone }) {
  const [typed, setTyped] = useState('');
  const [busy,  setBusy]  = useState(false);
  if (!category) return null;
  const count = category.products_count;
  const matches = typed === category.name;

  const go = async () => {
    if (!matches) return;
    setBusy(true);
    await fetch(`${API_BASE}/api/categories/${category.id}${pq}&mode=delete_products`, {
      method: 'DELETE', credentials: 'include',
    });
    onDone(); setBusy(false);
  };

  return createPortal(
    <div className="auth-modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="auth-modal cat-edit-modal">
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">Delete with all products</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle cat-modal-danger-text">This action cannot be undone.</span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>
        <div className="auth-modal-body">
          <p className="cat-modal-text">
            This will permanently delete the category <b>{category.name}</b>{' '}
            and {count === 1 ? '1 product' : `all ${count} products`} inside it,
            including their variations, sizes, reviews, and cart entries.
          </p>
          <div className="auth-field cat-edit-field">
            <label className="auth-label">
              Type <code className="cat-modal-code">{category.name}</code> to confirm
            </label>
            <input className="crm-input" value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder={category.name} autoFocus />
          </div>
          <div className="auth-actions">
            <button className="crm-submit-btn auth-btn-danger" onClick={go} disabled={!matches || busy}>
              {busy ? 'Deleting…' : `Delete category${count > 0 ? ` + ${count} product${count === 1 ? '' : 's'}` : ''}`}
            </button>
            <button className="crm-submit-btn auth-btn-secondary" type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Main page ──────────────────────────────────────────────────────────
export default function Categories() {
  const { projectId } = useOutletContext();
  const pq = `?project_id=${projectId}`;

  const [cats,    setCats]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [sort,    setSort]    = useState({ field: 'name', dir: 'asc' });

  // Modal state
  const [editTarget, setEditTarget] = useState(null);
  const [deleteKeep, setDeleteKeep] = useState(null);
  const [deleteMove, setDeleteMove] = useState(null);
  const [deleteAll,  setDeleteAll]  = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/categories${pq}`, { credentials: 'include' });
      const data = await res.json();
      setCats(Array.isArray(data) ? data : []);
    } catch { setCats([]); }
    setLoading(false);
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const filtered = cats.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()));
  const sorted = [...filtered].sort((a, b) => {
    if (sort.field === 'name')  { const c = a.name.localeCompare(b.name); return sort.dir === 'asc' ? c : -c; }
    if (sort.field === 'count') return sort.dir === 'asc' ? a.products_count - b.products_count : b.products_count - a.products_count;
    return sort.dir === 'asc'
      ? new Date(a.created_at) - new Date(b.created_at)
      : new Date(b.created_at) - new Date(a.created_at);
  });

  return (
    <div className="prod-page prod-page--in-tabs">
      {/* Toolbar — search left, sort + New on right */}
      <div className="org-toolbar">
        <div className="org-search-wrap">
          <MagnifyingGlass className="org-search-icon" />
          <input className="org-search-input" placeholder="Search categories…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <CatSortToggle sort={sort} onSort={setSort} />
        <button className="org-new-btn" onClick={() => setEditTarget({})} type="button">
          <Plus className="org-new-icon" /> New Category
        </button>
      </div>

      {/* Grid only */}
      <div className="prod-content">
        {loading && <p className="crm-placeholder">Loading…</p>}
        {!loading && sorted.length === 0 && (
          <p className="crm-placeholder">
            {search ? 'No categories match your search.' : 'No categories yet. Click "New Category" to add one.'}
          </p>
        )}
        {!loading && sorted.length > 0 && (
          <div className="cat-grid">
            {sorted.map(c => (
              <CategoryCard key={c.id} c={c}
                onEdit={()       => setEditTarget(c)}
                onDeleteKeep={() => setDeleteKeep(c)}
                onDeleteMove={() => setDeleteMove(c)}
                onDeleteAll={()  => setDeleteAll(c)} />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      <CategoryEditModal open={!!editTarget} initial={editTarget} pq={pq}
        onClose={() => setEditTarget(null)}
        onSaved={() => { setEditTarget(null); load(); }} />
      <DeleteKeepModal category={deleteKeep} pq={pq}
        onClose={() => setDeleteKeep(null)}
        onDone={()  => { setDeleteKeep(null); load(); }} />
      <DeleteMoveModal category={deleteMove} allCategories={cats} pq={pq}
        onClose={() => setDeleteMove(null)}
        onDone={()  => { setDeleteMove(null); load(); }} />
      <DeleteAllModal category={deleteAll} pq={pq}
        onClose={() => setDeleteAll(null)}
        onDone={()  => { setDeleteAll(null); load(); }} />
    </div>
  );
}
