import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Trash, X } from '@phosphor-icons/react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, rectSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { API_BASE } from '../../api.js';
import { presignedUpload } from '../../Utils/upload.js';

// ── Multi-photo gallery popover for one L1 variation ────────────────
// 6-col grid; +button multi-upload; DnD reorder (slot 0 = cover); X deletes (S3 cleanup via PUT diff).

const MAX_PER_ROW = 6;

// Detect media type from URL/host (mirror of External _media_type); avoids broken <img> for non-image content.
function mediaTypeOf(url) {
  if (!url) return 'image';
  const u = String(url).toLowerCase().split('?', 1)[0];
  if (/(youtube\.com|youtu\.be|vimeo\.com)/.test(u)) return 'video-embed';
  if (/\.(mp4|webm|mov|m4v)$/.test(u)) return 'video';
  if (/\.(glb|usdz|gltf)$/.test(u))    return 'model';
  return 'image';
}

function GalleryTile({ url, onDelete, draggable }) {
  const { t } = useTranslation();
  const sortable = useSortable({ id: url });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const kind = mediaTypeOf(url);
  return (
    <div ref={setNodeRef} style={style}
      className={`vgal-tile vgal-tile--${kind}${isDragging ? ' vgal-tile--dragging' : ''}`}
      {...(draggable ? { ...attributes, ...listeners } : {})}>
      {kind === 'image' && <img src={url} alt="" className="vgal-img" />}
      {kind === 'video' && (
        // muted + playsInline — preview only, not full playback
        <video src={url} className="vgal-img" muted playsInline preload="metadata" />
      )}
      {kind === 'video-embed' && (
        <div className="vgal-media-placeholder">▶ {t('productDetail.gallery.videoLabel')}</div>
      )}
      {kind === 'model' && (
        <div className="vgal-media-placeholder">⬢ {t('productDetail.gallery.modelLabel')}</div>
      )}
      <button type="button" className="vgal-del"
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onDelete(); }}
        title={t('productDetail.gallery.deleteMedia')}>
        <X weight="bold" size={11} />
      </button>
    </div>
  );
}

export default function VariationGalleryPopover({
  anchorRef, productId, variationId, pq, initialImages, onClose, onChange,
}) {
  const { t } = useTranslation();
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

  // Position popover ABOVE anchor via useLayoutEffect (post-mutation, pre-paint) — no flicker.
  useLayoutEffect(() => {
    const pop = popRef.current;
    const anchor = anchorRef?.current;
    if (!pop || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const h = pop.offsetHeight;
    // Always above; clamp to 8px from viewport top so popover stays on-screen.
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

  // Phase 7 — multi-type upload via presigned direct-to-R2 (preserves format; no WebP conversion).
  const ACCEPT_EXT = "image/*,video/*,.glb,.usdz,.gltf";

  const onUpload = async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      const results = await Promise.all(Array.from(fileList).map(async (file) => {
        try {
          const { url } = await presignedUpload(file, { pq, kind: 'media' });
          return url || null;
        } catch (e) {
          if (e.message) alert(e.message);   // file-too-large etc.; 402 already shows the plan modal
          return null;
        }
      }));
      const newUrls = results.filter(Boolean);
      if (newUrls.length) {
        const next = [...images, ...newUrls];
        setImages(next);
        await persist(next);
      }
    } finally { setUploading(false); }
  };

  // ── Add-by-URL flow (YouTube / Vimeo / own S3) — server validates whitelist + appends to images[]. ──
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [urlInput,    setUrlInput]    = useState('');
  const [urlError,    setUrlError]    = useState('');

  const submitUrl = async () => {
    const url = urlInput.trim();
    if (!url) { setUrlError(t('productDetail.gallery.pasteUrlFirst')); return; }
    setUploading(true); setUrlError('');
    const r = await fetch(`${API_BASE}/api/products/${productId}/layers/1/${variationId}/media-url${pq}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (r.ok) {
      const next = [...images, url];
      setImages(next);
      onChange?.(next);
      setUrlInput(''); setShowAddMenu(false);
    } else {
      const j = await r.json().catch(() => ({}));
      setUrlError(j.detail || t('productDetail.gallery.failedToAddUrl'));
    }
    setUploading(false);
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

  // Always render portal so popRef attaches and useLayoutEffect can read offsetHeight; park off-screen until measured.
  const renderPos = pos || { top: -9999, left: -9999, above: true };
  return (
    <>
    {createPortal(
    <div ref={popRef}
      className={`vgal-pop${renderPos.above ? ' vgal-pop--above' : ''}${ready ? ' vgal-pop--ready' : ''}`}
      onPointerDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      style={{ top: renderPos.top, left: renderPos.left }}>
      <input ref={fileRef} type="file" accept={ACCEPT_EXT} multiple className="hidden-input"
        onChange={(e) => { onUpload(e.target.files); e.target.value = ''; setShowAddMenu(false); }} />
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
          onClick={() => { setUrlError(''); setShowAddMenu(true); }} disabled={uploading}>
          {uploading
            ? <span className="vgal-add-spinner" />
            : <Plus weight="bold" size={22} />}
        </button>
      </div>

    </div>,
    document.body,
  )}
    <AddMediaModal
      open={showAddMenu}
      uploading={uploading}
      onPickFile={() => fileRef.current?.click()}
      urlInput={urlInput}
      setUrlInput={(v) => { setUrlInput(v); setUrlError(''); }}
      urlError={urlError}
      onSubmitUrl={submitUrl}
      onClose={() => { setShowAddMenu(false); setUrlError(''); }}
    />
    </>
  );
}

// Add-Media modal — separate portal on top of gallery popover. Closes on X/backdrop/Esc.
function AddMediaModal({ open, uploading, onPickFile, urlInput, setUrlInput,
                         urlError, onSubmitUrl, onClose }) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="vgal-modal-backdrop"
      onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}
      onClick={(e) => e.stopPropagation()}>
      <div className="vgal-modal" onPointerDown={(e) => e.stopPropagation()}>
        <header className="vgal-modal-head">
          <h2 className="vgal-modal-title">{t('productDetail.gallery.addMedia')}</h2>
          <button type="button" className="vgal-modal-close" onClick={onClose} aria-label={t('productDetail.gallery.close')}>
            <X weight="bold" size={14} />
          </button>
        </header>
        <p className="vgal-modal-hint">
          {t('productDetail.gallery.addMediaHint')}
        </p>

        <button type="button" className="vgal-modal-upload"
          onClick={onPickFile} disabled={uploading}>
          {uploading ? t('productDetail.gallery.uploading') : t('productDetail.gallery.chooseFile')}
        </button>

        <div className="vgal-modal-divider"><span>{t('productDetail.gallery.or')}</span></div>

        <div className="vgal-modal-url-row">
          <input className="crm-input vgal-modal-url-input" type="text"
            placeholder={t('productDetail.gallery.urlPlaceholder')}
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSubmitUrl(); }}
            autoFocus />
          <button type="button" className="crm-add-btn vgal-modal-url-btn"
            onClick={onSubmitUrl} disabled={uploading || !urlInput.trim()}>
            {t('productDetail.gallery.addUrl')}
          </button>
        </div>
        {urlError && <p className="vgal-modal-error">{urlError}</p>}

        <p className="vgal-modal-foot">
          {t('productDetail.gallery.allowed')}
        </p>
      </div>
    </div>,
    document.body,
  );
}
