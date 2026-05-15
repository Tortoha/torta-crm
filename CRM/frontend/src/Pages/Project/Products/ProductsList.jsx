import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Plus, Trash, PencilSimple, DotsThreeOutline, MagnifyingGlass, X, Image,
  List, SquaresFour, ArrowDown, FolderSimple, CaretDown, Archive,
  ArrowCounterClockwise, Pause, Play, CopySimple, CheckCircle, Barcode,
  UploadSimple, DownloadSimple
} from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { InteractiveSection } from '../../../Utils/InteractiveSection.js';
import { DynamicBlock } from '../../../Utils/DynamicBlock.js';
import { encodeId } from '../../../Utils/hashids.js';
import { RowContextMenu } from '../../../Utils/RowContextMenu.jsx';
import { useInfiniteList } from '../../../Utils/useInfiniteList.js';
import { useInfiniteScroll } from '../../../Utils/useInfiniteScroll.js';
import CreateProductModal from './CreateProductModal.jsx';
import PrintBarcodesModal from './PrintBarcodesModal.jsx';
import ImportCsvModal from './ImportCsvModal.jsx';
import '../../../Style/Organization.css';
import '../../../Style/Products.css';

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

function ProdMenu({ btnRef, onEdit, onDelete, onClose, isArchived, isPaused, productType = 'physical',
                    onArchive, onUnarchive, onPause, onResume, onDuplicate,
                    onPrintBarcode }) {
  const [pos, setPos] = useState(null);
  const [hovered, setHovered] = useState(null);
  const indRef  = useRef(null);
  const itemEls = useRef({});

  useEffect(() => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: Math.max(8, r.right - 180) });
    }
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Dynamic Block sliding indicator (vertical) — same look as Sidebar / Header dropdowns / Card menus.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      if (!ind) return;
      const el = hovered != null ? itemEls.current[hovered] : null;
      if (!el) { ind.style.opacity = '0'; ind.style.height = '0'; return; }
      ind.style.opacity   = '1';
      ind.style.transform = `translateY(${el.offsetTop}px)`;
      ind.style.height    = `${el.offsetHeight}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [hovered, pos]);

  if (!pos) return null;

  // Print options per product type:
  //   physical → single entry: "Print barcode" — scope (product / config / batch
  //              variants) is now picked inside the modal itself.
  //   service/digital → no print entry
  const printEntries = (() => {
    if (productType === 'physical' && onPrintBarcode) {
      return [{ key: 'print', label: 'Print barcode',
        icon: <Barcode className="org-card-dropdown-icon" />, onClick: onPrintBarcode }];
    }
    return [];
  })();

  // Build the list once so refs + map stay in sync.
  const items = [
    { key: 'edit',      label: 'Edit',          icon: <PencilSimple className="org-card-dropdown-icon" />, onClick: onEdit },
    onDuplicate && { key: 'duplicate', label: 'Duplicate',  icon: <CopySimple className="org-card-dropdown-icon" />, onClick: onDuplicate },
    ...printEntries,
    !isArchived && (isPaused
      ? { key: 'resume', label: 'Resume', icon: <Play  className="org-card-dropdown-icon" />, onClick: onResume }
      : { key: 'pause',  label: 'Pause',  icon: <Pause className="org-card-dropdown-icon" />, onClick: onPause }),
    isArchived
      ? { key: 'restore', label: 'Restore', icon: <ArrowCounterClockwise className="org-card-dropdown-icon" />, onClick: onUnarchive }
      : { key: 'archive', label: 'Archive', icon: <Archive className="org-card-dropdown-icon" />, onClick: onArchive },
    { key: 'delete', label: 'Delete', icon: <Trash className="org-card-dropdown-icon" />, onClick: onDelete, danger: true },
  ].filter(Boolean);

  return createPortal(
    <div className="org-card-dropdown" style={{ top: pos.top, left: pos.left }}
      onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <div className="org-menu-block" onMouseLeave={() => setHovered(null)}>
        <div ref={indRef}
          className={`org-menu-indicator${hovered && items.find(x => x.key === hovered)?.danger ? ' org-menu-indicator--danger' : ''}`} />
        {items.map((it) => (
          <button key={it.key} type="button"
            ref={el => { if (el) itemEls.current[it.key] = el; else delete itemEls.current[it.key]; }}
            className={`org-card-dropdown-item org-menu-item${it.danger ? ' org-card-dropdown-item--danger' : ''}${hovered === it.key ? ' org-menu-item--current' : ''}`}
            onMouseEnter={() => setHovered(it.key)}
            onClick={it.onClick}>
            {it.icon} {it.label}
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}

// ── Category filter dropdown ───────────────────────────────────
// Single-select: All / Uncategorized / one of N. Inline-create at the bottom.
// Selected value: null=all, 'uncategorized'=NULL filter, number=category id.

function CategoryFilter({ value, categories, onChange, onCreate }) {
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos,  setPos]  = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName,  setNewName]  = useState('');
  const [hovered,  setHovered]  = useState(null);

  // Stable key for each item — used by Dynamic Block indicator
  const activeKey = value === null ? 'all' : value === 'uncategorized' ? 'uncat' : `c:${value}`;
  const current   = hovered ?? activeKey;
  // Pass `open` as resetKey so the indicator re-measures when the portal mounts
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

  const submitNew = async e => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const created = await onCreate(name);
    if (created) {
      setNewName(''); setCreating(false);
      onChange(created.id); setOpen(false);
    }
  };

  return (
    <>
      <button ref={btnRef} className="cat-filter-btn" type="button"
        onClick={() => setOpen(v => !v)}>
        <FolderSimple className="cat-filter-icon" />
        <span>{label}</span>
        <CaretDown className="cat-filter-caret" weight="bold" />
      </button>
      {open && pos && createPortal(
        <div className="cat-filter-dropdown" style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
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
          <div className="cat-filter-sep" />
          {creating ? (
            <form onSubmit={submitNew} className="cat-filter-create-form">
              <input className="cat-filter-create-input" autoFocus value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Category name…" maxLength={100}
                onKeyDown={e => { if (e.key === 'Escape') { setCreating(false); setNewName(''); } }} />
              <button type="submit" className="cat-filter-create-go">Add</button>
            </form>
          ) : (
            <button ref={setItemRef('new')}
              className={`cat-filter-item cat-filter-item--new${current === 'new' ? ' cat-filter-item--current' : ''}`}
              onMouseEnter={() => setHovered('new')}
              onClick={() => setCreating(true)}>
              <Plus weight="bold" className="cat-filter-new-icon" />
              <span>New Category</span>
            </button>
          )}
        </div>,
        document.body
      )}
    </>
  );
}

// ── Price label helper ─────────────────────────────────────────

function priceLabel(p) {
  if (p.min_price === 0 && p.max_price === 0) return '—';
  if (p.min_price === p.max_price) return `$${p.min_price.toFixed(0)}`;
  return `$${p.min_price.toFixed(0)}–${p.max_price.toFixed(0)}`;
}

// ── Custom sharp star (polygon = straight lines, no rounded tips) ─
function StarIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <polygon fill="currentColor"
        points="12,1.5 14.47,8.6 22,8.76 16,13.3 18.17,20.5 12,16.2 5.83,20.5 8,13.3 2.01,8.76 9.53,8.6" />
    </svg>
  );
}

// ── 5-star rating row ──────────────────────────────────────────
// Filled = blue accent, empty = #D9D9D9. 10×10px stars, gap 1px.

function StarRating({ value }) {
  const filled = Math.round(value);
  return (
    <span className="pcard-stars">
      <span className="pcard-stars-num">{value.toFixed(1)}</span>
      <span className="pcard-stars-row">
        {[0, 1, 2, 3, 4].map(i => (
          <StarIcon key={i} className={`pcard-star-icon${i < filled ? ' pcard-star-icon--on' : ''}`} />
        ))}
      </span>
    </span>
  );
}

// ── VariationsPopover (horizontal card grid) ───────────────────
// Two-pass positioning:
//   Pass 1 (mount effect)  → record anchor rect, set initial pos → React renders portal
//   Pass 2 (pos effect)    → popRef.current is now in DOM → measure real height → correct pos → reveal

function VariationsPopover({ variations, anchorRef, onClose }) {
  const popRef     = useRef(null);
  const anchorRect = useRef(null);
  const [pos,   setPos]   = useState(null);
  const [ready, setReady] = useState(false);

  // Aggregate every photo from every variation into one flat list (de-duped).
  // Max 6 per row by CSS — long lists wrap into multiple rows.
  // Back-compat: if a variation still carries the legacy single `image_url`
  // (stale response, browser cache, etc.) treat it as a one-photo gallery.
  const allImages = useMemo(() => {
    const seen = new Set(); const out = [];
    for (const v of (variations || [])) {
      const arr = Array.isArray(v.images) && v.images.length > 0
        ? v.images
        : (v.image_url || v.image ? [v.image_url || v.image] : []);
      for (const u of arr) {
        if (u && !seen.has(u)) { out.push(u); seen.add(u); }
      }
    }
    return out;
  }, [variations]);

  useEffect(() => {
    if (!anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    anchorRect.current = r;
    setPos({ top: r.bottom + 8, left: r.left + r.width / 2, above: false });

    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pos || ready) return;
    const pop = popRef.current;
    if (!pop) return;
    const r         = anchorRect.current;
    const h         = pop.offsetHeight;
    const openAbove = r.top > h + 12;
    setPos({ top: openAbove ? r.top - h - 8 : r.bottom + 8, left: r.left + r.width / 2, above: openAbove });
    setReady(true);
  }, [pos]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pos || allImages.length === 0) return null;
  return createPortal(
    <div ref={popRef}
      className={`pvar-stack${pos.above ? ' pvar-stack--above' : ''}${ready ? ' pvar-stack--ready' : ''}`}
      style={{ top: pos.top, left: pos.left }}
      onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      {allImages.map((url, i) => (
        <div key={url} className="pvar-photo" style={{ animationDelay: `${i * 28}ms` }}>
          <img src={url} alt="" className="pvar-thumb" />
        </div>
      ))}
    </div>,
    document.body
  );
}

// ── Hover-lift image with click-to-open variations popover ─────
// Used by both ProductCard (grid) and ProdListRow (list).

function ProductImage({ p, size = 'card', onPopChange }) {
  const wrapRef = useRef(null);
  const [popOpen, setPopOpen] = useState(false);
  const variations = Array.isArray(p.variations) ? p.variations : [];
  const hasVariations = variations.length > 0;

  const open  = () => { setPopOpen(true);  onPopChange?.(true);  };
  const close = () => { setPopOpen(false); onPopChange?.(false); };
  const toggle = () => { popOpen ? close() : open(); };

  const wrapCls  = size === 'row' ? 'prow-img-wrap pimg-hover' : 'pcard-img-wrap pimg-hover';
  const imgCls   = size === 'row' ? 'prow-img' : 'pcard-img';
  const emptyCls = size === 'row' ? 'prow-img-empty' : 'pcard-img-empty';
  const iconSize = size === 'row' ? 14 : 22;

  return (
    <div ref={wrapRef} className={wrapCls}
      onClick={e => { if (hasVariations) { e.stopPropagation(); toggle(); } }}>
      {p.first_image
        ? <img src={p.first_image} alt={p.title} className={imgCls} />
        : <div className={emptyCls}><Image size={iconSize} /></div>}

      {/* Transparent full-screen overlay — sits below the popover, intercepts all
          outside clicks so the popover closes WITHOUT triggering card navigation */}
      {popOpen && hasVariations && createPortal(
        <div className="pvar-overlay" onClick={e => { e.stopPropagation(); close(); }} />,
        document.body
      )}
      {popOpen && hasVariations && (
        <VariationsPopover variations={variations} anchorRef={wrapRef} onClose={close} />
      )}
    </div>
  );
}

// ── ProductCard ────────────────────────────────────────────────

function ProductCard({ p, onOpen, onDelete, onArchive, onUnarchive, onPause, onResume, onDuplicate,
                      onContextMenu, bulkMode, selected, onToggleSelect,
                      onPrintBarcode }) {
  const menuBtnRef = useRef(null);
  const [menuOpen,   setMenuOpen]   = useState(false);
  const [imgPopOpen, setImgPopOpen] = useState(false);
  const { ref, glossRef, handlers } = InteractiveSection(CARD_TILT, menuOpen || imgPopOpen);

  useEffect(() => {
    if (!menuOpen) return;
    const h = e => {
      if (!e.target.closest?.('.org-card-dropdown') && !menuBtnRef.current?.contains(e.target))
        setMenuOpen(false);
    };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [menuOpen]);

  // In bulk-mode every click toggles selection. Outside bulk-mode paused products are click-locked.
  const handleClick = (e) => {
    if (bulkMode) { e.stopPropagation(); onToggleSelect?.(); return; }
    if (p.is_paused) { e.stopPropagation(); return; }
    onOpen();
  };

  const handleContextMenu = (e) => {
    e.preventDefault(); e.stopPropagation();
    onContextMenu?.({ x: e.clientX, y: e.clientY });
  };

  return (
    <div ref={ref}
      className={`org-card org-card--tilt prod-card${p.is_paused ? ' prod-card--paused' : ''}${selected ? ' prod-card--selected' : ''}`}
      onClick={handleClick} onContextMenu={handleContextMenu} {...handlers}>
      <div ref={glossRef} className="org-card-gloss prod-card-gloss" />
      {bulkMode && (
        <input type="checkbox" className="cat-prod-checkbox layer1-bulk-check"
          checked={!!selected}
          onChange={() => onToggleSelect?.()}
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          aria-label="Toggle selection" />
      )}
      <div className="pcard-inner">
        <ProductImage p={p} size="card" onPopChange={setImgPopOpen} />
        <div className="pcard-body">
          <div className="pcard-title">{p.title}</div>
          <div className="pcard-row1">
            <span className="pcard-price">{priceLabel(p)}</span>
            {p.total_stock > 0 && <><span className="pcard-pipe">|</span><span className="pcard-stock">Stock {p.total_stock}</span></>}
          </div>
          {p.reviews_count > 0 && <StarRating value={p.avg_rating} />}
        </div>
      </div>
      {p.category_name && (
        <span className="pcard-cat-badge">{p.category_name}</span>
      )}
      {!bulkMode && (
        <button ref={menuBtnRef} className="org-card-menu-btn pcard-menu-btn" type="button"
          onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}>
          <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
        </button>
      )}
      {menuOpen && (
        <ProdMenu btnRef={menuBtnRef}
          isArchived={!!p.is_archived} isPaused={!!p.is_paused} productType={p.product_type || 'physical'}
          onEdit={() => { setMenuOpen(false); onOpen(); }}
          onDuplicate={() => { setMenuOpen(false); onDuplicate?.(); }}
          onPrintBarcode={onPrintBarcode ? () => { setMenuOpen(false); onPrintBarcode(); } : null}
          onArchive={() => { setMenuOpen(false); onArchive?.(); }}
          onUnarchive={() => { setMenuOpen(false); onUnarchive?.(); }}
          onPause={() => { setMenuOpen(false); onPause?.(); }}
          onResume={() => { setMenuOpen(false); onResume?.(); }}
          onDelete={() => { setMenuOpen(false); onDelete(); }}
          onClose={() => setMenuOpen(false)} />
      )}
    </div>
  );
}

// ── ProdListRow ────────────────────────────────────────────────
// Variations column dropped (lives inside the image popover now).

function ProdListRow({ p, onOpen, onDelete, onArchive, onUnarchive, onPause, onResume, onDuplicate,
                       onContextMenu, bulkMode, selected, onToggleSelect,
                       onPrintBarcode }) {
  const menuBtnRef = useRef(null);
  const [menuOpen,   setMenuOpen]   = useState(false);
  const [imgPopOpen, setImgPopOpen] = useState(false);
  const { ref, glossRef, handlers } = InteractiveSection(ROW_TILT, menuOpen || imgPopOpen);

  useEffect(() => {
    if (!menuOpen) return;
    const h = e => {
      if (!e.target.closest?.('.org-card-dropdown') && !menuBtnRef.current?.contains(e.target))
        setMenuOpen(false);
    };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [menuOpen]);

  const handleClick = (e) => {
    if (bulkMode) { e.stopPropagation(); onToggleSelect?.(); return; }
    if (p.is_paused) { e.stopPropagation(); return; }
    onOpen();
  };

  const handleContextMenu = (e) => {
    e.preventDefault(); e.stopPropagation();
    onContextMenu?.({ x: e.clientX, y: e.clientY });
  };

  return (
    <div ref={ref}
      className={`prow${bulkMode ? ' prow--bulk-mode' : ''}${menuOpen || imgPopOpen ? ' org-list-row--frozen' : ''}${p.is_paused ? ' prow--paused' : ''}${selected ? ' prow--selected' : ''}`}
      onClick={handleClick} onContextMenu={handleContextMenu} {...handlers}>
      <div ref={glossRef} className="org-list-gloss" />
      {bulkMode && (
        <input type="checkbox" className="cat-prod-checkbox prow-bulk-check"
          checked={!!selected}
          onChange={() => onToggleSelect?.()}
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          aria-label="Toggle selection" />
      )}
      <ProductImage p={p} size="row" onPopChange={setImgPopOpen} />
      <span className="prow-name">{p.title}</span>
      <span className="prow-cell">{p.category_name || <span className="prow-empty">—</span>}</span>
      <span className="prow-cell">{priceLabel(p)}</span>
      <span className="prow-cell">{p.total_stock > 0 ? `Stock ${p.total_stock}` : '—'}</span>
      <span className="prow-cell">
        {p.reviews_count > 0
          ? <StarRating value={p.avg_rating} />
          : '—'}
      </span>
      {!bulkMode && (
        <button ref={menuBtnRef} className="org-list-menu-btn" type="button"
          onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}>
          <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
        </button>
      )}
      {menuOpen && (
        <ProdMenu btnRef={menuBtnRef}
          isArchived={!!p.is_archived} isPaused={!!p.is_paused} productType={p.product_type || 'physical'}
          onEdit={() => { setMenuOpen(false); onOpen(); }}
          onDuplicate={() => { setMenuOpen(false); onDuplicate?.(); }}
          onPrintBarcode={onPrintBarcode ? () => { setMenuOpen(false); onPrintBarcode(); } : null}
          onArchive={() => { setMenuOpen(false); onArchive?.(); }}
          onUnarchive={() => { setMenuOpen(false); onUnarchive?.(); }}
          onPause={() => { setMenuOpen(false); onPause?.(); }}
          onResume={() => { setMenuOpen(false); onResume?.(); }}
          onDelete={() => { setMenuOpen(false); onDelete(); }}
          onClose={() => setMenuOpen(false)} />
      )}
    </div>
  );
}

// ── Products (main page) ───────────────────────────────────────

export default function Products({ archived = false }) {
  const { projectId, project } = useOutletContext();
  const navigate = useNavigate();
  const pq = `?project_id=${projectId}`;

  const [categories,  setCategories]  = useState([]);
  const [catFilter,   setCatFilter]   = useState(null);  // null=all, 'uncategorized', or numeric id
  const [statusFilter, setStatusFilter] = useState('all');   // all | active | paused
  const [search,      setSearch]      = useState('');
  const [view,        setView]        = useState('grid');
  const [viewHover,   setViewHover]   = useState(null);
  const [sort,        setSort]        = useState({ field: 'name', dir: 'asc' });
  const [showCreate,  setShowCreate]  = useState(false);  // new product modal
  const [bulkMode,    setBulkMode]    = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [ctxMenu,     setCtxMenu]     = useState(null);    // { pos, product }
  const [showImport,  setShowImport]  = useState(false);
  const [printTarget, setPrintTarget] = useState(null);    // { mode: 'single'|'bulk', productIds: [int] }
  const [toast,       setToast]       = useState('');
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3200); };

  const loadCategories = useCallback(async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/categories${pq}`, { credentials: 'include' });
      const data = await res.json();
      setCategories(Array.isArray(data) ? data : []);
    } catch { setCategories([]); }
  }, [projectId]);

  // Infinite-scroll product list — server returns 50 at a time, IntersectionObserver triggers next page.
  const extraQS = useMemo(() => {
    const parts = [];
    if (catFilter === 'uncategorized') parts.push('uncategorized=true');
    else if (catFilter !== null)       parts.push(`category_id=${catFilter}`);
    if (archived) parts.push('archived=true');
    return parts.join('&');
  }, [catFilter, archived]);

  const {
    items: products, hasMore, loading, loadMore, reload, setItems: setProducts,
  } = useInfiniteList({
    url: `${API_BASE}/api/products${pq}`,
    pageSize: 50,
    extraQS,
  });
  const sentinelRef = useInfiniteScroll(loadMore);
  const load = reload;                  // local alias — keeps existing call-sites unchanged

  useEffect(() => { loadCategories(); }, [loadCategories]);

  // Quick toggle helpers — reuse PUT /api/products/{id} with a single boolean field.
  const patchProduct = useCallback(async (id, body) => {
    const res = await fetch(`${API_BASE}/api/products/${id}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) load();
  }, [projectId, load]);

  const archive   = (id) => patchProduct(id, { is_archived: true,  is_paused: false });
  const unarchive = (id) => patchProduct(id, { is_archived: false });
  const pause     = (id) => patchProduct(id, { is_paused: true });
  const resume    = (id) => patchProduct(id, { is_paused: false });

  const duplicate = async (id) => {
    const res = await fetch(`${API_BASE}/api/products/${id}/duplicate${pq}`, {
      method: 'POST', credentials: 'include',
    });
    if (res.ok) {
      showToast('Product duplicated');
      load();
    } else {
      showToast('Duplicate failed');
    }
  };

  const bulkAction = async (action, extra = {}) => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (action === 'delete' && !confirm(`Delete ${ids.length} product(s)? This cannot be undone.`)) return;
    const res = await fetch(`${API_BASE}/api/projects/${projectId}/products/bulk`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, product_ids: ids, ...extra }),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(`${data.affected ?? ids.length} product(s) updated`);
      setSelectedIds(new Set());
      setBulkMode(false);
      load();
    } else {
      showToast('Bulk action failed');
    }
  };

  const exportCsv = async () => {
    const ids = bulkMode && selectedIds.size > 0 ? Array.from(selectedIds) : null;
    const qs = ids ? `?ids=${ids.join(',')}` : '';
    window.location.href = `${API_BASE}/api/projects/${projectId}/products/export.csv${qs}`;
  };

  // Inline-create category from the filter dropdown
  const createCategory = async name => {
    const res = await fetch(`${API_BASE}/api/categories${pq}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    const created = await res.json();
    await loadCategories();
    return created;
  };

  const deleteProduct = async id => {
    if (!confirm('Delete this product? All variations, sizes and reviews will also be deleted.')) return;
    await fetch(`${API_BASE}/api/products/${id}${pq}`, { method: 'DELETE', credentials: 'include' });
    load();
  };

  const goToProduct = id => navigate(`/product/${encodeId(id)}`);

  // Bulk-mode selection helpers
  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const enterBulkMode = (initialId) => {
    setBulkMode(true);
    if (initialId != null) setSelectedIds(new Set([initialId]));
  };
  const exitBulkMode = () => { setBulkMode(false); setSelectedIds(new Set()); };

  // ESC exits bulk-mode
  useEffect(() => {
    if (!bulkMode) return;
    const onKey = (e) => { if (e.key === 'Escape') exitBulkMode(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [bulkMode]);

  // Auto-exit bulk-mode when the last item is deselected (200ms grace so quick re-clicks don't kick out).
  useEffect(() => {
    if (!bulkMode || selectedIds.size > 0) return;
    const t = setTimeout(() => { if (selectedIds.size === 0) setBulkMode(false); }, 200);
    return () => clearTimeout(t);
  }, [bulkMode, selectedIds]);

  const filtered = products.filter(p => {
    if (search && !p.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter === 'active' && p.is_paused) return false;
    if (statusFilter === 'paused' && !p.is_paused) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    // Paused products always sink to the bottom regardless of the chosen sort.
    if (!!a.is_paused !== !!b.is_paused) return a.is_paused ? 1 : -1;
    if (sort.field === 'name')  { const c = a.title.localeCompare(b.title); return sort.dir === 'asc' ? c : -c; }
    if (sort.field === 'price') return sort.dir === 'asc' ? a.min_price - b.min_price : b.min_price - a.min_price;
    return sort.dir === 'asc' ? a.id - b.id : b.id - a.id;
  });

  // Grouped by product_type for the Active tab. Groups stay in fixed order
  // (Physical → Digital → Services) so the page reads consistently
  // regardless of how many items are in each. Empty groups are hidden.
  const TYPE_GROUPS = [
    { key: 'physical', label: 'Physical' },
    { key: 'digital',  label: 'Digital'  },
    { key: 'service',  label: 'Services' },
  ];
  const grouped = TYPE_GROUPS.map(g => ({
    ...g,
    items: sorted.filter(p => (p.product_type || 'physical') === g.key),
  })).filter(g => g.items.length > 0);

  const curView = viewHover ?? view;

  const buildCtxItems = (p) => {
    const ptype = p.product_type || 'physical';
    // Print options per type:
    //   physical → regular barcode (product-level)
    //   service/digital → nothing (no physical sticker)
    const printItems = [];
    if (ptype === 'physical') {
      printItems.push({ label: 'Print barcode',
        icon: <Barcode className="org-card-dropdown-icon" />,
        onClick: () => setPrintTarget({ mode: 'product', qrMode: false, productIds: [p.id] }) });
    }
    const items = [
      { label: 'Edit',      icon: <PencilSimple className="org-card-dropdown-icon" />, onClick: () => goToProduct(p.id) },
      { label: 'Duplicate', icon: <CopySimple   className="org-card-dropdown-icon" />, onClick: () => duplicate(p.id) },
      ...printItems,
      { label: 'Select',    icon: <CheckCircle  className="org-card-dropdown-icon" />, onClick: () => enterBulkMode(p.id) },
    ];
    if (!p.is_archived) {
      items.push(p.is_paused
        ? { label: 'Resume', icon: <Play  className="org-card-dropdown-icon" />, onClick: () => resume(p.id) }
        : { label: 'Pause',  icon: <Pause className="org-card-dropdown-icon" />, onClick: () => pause(p.id) }
      );
    }
    items.push(p.is_archived
      ? { label: 'Restore', icon: <ArrowCounterClockwise className="org-card-dropdown-icon" />, onClick: () => unarchive(p.id) }
      : { label: 'Archive', icon: <Archive className="org-card-dropdown-icon" />, onClick: () => archive(p.id) }
    );
    items.push({ label: 'Delete', icon: <Trash className="org-card-dropdown-icon" />, onClick: () => deleteProduct(p.id), danger: true });
    return items;
  };

  return (
    <div className="prod-page prod-page--in-tabs">
      {/* Toolbar — search hugs the left, everything else groups on the right. */}
      <div className="org-toolbar">
        <div className="org-search-wrap">
          <MagnifyingGlass className="org-search-icon" />
          <input className="org-search-input" placeholder="Search products…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="org-toolbar-right">
          <ProdSortToggle sort={sort} onSort={setSort} />

          <CategoryFilter value={catFilter} categories={categories}
            onChange={setCatFilter} onCreate={createCategory} />

          {!archived && <StatusChips value={statusFilter} onChange={setStatusFilter} />}

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

          <ImportExportToggle
            onImport={() => setShowImport(true)}
            onExport={exportCsv}
          />
          <button className="org-new-btn" onClick={() => setShowCreate(true)} type="button">
            <Plus className="org-new-icon" /> New Product
          </button>
        </div>
      </div>

      {/* Product list — split into per-type groups (Physical / Digital / Services / Events). */}
      <div className="prod-content">
        {loading && <p className="crm-placeholder">Loading…</p>}

        {!loading && sorted.length === 0 && (
          <p className="crm-placeholder">
            {search ? 'No products match your search.' : 'No products yet. Click "New Product" to add one.'}
          </p>
        )}

        {!loading && grouped.map(g => (
          <section key={g.key} className="prod-group">
            <h2 className="prod-group-title">
              {g.label}
              <span className="prod-group-count">{g.items.length}</span>
            </h2>

            {view === 'grid' && (
              <div className="prod-grid">
                {g.items.map(p => (
                  <ProductCard key={p.id} p={p}
                    bulkMode={bulkMode}
                    selected={selectedIds.has(p.id)}
                    onToggleSelect={() => toggleSelect(p.id)}
                    onContextMenu={(pos) => setCtxMenu({ pos, product: p })}
                    onOpen={() => goToProduct(p.id)}
                    onDelete={() => deleteProduct(p.id)}
                    onDuplicate={() => duplicate(p.id)}
                    onPrintBarcode={
                      (p.product_type || 'physical') === 'physical'
                        ? () => setPrintTarget({ mode: 'product', qrMode: false, productIds: [p.id] })
                        : null
                    }
                    onArchive={() => archive(p.id)}
                    onUnarchive={() => unarchive(p.id)}
                    onPause={() => pause(p.id)}
                    onResume={() => resume(p.id)} />
                ))}
              </div>
            )}

            {view === 'list' && (
              <div className="prod-list">
                <div className={`prod-list-head${bulkMode ? ' prod-list-head--bulk-mode' : ''}`}>
                  {bulkMode && <span />}
                  <span /><span className="org-list-th">Title</span>
                  <span className="org-list-th">Category</span>
                  <span className="org-list-th">Price</span><span className="org-list-th">Stock</span>
                  <span className="org-list-th">Rating</span>
                  <span />
                </div>
                <div className="prod-list-block">
                  {g.items.map(p => (
                    <ProdListRow key={p.id} p={p}
                      bulkMode={bulkMode}
                      selected={selectedIds.has(p.id)}
                      onToggleSelect={() => toggleSelect(p.id)}
                      onContextMenu={(pos) => setCtxMenu({ pos, product: p })}
                      onOpen={() => goToProduct(p.id)}
                      onDelete={() => deleteProduct(p.id)}
                      onDuplicate={() => duplicate(p.id)}
                      onPrintBarcode={
                      (p.product_type || 'physical') === 'physical'
                        ? () => setPrintTarget({ mode: 'product', qrMode: false, productIds: [p.id] })
                        : null
                    }
                      onArchive={() => archive(p.id)}
                      onUnarchive={() => unarchive(p.id)}
                      onPause={() => pause(p.id)}
                      onResume={() => resume(p.id)} />
                  ))}
                </div>
              </div>
            )}
          </section>
        ))}

        {/* Infinite-scroll sentinel — IntersectionObserver triggers loadMore() ~200px before user reaches it. */}
        {hasMore && !loading && (
          <div ref={sentinelRef} className="inf-sentinel">Loading more…</div>
        )}
        {loading && products.length > 0 && (
          <div className="inf-sentinel">Loading more…</div>
        )}
      </div>

      {/* Right-click context menu */}
      {ctxMenu && (
        <RowContextMenu
          pos={ctxMenu.pos}
          items={buildCtxItems(ctxMenu.product)}
          onClose={() => setCtxMenu(null)} />
      )}

      {/* Bulk toolbar */}
      {bulkMode && (
        <BulkToolbar
          count={selectedIds.size}
          categories={categories}
          onCreateCategory={createCategory}
          onCancel={exitBulkMode}
          onDelete={() => bulkAction('delete')}
          onArchive={() => bulkAction('archive')}
          onPause={() => bulkAction('pause')}
          onResume={() => bulkAction('resume')}
          onCategory={(category_id) => bulkAction('set_category', { category_id })}
          onPriceDelta={(pct) => bulkAction('price_delta_pct', { price_delta_pct: pct })}
          onPrintBarcodes={() => setPrintTarget({ mode: 'product', productIds: Array.from(selectedIds) })}
        />
      )}

      {/* Create-product modal — replaces the old right-side drawer */}
      <CreateProductModal
        open={showCreate}
        pq={pq}
        onClose={() => setShowCreate(false)}
        onCreated={newProduct => {
          setShowCreate(false);
          load();
          goToProduct(newProduct.id);
        }}
      />

      {/* Print barcodes modal */}
      {printTarget && (
        <PrintBarcodesModal
          open={!!printTarget}
          pq={pq}
          productIds={printTarget.productIds}
          mode={printTarget.mode || 'product'}
          qrMode={!!printTarget.qrMode}
          onClose={() => setPrintTarget(null)}
        />
      )}

      {/* Import CSV modal */}
      {showImport && (
        <ImportCsvModal
          pq={pq}
          onClose={() => setShowImport(false)}
          onDone={() => { setShowImport(false); load(); }}
        />
      )}

      {/* Success toast (createPortal bottom-center pill, 3.2s auto-dismiss) */}
      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
    </div>
  );
}

// ── ImportExportToggle ──────────────────────────────────────────
// Two-button pill (Import / Export) on one plate with Dynamic Block hover indicator. Same shape as view-toggle (Grid/List).

function ImportExportToggle({ onImport, onExport }) {
  const indRef  = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el  = hovered ? btnRefs.current[hovered] : null;
      if (!ind) return;
      if (!el) { ind.style.opacity = '0'; return; }
      ind.style.opacity   = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width     = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [hovered]);

  const Btn = ({ k, icon, label, onClick }) => (
    <button ref={el => { if (el) btnRefs.current[k] = el; else delete btnRefs.current[k]; }}
      className={`prod-ie-btn${hovered === k ? ' prod-ie-btn--hov' : ''}`}
      onMouseEnter={() => setHovered(k)}
      onClick={onClick}
      type="button">
      {icon}<span>{label}</span>
    </button>
  );

  return (
    <div className="prod-ie-toggle" onMouseLeave={() => setHovered(null)}>
      <div ref={indRef} className="prod-ie-indicator" />
      <Btn k="import" icon={<UploadSimple   className="prod-ie-icon" />} label="Import" onClick={onImport} />
      <Btn k="export" icon={<DownloadSimple className="prod-ie-icon" />} label="Export" onClick={onExport} />
    </div>
  );
}

// ── StatusChips ─────────────────────────────────────────────────
// Inline filter chips reusing the org-sort-toggle look (Dynamic Block indicator).

function StatusChips({ value, onChange }) {
  const indRef  = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);
  const curKey = hovered ?? value;

  const OPTIONS = [
    { key: 'all',    label: 'All'    },
    { key: 'active', label: 'Active' },
    { key: 'paused', label: 'Paused' },
  ];

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el  = btnRefs.current[curKey];
      if (!ind || !el) return;
      ind.style.opacity   = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width     = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [curKey, value]);

  return (
    <div className="org-sort-toggle" onMouseLeave={() => setHovered(null)}>
      <div ref={indRef} className="org-sort-indicator" />
      {OPTIONS.map(({ key, label }) => (
        <button key={key} ref={el => { btnRefs.current[key] = el; }}
          className={`org-sort-btn${curKey === key ? ' org-sort-btn--current' : ''}`}
          onMouseEnter={() => setHovered(key)}
          onClick={() => onChange(key)} type="button">
          {label}
        </button>
      ))}
    </div>
  );
}

// ── BulkToolbar ────────────────────────────────────────────────
// Floating white pill bottom-center — mirrors auth-tab-switcher pattern (Products/Bookings/Chat tabs). Dynamic Block indicator follows hovered action.

function BulkToolbar({ count, categories, onCreateCategory, onCancel, onDelete, onArchive, onPause, onResume,
                      onCategory, onPriceDelta, onPrintBarcodes }) {
  // One activeAction state — opening any popover closes the previous one. null = none open.
  const [activeAction, setActiveAction] = useState(null);
  const [pricePct, setPricePct] = useState('');
  const [hovered,  setHovered]  = useState(null);

  const wrapRef = useRef(null);
  const indRef  = useRef(null);
  const btnRefs = useRef({});

  // Dynamic Block indicator — uses bounding rects so positioned-popover wrappers don't break offsetLeft.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind  = indRef.current;
      const wrap = wrapRef.current;
      const el   = hovered ? btnRefs.current[hovered] : null;
      if (!ind) return;
      if (!el || !wrap) { ind.style.opacity = '0'; return; }
      const wr = wrap.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      ind.style.opacity   = '1';
      ind.style.transform = `translateX(${er.left - wr.left}px)`;
      ind.style.width     = `${er.width}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [hovered]);

  // Click outside the bulk pill — close any open popover.
  useEffect(() => {
    if (!activeAction) return;
    const onDown = (e) => {
      if (!e.target.closest?.('.bulk-pill')) setActiveAction(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [activeAction]);

  // Reset popover-internal state every time it closes so it opens fresh.
  useEffect(() => {
    if (activeAction !== 'price') setPricePct('');
  }, [activeAction]);

  const setBtnRef = (key) => (el) => {
    if (el) btnRefs.current[key] = el; else delete btnRefs.current[key];
  };

  // Toggle popover — clicking the same action again closes it; clicking another swaps.
  const togglePopover = (key) => setActiveAction(prev => prev === key ? null : key);

  const Btn = ({ k, icon, label, onClick, danger }) => (
    <button ref={setBtnRef(k)}
      className={`bulk-pill-btn${danger ? ' bulk-pill-btn--danger' : ''}${hovered === k ? ' bulk-pill-btn--hov' : ''}${activeAction === k ? ' bulk-pill-btn--active' : ''}`}
      onMouseEnter={() => setHovered(k)}
      onClick={onClick}
      type="button">
      {icon}
      <span>{label}</span>
    </button>
  );

  const isDangerHover = hovered === 'delete';

  return createPortal(
    <div className="bulk-pill-wrap">
      <div ref={wrapRef} className="bulk-pill" onMouseLeave={() => setHovered(null)}>
        <div ref={indRef}
          className={`bulk-pill-indicator${isDangerHover ? ' bulk-pill-indicator--danger' : ''}`} />

        <span className="bulk-pill-count">{count} selected</span>

        <div className="bulk-pill-action-wrap">
          <Btn k="cat" icon={<FolderSimple weight="bold" />} label="Set category"
            onClick={() => togglePopover('cat')} />
          {activeAction === 'cat' && (
            <CategoryPopover
              categories={categories}
              onPick={(id) => { onCategory(id); setActiveAction(null); }}
              onCreate={onCreateCategory} />
          )}
        </div>

        <div className="bulk-pill-action-wrap">
          <Btn k="price" icon={<ArrowDown weight="bold" />} label="Price ±%"
            onClick={() => togglePopover('price')} />
          {activeAction === 'price' && (
            <form className="bulk-pill-popover bulk-pill-popover--input"
              onSubmit={(e) => { e.preventDefault();
                const n = parseFloat(pricePct);
                if (!isFinite(n) || n <= -100 || n >= 1000) return;
                onPriceDelta(n); setActiveAction(null);
              }}>
              <input type="number" step="0.1" placeholder="e.g. -10 = 10% off"
                value={pricePct} onChange={e => setPricePct(e.target.value)} autoFocus />
              <button type="submit" className="bulk-pill-pop-go">Apply</button>
            </form>
          )}
        </div>

        <Btn k="pause"   icon={<Pause   weight="bold" />} label="Pause"   onClick={() => { setActiveAction(null); onPause(); }} />
        <Btn k="resume"  icon={<Play    weight="bold" />} label="Resume"  onClick={() => { setActiveAction(null); onResume(); }} />
        <Btn k="archive" icon={<Archive weight="bold" />} label="Archive" onClick={() => { setActiveAction(null); onArchive(); }} />
        <Btn k="print"   icon={<Barcode weight="bold" />} label="Print barcodes" onClick={() => { setActiveAction(null); onPrintBarcodes(); }} />
        <Btn k="delete"  icon={<Trash   weight="bold" />} label="Delete"  onClick={() => { setActiveAction(null); onDelete(); }} danger />

        <span className="bulk-pill-sep" />
        <Btn k="cancel"  icon={<X weight="bold" />} label="Cancel" onClick={onCancel} />
      </div>
    </div>,
    document.body
  );
}

// ── CategoryPopover ─────────────────────────────────────
// Combobox-style: list of categories with Dynamic Block, inline + New category form at the bottom (no separate drawer). Picking auto-applies to the bulk selection — no extra "Save".

function CategoryPopover({ categories, onPick, onCreate }) {
  const [hovered, setHovered] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  // Track which key is currently hovered for the sliding indicator (Dynamic Block pattern).
  const indRef  = useRef(null);
  const itemEls = useRef({});

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el  = hovered ? itemEls.current[hovered] : null;
      if (!ind) return;
      if (!el) { ind.style.opacity = '0'; return; }
      ind.style.opacity   = '1';
      ind.style.transform = `translateY(${el.offsetTop}px)`;
      ind.style.height    = `${el.offsetHeight}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [hovered, categories.length, creating]);

  const submitNew = async (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    const created = await onCreate?.(name);
    setBusy(false);
    if (created?.id) {
      setNewName(''); setCreating(false);
      onPick(created.id);
    }
  };

  return (
    <div className="bulk-cat-popover"
      onMouseLeave={() => setHovered(null)}
      onPointerDown={(e) => e.stopPropagation()}>
      <div className="bulk-cat-list">
        <div ref={indRef} className="bulk-cat-indicator" />

        <button type="button"
          ref={el => { if (el) itemEls.current['clear'] = el; }}
          className={`bulk-cat-item${hovered === 'clear' ? ' bulk-cat-item--current' : ''}`}
          onMouseEnter={() => setHovered('clear')}
          onClick={() => onPick(null)}>
          Clear category
        </button>
        {categories.map(c => {
          const k = `c:${c.id}`;
          return (
            <button key={c.id} type="button"
              ref={el => { if (el) itemEls.current[k] = el; }}
              className={`bulk-cat-item${hovered === k ? ' bulk-cat-item--current' : ''}`}
              onMouseEnter={() => setHovered(k)}
              onClick={() => onPick(c.id)}>
              {c.name}
            </button>
          );
        })}
      </div>

      <div className="bulk-cat-divider" />

      {creating ? (
        <form className="bulk-cat-create-form" onSubmit={submitNew}>
          <input className="bulk-cat-create-input" autoFocus value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Category name…" maxLength={100}
            onKeyDown={(e) => { if (e.key === 'Escape') { setCreating(false); setNewName(''); } }} />
          <button type="submit" className="bulk-pill-pop-go" disabled={busy || !newName.trim()}>
            {busy ? '…' : 'Create'}
          </button>
        </form>
      ) : (
        <button type="button"
          className="bulk-cat-item bulk-cat-item--new"
          onClick={() => setCreating(true)}>
          <Plus weight="bold" className="bulk-cat-new-icon" /> New category
        </button>
      )}
    </div>
  );
}
