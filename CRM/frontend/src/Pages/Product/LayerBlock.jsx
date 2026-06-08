import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus, Trash, Image as ImageIcon, DotsThreeOutline, PencilSimple, X, DotsSixVertical, CheckCircle, Barcode,
} from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { InteractiveSection } from '../../Utils/InteractiveSection.js';
import { useUndoableSave } from '../../Utils/useUndoableSave.js';
import { RowContextMenu } from '../../Utils/RowContextMenu.jsx';
import MediaThumb from '../../Utils/MediaThumb.jsx';
import VariationGalleryPopover from './VariationGallery.jsx';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, rectSortingStrategy, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const LAYER1_TILT = {
  maxAngle: 12, lerp: 0.05, lerpOut: 0.07,
  scale: 1.04, perspective: 750,
  gloss: { opacity: 0.14, spread: 60 },
};

function sumDeep(items, field) {
  let total = 0;
  for (const it of (items || [])) {
    total += Number(it[field]) || 0;
    if (it.children) total += sumDeep(it.children, field);
  }
  return total;
}

// Weight is a per-SKU (leaf) attribute. Collect weight_g of every sellable leaf
// under a node (leaf = no children); parents render the min–max range.
function collectLeafWeights(node) {
  const kids = node.configurations || node.children || [];
  if (!kids.length) {
    const w = node.weight_g;
    return (w != null && !isNaN(Number(w))) ? [Number(w)] : [];
  }
  return kids.flatMap(collectLeafWeights);
}
function weightRangeLabel(node) {
  const ws = collectLeafWeights(node);
  if (!ws.length) return '—';
  const lo = Math.min(...ws), hi = Math.max(...ws);
  return lo === hi ? `${lo} g` : `${lo}–${hi} g`;
}

// Snapshot helpers for Undo — recursive plain-object tree consumed by /restore.
function snapshotSpec(s) {
  return { spec_key: s.spec_key, spec_value: s.spec_value, position: s.position };
}
function snapshotLayerNode(item) {
  return {
    name: item.name || '',
    price: item.price ?? null,
    stock_quantity: item.stock_quantity || 0,
    sold_quantity: item.sold_quantity || 0,
    specifications: (item.specifications || []).map(snapshotSpec),
    children: (item.children || []).map(snapshotLayerNode),
  };
}
export function snapshotVariation(v) {
  return {
    name: v.variation_name || '',
    images: Array.isArray(v.images) ? [...v.images] : [],
    price: v.price ?? null,
    stock_quantity: v.stock_quantity || 0,
    sold_quantity: v.sold_quantity || 0,
    specifications: (v.specifications || []).map(snapshotSpec),
    children: (v.configurations || []).map(snapshotLayerNode),
  };
}
export { snapshotLayerNode };

export default function LayerBlock(props) {
  if (props.layer === 1) return <Layer1Grid {...props} />;
  return <LayerTable {...props} />;
}

// ─── Layer 1: card grid (3 cols, image + inline editable price/stock/sold) ──

function Layer1Grid({ items, productId, pq, reloadProduct, selectedId, onSelect, registerUndo,
                       bulk, setBulk, clearBulk, productType, onPrintBarcode,
                       hidePrice = false, marginPct = 50 }) {
  const { t } = useTranslation();
  const [editVar, setEditVar] = useState(null);
  // Press-and-hold (300ms) drag activation lets users grab from anywhere including over inputs.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { delay: 300, tolerance: 5 } }));

  const SCOPE = 'layer1';
  const inScope = bulk?.scope === SCOPE;
  const bulkIds = inScope ? bulk.ids : [];
  const [ctxMenu, setCtxMenu] = useState(null);

  const bulkDelete = useCallback(async (deleteIds) => {
    if (!deleteIds.length) return;
    const targets = items.filter(v => deleteIds.includes(v.id));
    const snapshots = targets.map(snapshotVariation);
    for (const id of deleteIds) {
      await fetch(`${API_BASE}/api/products/${productId}/layers/1/${id}${pq}`, {
        method: 'DELETE', credentials: 'include',
      });
    }
    if (deleteIds.includes(selectedId)) onSelect?.(null);
    clearBulk?.();
    await reloadProduct?.();
    if (snapshots.length && registerUndo) {
      registerUndo({
        description: t('productDetail.layer.variationsDeleted', { count: deleteIds.length }),
        undo: async () => {
          for (const snap of snapshots) {
            await fetch(`${API_BASE}/api/products/${productId}/restore${pq}`, {
              method: 'POST', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'variation', data: snap }),
            });
          }
          await reloadProduct?.();
        },
      });
    }
  }, [items, productId, pq, selectedId, onSelect, clearBulk, reloadProduct, registerUndo, t]);

  // Toggle a card in/out of bulk scope (used by ctx-menu Select + modifier-click).
  const toggleInBulk = useCallback((id) => {
    setBulk(prev => {
      const list = prev.scope === SCOPE ? [...prev.ids] : [];
      const idx = list.indexOf(id);
      if (idx >= 0) list.splice(idx, 1);
      else list.push(id);
      return list.length ? {
        scope: SCOPE, ids: list,
        actions: { delete: () => bulkDelete(list) },
      } : { scope: null, ids: [], actions: null };
    });
  }, [setBulk, bulkDelete]);

  const onCardClick = useCallback((e, id, fallback) => {
    // While in bulk-mode every plain click toggles too (Figma/Notion-style).
    if (e.shiftKey || e.metaKey || e.ctrlKey || inScope) {
      e.stopPropagation();
      e.preventDefault();
      toggleInBulk(id);
      return;
    }
    fallback?.();
  }, [inScope, toggleInBulk]);

  const openCtxMenu = useCallback((e, id) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, id });
  }, []);

  const addItem = async () => {
    const res = await fetch(`${API_BASE}/api/products/${productId}/layers/1${pq}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: [] }),
    });
    if (!res.ok) return;
    const created = await res.json();
    await reloadProduct();
    onSelect?.(created.id);
  };

  const deleteItem = async (id) => {
    const target = items.find(v => v.id === id);
    if (!confirm(t('productDetail.layer.deleteVariationConfirm'))) return;
    const snapshot = target ? snapshotVariation(target) : null;
    const res = await fetch(`${API_BASE}/api/products/${productId}/layers/1/${id}${pq}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (!res.ok) return;
    if (selectedId === id) onSelect?.(null);
    await reloadProduct();
    if (snapshot && registerUndo) {
      registerUndo({
        description: t('productDetail.layer.variationDeleted', { name: snapshot.name || t('productDetail.layer.untitled') }),
        undo: async () => {
          const r = await fetch(`${API_BASE}/api/products/${productId}/restore${pq}`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'variation', data: snapshot }),
          });
          if (!r.ok) return;
          const out = await r.json().catch(() => ({}));
          await reloadProduct?.();
          if (out?.id) onSelect?.(out.id);
        },
      });
    }
  };

  const persistOrder = async (newOrder) => {
    await fetch(`${API_BASE}/api/products/${productId}/variations/reorder${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variation_ids: newOrder }),
    });
  };

  const onDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldOrder = items.map(v => v.id);
    const oldIdx = oldOrder.indexOf(active.id);
    const newIdx = oldOrder.indexOf(over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const newOrder = arrayMove(oldOrder, oldIdx, newIdx);
    await persistOrder(newOrder);
    await reloadProduct();
    registerUndo?.({
      description: t('productDetail.layer.variationsReordered'),
      undo: async () => { await persistOrder(oldOrder); await reloadProduct(); },
    });
  };

  const itemIds = useMemo(() => items.map(v => v.id), [items]);

  return (
    <section className="po-block">
      <div className="po-block-head">
        <h2 className="po-block-title">{t('productDetail.layer.configurationLayer', { n: 1 })}</h2>
        <button className="po-add-pill" onClick={addItem} type="button">
          <Plus weight="bold" /> {t('productDetail.layer.addVariation')}
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={itemIds} strategy={rectSortingStrategy}>
          <div className="prod-grid prod-grid--3">
            {items.length === 0 && (
              <div className="po-empty">{t('productDetail.layer.noVariations')} <b>{t('productDetail.layer.addVariationBold')}</b>.</div>
            )}
            {items.map(v => (
              <SortableLayer1Card key={v.id} v={v}
                productId={productId} pq={pq}
                reloadProduct={reloadProduct}
                selected={v.id === selectedId}
                onCardClick={(e) => onCardClick(e, v.id, () => onSelect?.(v.id))}
                onContextMenu={(e) => openCtxMenu(e, v.id)}
                onEdit={() => setEditVar(v)}
                onDelete={() => deleteItem(v.id)}
                registerUndo={registerUndo}
                bulkSelected={bulkIds.includes(v.id)}
                bulkActive={inScope}
                onBulkToggle={() => toggleInBulk(v.id)}
                hidePrice={hidePrice}
                marginPct={marginPct} />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {editVar && (
        <Layer1EditModal
          productId={productId}
          variation={editVar}
          pq={pq}
          onClose={() => setEditVar(null)}
          onSaved={() => { setEditVar(null); reloadProduct(); }} />
      )}

      {ctxMenu && (() => {
        const target = items.find(v => v.id === ctxMenu.id);
        const menuItems = [
          { label: t('productDetail.layer.card.edit'),         icon: <PencilSimple className="org-card-dropdown-icon" />,
            onClick: () => setEditVar(target) },
          { label: t('productDetail.layer.card.printBarcode'), icon: <Barcode      className="org-card-dropdown-icon" />,
            onClick: () => onPrintBarcode?.({ variationId: ctxMenu.id }) },
          { label: t('productDetail.layer.card.select'),       icon: <CheckCircle  className="org-card-dropdown-icon" />,
            onClick: () => toggleInBulk(ctxMenu.id) },
          { label: t('productDetail.layer.card.delete'),       icon: <Trash        className="org-card-dropdown-icon" />,
            onClick: () => deleteItem(ctxMenu.id), danger: true },
        ];
        return (
          <RowContextMenu pos={ctxMenu}
            items={menuItems}
            onClose={() => setCtxMenu(null)} />
        );
      })()}
    </section>
  );
}

// Sortable wrapper: drag listeners on the outer wrap (whole tile grabbable after 300ms hold).
function SortableLayer1Card(props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.v.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 5 : 'auto',
    opacity: isDragging ? 0.85 : 1,
  };
  return (
    <Layer1Card
      {...props}
      dragRef={setNodeRef}
      dragStyle={style}
      dragHandleProps={{ ...attributes, ...listeners }}
      isDragging={isDragging}
    />
  );
}

function Layer1Card({ v, productId, pq, reloadProduct, registerUndo, selected, onSelect, onCardClick,
                       onEdit, onDelete, onContextMenu, dragRef, dragStyle, dragHandleProps, isDragging,
                       bulkSelected, bulkActive, onBulkToggle,
                       hidePrice = false, marginPct = 50 }) {
  const { t } = useTranslation();
  const menuBtnRef = useRef(null);
  const imgWrapRef = useRef(null);
  const [menuOpen,    setMenuOpen]    = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [name,  setName]  = useState(v.variation_name || '');
  const [price, setPrice] = useState(v.price != null ? String(v.price) : '');
  const [cost,  setCost]  = useState(v.cost_price != null ? String(v.cost_price) : '');
  const [weight, setWeight] = useState(v.weight_g != null ? String(v.weight_g) : '');
  // Disable tilt while dragging or while gallery popover is open so cursor moves don't fight the popup.
  const { ref, glossRef, handlers } = InteractiveSection(LAYER1_TILT, menuOpen || galleryOpen || isDragging);

  const images = Array.isArray(v.images) ? v.images : [];
  const cover  = images[0] || null;

  const hasChildren = (v.configurations || []).length > 0;
  const totalStock  = hasChildren ? sumDeep(v.configurations, 'stock_quantity') : (v.stock_quantity || 0);
  const totalSold   = hasChildren ? sumDeep(v.configurations, 'sold_quantity')  : (v.sold_quantity  || 0);

  useEffect(() => {
    if (!menuOpen) return;
    const h = e => {
      if (!e.target.closest?.('.org-card-dropdown') && !menuBtnRef.current?.contains(e.target))
        setMenuOpen(false);
    };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [menuOpen]);

  const save = useCallback(async (body) => {
    const r = await fetch(`${API_BASE}/api/products/${productId}/layers/1/${v.id}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) reloadProduct?.();
    return r.ok;
  }, [productId, v.id, pq, reloadProduct]);

  useUndoableSave({
    value: name, setValue: setName,
    serverValue: v.variation_name || '',
    save: (val) => save({ name: (val || '').trim() }),
    registerUndo, label: t('productDetail.layer.undo.variationName', { name: v.variation_name || t('productDetail.layer.undo.fallbackVariation') }),
    shouldSave: (val) => !!(val || '').trim(),
  });
  useUndoableSave({
    value: price, setValue: setPrice,
    serverValue: v.price != null ? String(v.price) : '',
    save: (val) => save({ price: val === '' ? null : parseFloat(val) }),
    registerUndo, label: t('productDetail.layer.undo.variationPrice', { name: v.variation_name || t('productDetail.layer.undo.fallbackVariation') }),
  });
  // Cost — same auto-derive behaviour as L2 rows. When hidePrice is on, setting cost auto-fills price.
  useUndoableSave({
    value: cost, setValue: setCost,
    serverValue: v.cost_price != null ? String(v.cost_price) : '',
    save: (val) => {
      const body = { cost_price: val === '' ? null : parseFloat(val) };
      if (hidePrice && val !== '' && isFinite(parseFloat(val))) {
        const c = parseFloat(val);
        const p = Math.round(c * (1 + (marginPct || 0) / 100) * 100) / 100;
        body.price = p;
        setPrice(String(p));
      }
      return save(body);
    },
    registerUndo, label: t('productDetail.layer.undo.variationCost', { name: v.variation_name || t('productDetail.layer.undo.fallbackVariation') }),
  });
  // Weight (g) — only meaningful on a leaf variation (no nested configurations).
  useUndoableSave({
    value: weight, setValue: setWeight,
    serverValue: v.weight_g != null ? String(v.weight_g) : '',
    save: (val) => save({ weight_g: val === '' ? null : parseFloat(val) }),
    registerUndo, label: t('productDetail.layer.undo.variationWeight', { name: v.variation_name || t('productDetail.layer.undo.fallbackVariation') }),
  });

  // Multi-photo gallery is managed in <VariationGalleryPopover/> — drop targets,
  // multi-upload, drag-drop reorder, delete all live there. Card just opens it.


  return (
    <div ref={dragRef} style={dragStyle} className={`layer1-drag-wrap${isDragging ? ' layer1-drag-wrap--dragging' : ''}`}
      {...(dragHandleProps || {})}>
    <div ref={ref}
      className={`org-card org-card--tilt prod-card layer1-card${selected ? ' prod-card--selected' : ''}${isDragging ? ' layer1-card--dragging' : ''}${bulkSelected ? ' layer1-card--bulk' : ''}${bulkActive ? ' layer1-card--bulk-mode' : ''}`}
      onClick={onCardClick || onSelect}
      onContextMenu={onContextMenu}
      title={t('productDetail.layer.card.clickToSelect')}
      {...handlers}>
      {bulkActive && (
        <input type="checkbox" className="cat-prod-checkbox layer1-bulk-check"
          checked={!!bulkSelected}
          onChange={() => onBulkToggle?.()}
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          aria-label={t('productDetail.layer.card.toggleSelection')} />
      )}
      <div ref={glossRef} className="org-card-gloss prod-card-gloss" />
      <div className="layer1-inner">
        {/* pimg-hover enables the scale-on-hover effect (same as ProductCard
            on the catalog page). No dark overlay — clean lift only. */}
        <div ref={imgWrapRef}
          className={`layer1-img-wrap pimg-hover${galleryOpen ? ' layer1-img-wrap--open' : ''}`}
          onClick={e => { e.stopPropagation(); setGalleryOpen(true); }}>
          {cover ? (
            <MediaThumb className="layer1-img" url={cover} alt={v.variation_name} live3d />
          ) : (
            <div className="layer1-img-empty">
              <ImageIcon weight="duotone" className="layer1-img-empty-icon" />
            </div>
          )}
          {/* Photo count badge — visible only when there's >1 image so single-photo
              variations don't get a redundant "1" overlay. */}
          {images.length > 1 && (
            <span className="layer1-img-count">{images.length}</span>
          )}
        </div>
        {galleryOpen && (
          <VariationGalleryPopover
            anchorRef={imgWrapRef}
            productId={productId}
            variationId={v.id}
            pq={pq}
            initialImages={images}
            onChange={() => reloadProduct?.()}
            onClose={() => setGalleryOpen(false)} />
        )}
        <div className="layer1-body">
          <input className={`layer1-name-input${!name.trim() ? ' layer1-name-input--invalid' : ''}`}
            value={name}
            onChange={e => setName(e.target.value)}
            onClick={e => e.stopPropagation()}
            placeholder={t('productDetail.layer.card.variationNamePlaceholder')}
            title={!name.trim() ? t('productDetail.layer.card.variationNameRequired') : undefined}
            maxLength={100} />
          {!hidePrice && (
            <div className="layer1-meta-row">
              <span className="layer1-meta-label">{t('productDetail.layer.card.price')}</span>
              <input className="layer1-meta-input"
                type="number" min="0" step="0.01"
                value={price}
                onChange={e => setPrice(e.target.value)}
                onClick={e => e.stopPropagation()}
                placeholder="0.00" />
            </div>
          )}
          <div className="layer1-meta-row">
            <span className="layer1-meta-label">{t('productDetail.layer.card.cost')}</span>
            <input className="layer1-meta-input"
              type="number" min="0" step="0.01"
              value={cost}
              onChange={e => setCost(e.target.value)}
              onClick={e => e.stopPropagation()}
              placeholder="0.00"
              title={hidePrice ? t('productDetail.layer.priceAutoTitle', { factor: (1 + marginPct/100).toFixed(2) }) : t('productDetail.layer.card.costTitleHint')} />
          </div>
          {/* Weight: input on a leaf variation; min–max range when it has nested configs (the SKU lives deeper). */}
          {hasChildren ? (
            <div className="layer1-meta-row">
              <span className="layer1-meta-label">{t('productDetail.layer.card.weight')}</span>
              <span className="layer1-meta-range">{weightRangeLabel(v)}</span>
            </div>
          ) : (
            <div className="layer1-meta-row">
              <span className="layer1-meta-label">{t('productDetail.layer.card.weightG')}</span>
              <input className="layer1-meta-input"
                type="number" min="0" step="0.01"
                value={weight}
                onChange={e => setWeight(e.target.value)}
                onClick={e => e.stopPropagation()}
                placeholder="0"
                title={t('productDetail.layer.weightTitle')} />
            </div>
          )}
        </div>
      </div>
      <button ref={menuBtnRef} className="org-card-menu-btn pcard-menu-btn" type="button"
        onClick={e => { e.stopPropagation(); setMenuOpen(o => !o); }}>
        <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
      </button>
      {menuOpen && (
        <CardMenu btnRef={menuBtnRef}
          onEdit={() => { setMenuOpen(false); onEdit?.(); }}
          onDelete={() => { setMenuOpen(false); onDelete?.(); }}
          onClose={() => setMenuOpen(false)} />
      )}
    </div>
    </div>
  );
}

function CardMenu({ btnRef, onEdit, onDelete, onClose }) {
  const { t } = useTranslation();
  const [pos, setPos] = useState(null);
  const [hovered, setHovered] = useState(null);
  const indRef  = useRef(null);
  const itemEls = useRef({});

  useEffect(() => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: Math.max(8, r.right - 160) });
    }
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
  const items = [
    { key: 'edit',   label: t('productDetail.layer.card.edit'),   icon: <PencilSimple className="org-card-dropdown-icon" />, onClick: onEdit },
    { key: 'delete', label: t('productDetail.layer.card.delete'), icon: <Trash       className="org-card-dropdown-icon" />, onClick: onDelete, danger: true },
  ];
  return createPortal(
    <div className="org-card-dropdown" style={{ top: pos.top, left: pos.left }}
      onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <div className="org-menu-block" onMouseLeave={() => setHovered(null)}>
        <div ref={indRef}
          className={`org-menu-indicator${hovered && items.find(x => x.key === hovered)?.danger ? ' org-menu-indicator--danger' : ''}`} />
        {items.map(it => (
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

function Layer1EditModal({ productId, variation, pq, onClose, onSaved }) {
  // Photo management lives in <VariationGalleryPopover/> now (click on the card
  // image). This modal stays as a quick "rename variation" — image upload removed
  // to avoid two ways of editing the same field.
  const { t } = useTranslation();
  const [name, setName] = useState(variation.variation_name || '');
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e) => {
    e?.preventDefault();
    const trimmed = name.trim();
    setBusy(true); setErr('');
    const res = await fetch(`${API_BASE}/api/products/${productId}/layers/1/${variation.id}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    });
    setBusy(false);
    if (!res.ok) { setErr(t('productDetail.layer.renameModal.saveFailed')); return; }
    onSaved?.();
  };

  return createPortal(
    <div className="auth-modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="auth-modal cfg-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">{t('productDetail.layer.renameModal.title')}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">{t('productDetail.layer.renameModal.subtitle')}</span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body cfg-modal-body">
          <form onSubmit={submit}>
            <label className="po-field-label">{t('productDetail.layer.renameModal.nameLabel')}</label>
            <input className="crm-input" autoFocus value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('productDetail.layer.renameModal.namePlaceholder')} maxLength={100} />
            {err && <span className="crm-form-error">{err}</span>}
            <div className="auth-actions var-edit-actions">
              <button className="crm-submit-btn" type="submit" disabled={busy}>
                {busy ? t('productDetail.layer.renameModal.saving') : t('productDetail.layer.renameModal.save')}
              </button>
              <button className="crm-submit-btn auth-btn-secondary" type="button" onClick={onClose}>
                {t('productDetail.layer.renameModal.cancel')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Layer 2-5: table view (Name | Price | Stock | Sold | Delete) ────────

function LayerTable({ layer, items, parentId, parentName, productId, pq, reloadProduct,
                      selectedId, onSelect, isLeaf, inheritedPrice, onDeleteLayer, registerUndo,
                      bulk, setBulk, clearBulk, onPrintBarcode,
                      hidePrice = false, marginPct = 50 }) {
  const { t } = useTranslation();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { delay: 300, tolerance: 5 } }));

  const SCOPE = `layer-${layer}`;
  const inScope = bulk?.scope === SCOPE;
  const bulkIds = inScope ? bulk.ids : [];
  const [ctxMenu, setCtxMenu] = useState(null);

  const bulkDelete = useCallback(async (deleteIds) => {
    if (!deleteIds.length) return;
    const targets = items.filter(it => deleteIds.includes(it.id));
    const snapshots = targets.map(snapshotLayerNode);
    for (const id of deleteIds) {
      await fetch(`${API_BASE}/api/products/${productId}/layers/${layer}/${id}${pq}`, {
        method: 'DELETE', credentials: 'include',
      });
    }
    if (deleteIds.includes(selectedId)) onSelect?.(null);
    clearBulk?.();
    await reloadProduct?.();
    if (snapshots.length && registerUndo) {
      registerUndo({
        description: t('productDetail.layer.rowsDeleted', { count: deleteIds.length, layer }),
        undo: async () => {
          for (const snap of snapshots) {
            await fetch(`${API_BASE}/api/products/${productId}/restore${pq}`, {
              method: 'POST', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'layer_node', layer, parent_id: parentId, data: snap }),
            });
          }
          await reloadProduct?.();
        },
      });
    }
  }, [items, layer, parentId, productId, pq, selectedId, onSelect, clearBulk, reloadProduct, registerUndo]);

  const toggleInBulk = useCallback((id) => {
    setBulk(prev => {
      const list = prev.scope === SCOPE ? [...prev.ids] : [];
      const idx = list.indexOf(id);
      if (idx >= 0) list.splice(idx, 1);
      else list.push(id);
      return list.length ? {
        scope: SCOPE, ids: list,
        actions: { delete: () => bulkDelete(list) },
      } : { scope: null, ids: [], actions: null };
    });
  }, [SCOPE, setBulk, bulkDelete]);

  // Returns true → caller skips drill (modifier-click or bulk-mode active).
  const onRowClick = useCallback((e, id) => {
    if (!(e.shiftKey || e.metaKey || e.ctrlKey || inScope)) return false;
    e.stopPropagation();
    e.preventDefault();
    toggleInBulk(id);
    return true;
  }, [inScope, toggleInBulk]);

  const openCtxMenu = useCallback((e, id) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, id });
  }, []);

  const copyToSiblings = async () => {
    if (!confirm(t('productDetail.layer.copyToSiblingsConfirm'))) return;
    const res = await fetch(
      `${API_BASE}/api/products/${productId}/layers/${layer - 1}/${parentId}/copy-to-siblings${pq}`,
      { method: 'POST', credentials: 'include' }
    );
    if (res.ok) reloadProduct?.();
  };

  const persistOrder = async (ids) => {
    await fetch(`${API_BASE}/api/products/${productId}/layers/${layer}/reorder${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, parent_id: parentId }),
    });
  };

  const onDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldOrder = items.map(i => i.id);
    const oldIdx = oldOrder.indexOf(active.id);
    const newIdx = oldOrder.indexOf(over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const newOrder = arrayMove(oldOrder, oldIdx, newIdx);
    await persistOrder(newOrder);
    await reloadProduct?.();
    registerUndo?.({
      description: t('productDetail.layer.layerReordered', { layer }),
      undo: async () => { await persistOrder(oldOrder); await reloadProduct?.(); },
    });
  };

  const itemIds = useMemo(() => items.map(i => i.id), [items]);

  return (
    <section className="po-block">
      <div className="po-block-head">
        <h2 className="po-block-title">
          {t('productDetail.layer.configurationLayer', { n: layer })}
          {parentName && <span className="po-block-title-context"> | {parentName}</span>}
        </h2>
        {onDeleteLayer && (
          <button className="po-layer-delete-btn" onClick={onDeleteLayer} type="button" title={t('productDetail.layer.deleteThisLayer')}>
            <Trash weight="bold" /> {t('productDetail.layer.deleteLayer')}
          </button>
        )}
      </div>
      <div className="cfg-block-body">
        <div className="cfg-list">
          <div className={`cfg-list-head cfg-list-head--wt${inScope ? ' cfg-list-head--bulk-mode' : ''}${hidePrice ? ' cfg-list-head--hide-price' : ''}`}>
            {inScope && <span className="cfg-col cfg-col-bulk" />}
            <span className="cfg-col cfg-col-name">{t('productDetail.layer.colName')}</span>
            {!hidePrice && <span className="cfg-col cfg-col-price">{t('productDetail.layer.colPrice')}</span>}
            <span className="cfg-col cfg-col-cost">{t('productDetail.layer.colCost')}</span>
            <span className="cfg-col cfg-col-weight">{t('productDetail.layer.colWeight')}</span>
            <span className="cfg-col cfg-col-actions" />
          </div>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
              {items.map(item => (
                <SortableLayerTableRow key={item.id}
                  layer={layer}
                  item={item}
                  productId={productId} pq={pq}
                  reloadProduct={reloadProduct}
                  selected={item.id === selectedId}
                  onSelect={() => !isLeaf && onSelect?.(item.id)}
                  isLeaf={isLeaf}
                  inheritedPrice={inheritedPrice}
                  registerUndo={registerUndo}
                  onRowClick={onRowClick}
                  onContextMenu={(e) => openCtxMenu(e, item.id)}
                  bulkSelected={bulkIds.includes(item.id)}
                  bulkActive={inScope}
                  onBulkToggle={() => toggleInBulk(item.id)}
                  hidePrice={hidePrice}
                  marginPct={marginPct}
                  onDelete={async () => {
                    const snapshot = snapshotLayerNode(item);
                    const r = await fetch(`${API_BASE}/api/products/${productId}/layers/${layer}/${item.id}${pq}`,
                      { method: 'DELETE', credentials: 'include' });
                    if (!r.ok) return;
                    if (selectedId === item.id) onSelect?.(null);
                    await reloadProduct?.();
                    if (registerUndo) {
                      registerUndo({
                        description: t('productDetail.layer.rowDeleted', { name: snapshot.name || t('productDetail.layer.untitled') }),
                        undo: async () => {
                          const rr = await fetch(`${API_BASE}/api/products/${productId}/restore${pq}`, {
                            method: 'POST', credentials: 'include',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              type: 'layer_node', layer, parent_id: parentId, data: snapshot,
                            }),
                          });
                          if (rr.ok) await reloadProduct?.();
                        },
                      });
                    }
                  }} />
              ))}
            </SortableContext>
          </DndContext>

          <LayerTableNewRow
            layer={layer}
            parentId={parentId}
            productId={productId} pq={pq}
            onAdded={() => reloadProduct?.()} />
        </div>

        {items.length > 0 && parentId != null && (
          <div className="spec-copy-row">
            <button type="button" className="spec-copy-btn" onClick={copyToSiblings}>
              {t('productDetail.layer.copyToSiblings')}
            </button>
            <span className="spec-copy-hint">
              {t('productDetail.layer.copyToSiblingsHint', { n: layer - 1 })}
            </span>
          </div>
        )}
      </div>

      {ctxMenu && (() => {
        // Only Layer 2 ids map directly to product_configurations_l2 (the SKU table). Deeper layers reuse the L2 leaf they roll up into — frontend currently exposes Print barcode on layer 2.
        const canPrint = layer === 2;
        const menuItems = [
          { label: t('productDetail.layer.card.select'),       icon: <CheckCircle  className="org-card-dropdown-icon" />,
            onClick: () => toggleInBulk(ctxMenu.id) },
          ...(canPrint ? [{ label: t('productDetail.layer.card.printBarcode'),
            icon: <Barcode className="org-card-dropdown-icon" />,
            onClick: () => onPrintBarcode?.({ skuId: ctxMenu.id }) }] : []),
        ];
        return (
          <RowContextMenu pos={ctxMenu}
            items={menuItems}
            onClose={() => setCtxMenu(null)} />
        );
      })()}
    </section>
  );
}

function SortableLayerTableRow(props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.item.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    background: isDragging ? 'var(--card)' : undefined,
    boxShadow: isDragging ? 'var(--shadow-card)' : undefined,
    zIndex: isDragging ? 5 : 'auto',
    opacity: isDragging ? 0.92 : 1,
  };
  return (
    <LayerTableRow
      {...props}
      dragRef={setNodeRef}
      dragStyle={style}
      dragHandleProps={{ ...attributes, ...listeners }}
    />
  );
}

function LayerTableRow({ layer, item, productId, pq, reloadProduct, registerUndo,
                          selected, onSelect, isLeaf, inheritedPrice, onDelete,
                          dragRef, dragStyle, dragHandleProps, onRowClick, onContextMenu,
                          bulkSelected, bulkActive, onBulkToggle,
                          hidePrice = false, marginPct = 50 }) {
  const { t } = useTranslation();
  const [name,  setName]  = useState(item.name || '');
  const [price, setPrice] = useState(item.price != null ? String(item.price) : '');
  const [cost,  setCost]  = useState(item.cost_price != null ? String(item.cost_price) : '');
  const [stock, setStock] = useState(String(item.stock_quantity || 0));
  const [weight, setWeight] = useState(item.weight_g != null ? String(item.weight_g) : '');

  const save = useCallback(async (body) => {
    const r = await fetch(`${API_BASE}/api/products/${productId}/layers/${layer}/${item.id}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) reloadProduct?.();
    return r.ok;
  }, [productId, layer, item.id, pq, reloadProduct]);

  const hasChildren = (item.children || []).length > 0;

  useUndoableSave({
    value: name, setValue: setName,
    serverValue: item.name || '',
    save: (val) => save({ name: (val || '').trim() }),
    registerUndo, label: t('productDetail.layer.undo.rowName', { name: item.name || t('productDetail.layer.undo.fallbackRow') }),
    debounceMs: 400,
  });
  useUndoableSave({
    value: price, setValue: setPrice,
    serverValue: item.price != null ? String(item.price) : '',
    save: (val) => save({ price: val === '' ? null : parseFloat(val) }),
    registerUndo, label: t('productDetail.layer.undo.rowPrice', { name: item.name || t('productDetail.layer.undo.fallbackRow') }),
    debounceMs: 400,
  });
  // Cost — when hidePrice is on, saving also auto-derives the public price = cost × (1 + margin/100).
  useUndoableSave({
    value: cost, setValue: setCost,
    serverValue: item.cost_price != null ? String(item.cost_price) : '',
    save: (val) => {
      const body = { cost_price: val === '' ? null : parseFloat(val) };
      if (hidePrice && val !== '' && isFinite(parseFloat(val))) {
        const c = parseFloat(val);
        const p = Math.round(c * (1 + (marginPct || 0) / 100) * 100) / 100;
        body.price = p;
        setPrice(String(p));
      }
      return save(body);
    },
    registerUndo, label: t('productDetail.layer.undo.rowCost', { name: item.name || t('productDetail.layer.undo.fallbackRow') }),
    debounceMs: 400,
  });
  useUndoableSave({
    value: stock, setValue: setStock,
    serverValue: String(item.stock_quantity || 0),
    save: (val) => save({ stock_quantity: parseInt(val, 10) || 0 }),
    registerUndo, label: t('productDetail.layer.undo.rowStock', { name: item.name || t('productDetail.layer.undo.fallbackRow') }),
    shouldSave: () => !hasChildren,
    debounceMs: 400,
  });
  // Weight (g) — only on a leaf row (no children); parents show a range instead.
  useUndoableSave({
    value: weight, setValue: setWeight,
    serverValue: item.weight_g != null ? String(item.weight_g) : '',
    save: (val) => save({ weight_g: val === '' ? null : parseFloat(val) }),
    registerUndo, label: t('productDetail.layer.undo.rowWeight', { name: item.name || t('productDetail.layer.undo.fallbackRow') }),
    debounceMs: 400,
  });

  const displayStock = hasChildren ? sumDeep(item.children, 'stock_quantity') : null;
  const displaySold  = hasChildren
    ? sumDeep(item.children, 'sold_quantity')
    : (item.sold_quantity || 0);

  const pricePlaceholder = inheritedPrice != null ? Number(inheritedPrice).toFixed(2) : '0.00';

  return (
    <div ref={dragRef} style={dragStyle}
      className={`cfg-row cfg-row--grabbable cfg-row--wt${selected ? ' cfg-row--selected' : ''}${!isLeaf ? ' cfg-row--clickable' : ''}${bulkSelected ? ' cfg-row--bulk' : ''}${bulkActive ? ' cfg-row--bulk-mode' : ''}${hidePrice ? ' cfg-row--hide-price' : ''}`}
      onClick={(e) => {
        if (onRowClick?.(e, item.id)) return;
        onSelect?.();
      }}
      onContextMenu={onContextMenu}
      {...(dragHandleProps || {})}>
      {bulkActive && (
        <input type="checkbox" className="cat-prod-checkbox cfg-bulk-check"
          checked={!!bulkSelected}
          onChange={() => onBulkToggle?.()}
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          aria-label={t('productDetail.layer.card.toggleSelection')} />
      )}
      <input className="crm-input cfg-cell" value={name}
        onChange={e => setName(e.target.value)} placeholder={t('productDetail.layer.rowNamePlaceholder')} />
      {!hidePrice && (
        <input className="crm-input cfg-cell" type="number" min="0" step="0.01"
          value={price}
          onChange={e => setPrice(e.target.value)}
          placeholder={pricePlaceholder} />
      )}
      <input className="crm-input cfg-cell" type="number" min="0" step="0.01"
        value={cost}
        onChange={e => setCost(e.target.value)}
        placeholder="0.00"
        title={hidePrice ? t('productDetail.layer.priceAutoTitle', { factor: (1 + marginPct/100).toFixed(2) }) : t('productDetail.layer.costTitleHint')} />
      {/* Weight: input on a leaf row; min–max range when the SKU lives deeper. */}
      {hasChildren ? (
        <span className="cfg-cell cfg-weight-range">{weightRangeLabel(item)}</span>
      ) : (
        <input className="crm-input cfg-cell" type="number" min="0" step="0.01"
          value={weight}
          onChange={e => setWeight(e.target.value)}
          placeholder="0"
          title={t('productDetail.layer.weightTitle')} />
      )}
      <button type="button" className="cfg-col-actions cfg-delete-btn"
        onClick={e => { e.stopPropagation(); onDelete?.(); }}
        title={t('productDetail.layer.delete')}>
        <Trash />
      </button>
    </div>
  );
}

function LayerTableNewRow({ layer, parentId, productId, pq, onAdded }) {
  const { t } = useTranslation();
  const [name,  setName]  = useState('');
  const [price, setPrice] = useState('');
  const busyRef = useRef(false);

  // New L2-L5 rows are created with stock=0; merchant adds stock by receiving a batch in Inventory.
  useEffect(() => {
    if (!name.trim() || busyRef.current) return;
    const t = setTimeout(async () => {
      busyRef.current = true;
      const res = await fetch(`${API_BASE}/api/products/${productId}/layers/${layer}${pq}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent_id: parentId,
          name: name.trim(),
          price: price === '' ? null : parseFloat(price),
          stock_quantity: 0,
        }),
      });
      busyRef.current = false;
      if (!res.ok) return;
      onAdded?.();
      setName(''); setPrice('');
    }, 600);
    return () => clearTimeout(t);
  }, [name, price, parentId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="cfg-row cfg-row--new cfg-row--wt">
      <input className="crm-input cfg-cell" value={name}
        onChange={e => setName(e.target.value)} placeholder={t('productDetail.layer.newConfiguration')} />
      <input className="crm-input cfg-cell" type="number" min="0" step="0.01"
        value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" />
      {/* Cost + weight are set after the row is created (on the data row). */}
      <span className="cfg-cell" />
      <span className="cfg-cell" />
      <span className="cfg-col-actions" />
    </div>
  );
}
