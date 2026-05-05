import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash, X } from '@phosphor-icons/react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, rectSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { API_BASE } from '../../api.js';

// ── Multi-photo gallery popover for one L1 variation ────────────────
// Anchored to a triggering card. Shows per-variation gallery as a 6-col grid.
// - `+` button to multi-upload via file input (multiple files at once).
// - Drag-and-drop reorder (first slot = cover, propagated to grid card).
// - Hover any tile → red X to delete (S3 cleanup is handled by backend
//   diffing the array on PUT).
// All edits PUT the full new array to /layers/1/{varId} which is the same
// endpoint the inline editors use.

const MAX_PER_ROW = 6;

function GalleryTile({ url, onDelete, draggable }) {
  const sortable = useSortable({ id: url });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}
      className={`vgal-tile${isDragging ? ' vgal-tile--dragging' : ''}`}
      {...(draggable ? { ...attributes, ...listeners } : {})}>
      <img src={url} alt="" className="vgal-img" />
      <button type="button" className="vgal-del"
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onDelete(); }}
        title="Delete this photo">
        <X weight="bold" size={11} />
      </button>
    </div>
  );
}

export default function VariationGalleryPopover({
  anchorRef, productId, variationId, pq, initialImages, onClose, onChange,
}) {
  const popRef     = useRef(null);
  const fileRef    = useRef(null);
  const anchorRect = useRef(null);
  const [pos, setPos]     = useState(null);
  const [ready, setReady] = useState(false);
  const [images, setImages] = useState(() => Array.isArray(initialImages) ? [...initialImages] : []);
  const [uploading, setUploading] = useState(false);

  // Re-sync if parent changes (e.g. external save reflects back)
  useEffect(() => {
    setImages(Array.isArray(initialImages) ? [...initialImages] : []);
  }, [initialImages]);

  // Outside-click + Esc handlers — independent of positioning logic.
  useEffect(() => {
    if (!anchorRef?.current) return;
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    const onPd  = e => {
      if (!e.target.closest?.('.vgal-pop') && !anchorRef.current?.contains(e.target)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPd);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPd);
    };
  }, [anchorRef, onClose]);

  // Position the popover ABOVE the anchor card image, synchronously after
  // every layout — useLayoutEffect runs after DOM mutations but before paint,
  // so `pop.offsetHeight` is always fresh and there is no visible flicker
  // between "below → above" measurement passes.
  useLayoutEffect(() => {
    const pop = popRef.current;
    const anchor = anchorRef?.current;
    if (!pop || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const h = pop.offsetHeight;
    // Always above. Clamp to 8px from viewport top so the popover doesn't
    // disappear off-screen when the card is right at the top of the page.
    const top  = Math.max(8, r.top - h - 8);
    const left = r.left + r.width / 2;
    // Only update state if the values actually changed — avoids feedback loops.
    setPos(prev => (prev && prev.top === top && prev.left === left ? prev : { top, left, above: true }));
    if (!ready) setReady(true);
  }, [anchorRef, images.length, ready]);

  // PUT the full array to the variation. Backend diffs and S3-cleans removed URLs.
  const persist = async (next) => {
    const res = await fetch(`${API_BASE}/api/products/${productId}/layers/1/${variationId}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: next }),
    });
    if (res.ok) onChange?.(next);
    return res.ok;
  };

  const onUpload = async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    const files = Array.from(fileList).filter(f => f.type?.startsWith('image/'));
    try {
      // Upload all files in parallel — same endpoint the rest of the app uses
      const results = await Promise.all(files.map(async (file) => {
        const fd = new FormData(); fd.append('file', file);
        const r = await fetch(`${API_BASE}/api/upload/image${pq}`, {
          method: 'POST', credentials: 'include', body: fd,
        });
        if (!r.ok) return null;
        const j = await r.json();
        return j?.url || null;
      }));
      const newUrls = results.filter(Boolean);
      if (newUrls.length) {
        const next = [...images, ...newUrls];
        setImages(next);
        await persist(next);
      }
    } finally { setUploading(false); }
  };

  const removeAt = async (idx) => {
    const next = images.filter((_, i) => i !== idx);
    setImages(next);
    await persist(next);
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const onDragEnd = async ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const oldIdx = images.indexOf(String(active.id));
    const newIdx = images.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(images, oldIdx, newIdx);
    setImages(next);
    await persist(next);
  };

  // Always render the portal — even before the first measurement — so popRef
  // gets attached and useLayoutEffect can read offsetHeight. We just park it
  // off-screen until the layout effect fires.
  const renderPos = pos || { top: -9999, left: -9999, above: true };
  return createPortal(
    <div ref={popRef}
      className={`vgal-pop${renderPos.above ? ' vgal-pop--above' : ''}${ready ? ' vgal-pop--ready' : ''}`}
      onPointerDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      style={{ top: renderPos.top, left: renderPos.left }}>
      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden-input"
        onChange={(e) => { onUpload(e.target.files); e.target.value = ''; }} />
      {/* Flex-wrap row of tiles — same adaptive sizing as Products photo stack. */}
      <div className="vgal-grid">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={images} strategy={rectSortingStrategy}>
            {images.map((url, i) => (
              <GalleryTile key={url} url={url} draggable
                onDelete={() => removeAt(i)} />
            ))}
          </SortableContext>
        </DndContext>
        <button type="button" className="vgal-add"
          onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading
            ? <span className="vgal-add-spinner" />
            : <Plus weight="bold" size={22} />}
        </button>
      </div>
    </div>,
    document.body,
  );
}
