import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import {
  Plus, Trash, Image as ImageIcon, DotsThreeOutline, PencilSimple, X, UploadSimple,
} from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { InteractiveSection } from '../../Utils/InteractiveSection.js';

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

export default function LayerBlock(props) {
  if (props.layer === 1) return <Layer1Grid {...props} />;
  return <LayerTable {...props} />;
}

// ─── Layer 1: card grid (3 cols, image + inline editable price/stock/sold) ──

function Layer1Grid({ items, productId, pq, reloadProduct, selectedId, onSelect }) {
  const [editVar, setEditVar] = useState(null);

  const addItem = async () => {
    const res = await fetch(`${API_BASE}/api/products/${productId}/layers/1${pq}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: null }),
    });
    if (!res.ok) return;
    const created = await res.json();
    await reloadProduct();
    onSelect?.(created.id);
  };

  const deleteItem = async (id) => {
    if (!confirm('Delete this variation and all its nested layers?')) return;
    const res = await fetch(`${API_BASE}/api/products/${productId}/layers/1/${id}${pq}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (!res.ok) return;
    if (selectedId === id) onSelect?.(null);
    reloadProduct();
  };

  return (
    <section className="po-block">
      <div className="po-block-head">
        <h2 className="po-block-title">Configuration Layer 1</h2>
        <button className="po-add-pill" onClick={addItem} type="button">
          <Plus weight="bold" /> Add variation
        </button>
      </div>

      <div className="prod-grid prod-grid--3">
        {items.length === 0 && (
          <div className="po-empty">No variations yet. Click <b>Add variation</b>.</div>
        )}
        {items.map(v => (
          <Layer1Card key={v.id} v={v}
            productId={productId} pq={pq}
            reloadProduct={reloadProduct}
            selected={v.id === selectedId}
            onSelect={() => onSelect?.(v.id)}
            onEdit={() => setEditVar(v)}
            onDelete={() => deleteItem(v.id)} />
        ))}
      </div>

      {editVar && (
        <Layer1EditModal
          productId={productId}
          variation={editVar}
          pq={pq}
          onClose={() => setEditVar(null)}
          onSaved={() => { setEditVar(null); reloadProduct(); }} />
      )}
    </section>
  );
}

function Layer1Card({ v, productId, pq, reloadProduct, selected, onSelect, onEdit, onDelete }) {
  const menuBtnRef = useRef(null);
  const fileRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [name,  setName]  = useState(v.variation_name || '');
  const [price, setPrice] = useState(v.price != null ? String(v.price) : '');
  const [stock, setStock] = useState(String(v.stock_quantity || 0));
  const [uploading, setUploading] = useState(false);
  const [overFile,  setOverFile]  = useState(false);
  const skipName  = useRef(true);
  const skipPrice = useRef(true);
  const skipStock = useRef(true);
  const { ref, glossRef, handlers } = InteractiveSection(LAYER1_TILT, menuOpen);

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

  const save = async (body) => {
    await fetch(`${API_BASE}/api/products/${productId}/layers/1/${v.id}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    reloadProduct?.();
  };

  useEffect(() => {
    if (skipName.current) { skipName.current = false; return; }
    const t = setTimeout(() => save({ name: name.trim() }), 500);
    return () => clearTimeout(t);
  }, [name]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (skipPrice.current) { skipPrice.current = false; return; }
    const t = setTimeout(() => save({ price: price === '' ? null : parseFloat(price) }), 500);
    return () => clearTimeout(t);
  }, [price]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (skipStock.current) { skipStock.current = false; return; }
    if (hasChildren) return;
    const t = setTimeout(() => save({ stock_quantity: parseInt(stock, 10) || 0 }), 500);
    return () => clearTimeout(t);
  }, [stock]); // eslint-disable-line react-hooks/exhaustive-deps

  const uploadFile = async (file) => {
    if (!file || !file.type?.startsWith('image/')) return;
    setUploading(true);
    const fd = new FormData(); fd.append('file', file);
    try {
      const upRes = await fetch(`${API_BASE}/api/upload/image${pq}`, { method: 'POST', credentials: 'include', body: fd });
      const upData = await upRes.json();
      if (upRes.ok && upData.url) await save({ image_url: upData.url });
    } catch {}
    setUploading(false);
  };

  return (
    <div ref={ref}
      className={`org-card org-card--tilt prod-card layer1-card${selected ? ' prod-card--selected' : ''}`}
      onClick={onSelect}
      title="Click to select"
      {...handlers}>
      <div ref={glossRef} className="org-card-gloss prod-card-gloss" />
      <div className="layer1-inner">
        <div className={`layer1-img-wrap${overFile ? ' layer1-img-wrap--over' : ''}${uploading ? ' layer1-img-wrap--loading' : ''}`}
          onClick={e => { e.stopPropagation(); if (!uploading) fileRef.current?.click(); }}
          onDragOver={e => { e.preventDefault(); e.stopPropagation(); setOverFile(true); }}
          onDragLeave={e => { e.stopPropagation(); setOverFile(false); }}
          onDrop={e => {
            e.preventDefault(); e.stopPropagation();
            setOverFile(false);
            uploadFile(e.dataTransfer.files?.[0]);
          }}>
          <input ref={fileRef} type="file" accept="image/*" className="hidden-input"
            onClick={e => e.stopPropagation()}
            onChange={e => uploadFile(e.target.files?.[0])} />
          {uploading ? (
            <div className="layer1-img-empty"><div className="cfg-dropzone-spinner" /></div>
          ) : v.image_url ? (
            <img className="layer1-img" src={v.image_url} alt={v.variation_name} />
          ) : (
            <div className="layer1-img-empty">
              <ImageIcon weight="duotone" className="layer1-img-empty-icon" />
            </div>
          )}
          <div className="layer1-img-overlay">
            <UploadSimple weight="bold" />
          </div>
        </div>
        <div className="layer1-body">
          <input className="layer1-name-input"
            value={name}
            onChange={e => setName(e.target.value)}
            onClick={e => e.stopPropagation()}
            placeholder="Variation name"
            maxLength={100} />
          <div className="layer1-meta-row">
            <span className="layer1-meta-label">Price</span>
            <input className="layer1-meta-input"
              type="number" min="0" step="0.01"
              value={price}
              onChange={e => setPrice(e.target.value)}
              onClick={e => e.stopPropagation()}
              placeholder="0.00" />
          </div>
          <div className="layer1-meta-row">
            <span className="layer1-meta-label">Stock</span>
            {hasChildren ? (
              <span className="layer1-meta-value">{totalStock}</span>
            ) : (
              <input className="layer1-meta-input"
                type="number" min="0"
                value={stock}
                onChange={e => setStock(e.target.value)}
                onClick={e => e.stopPropagation()}
                placeholder="0" />
            )}
          </div>
          <div className="layer1-meta-row">
            <span className="layer1-meta-label">Sold</span>
            <span className="layer1-meta-value">{totalSold}</span>
          </div>
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
  );
}

function CardMenu({ btnRef, onEdit, onDelete, onClose }) {
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: Math.max(8, r.right - 160) });
    }
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

function Layer1EditModal({ productId, variation, pq, onClose, onSaved }) {
  const [name,    setName]    = useState(variation.variation_name || '');
  const [imgUrl,  setImgUrl]  = useState(variation.image_url || '');
  const [uploading, setUploading] = useState(false);
  const [dragging,  setDragging]  = useState(false);
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');
  const fileRef = useRef();

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const uploadFile = async (file) => {
    if (!file || !file.type?.startsWith('image/')) return;
    setUploading(true);
    const fd = new FormData(); fd.append('file', file);
    try {
      const res  = await fetch(`${API_BASE}/api/upload/image${pq}`, { method: 'POST', credentials: 'include', body: fd });
      const data = await res.json();
      if (res.ok) setImgUrl(data.url);
      else setErr(data.detail || 'Upload failed');
    } catch { setErr('Upload failed'); }
    setUploading(false);
  };

  const submit = async (e) => {
    e?.preventDefault();
    const trimmed = name.trim();
    setBusy(true); setErr('');
    const res = await fetch(`${API_BASE}/api/products/${productId}/layers/1/${variation.id}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed, image_url: imgUrl || null }),
    });
    setBusy(false);
    if (!res.ok) { setErr('Save failed'); return; }
    onSaved?.();
  };

  return createPortal(
    <div className="auth-modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="auth-modal cfg-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">Edit variation</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">Update image and name.</span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body cfg-modal-body">
          <form onSubmit={submit}>
            <div className="cfg-top var-edit-top">
              <div className="cfg-name-col">
                <label className="po-field-label">Variation name</label>
                <input className="crm-input" autoFocus value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Black, Spicy, 1L…" maxLength={100} />
                {err && <span className="crm-form-error">{err}</span>}
                <div className="auth-actions var-edit-actions">
                  <button className="crm-submit-btn" type="submit" disabled={busy}>
                    {busy ? 'Saving…' : 'Save'}
                  </button>
                  <button className="crm-submit-btn auth-btn-secondary" type="button" onClick={onClose}>
                    Cancel
                  </button>
                </div>
              </div>
              <div className="cfg-image-col">
                <input ref={fileRef} type="file" accept="image/*" className="hidden-input"
                  onChange={e => uploadFile(e.target.files?.[0])} />
                <div
                  className={`cfg-dropzone${dragging ? ' cfg-dropzone--over' : ''}${uploading ? ' cfg-dropzone--loading' : ''}`}
                  onClick={() => !uploading && fileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={e => { e.preventDefault(); setDragging(false); uploadFile(e.dataTransfer.files?.[0]); }}>
                  {imgUrl ? (
                    <>
                      <img src={imgUrl} alt={name} className="cfg-dropzone-preview" />
                      <div className="cfg-dropzone-overlay">
                        <UploadSimple weight="bold" /><span>Replace</span>
                      </div>
                    </>
                  ) : uploading ? (
                    <div className="cfg-dropzone-empty"><div className="cfg-dropzone-spinner" /><span>Uploading…</span></div>
                  ) : (
                    <div className="cfg-dropzone-empty">
                      <ImageIcon weight="duotone" />
                      <span className="cfg-dropzone-title">Drop image</span>
                      <span className="cfg-dropzone-hint">or click · WebP</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Layer 2-5: table view (Name | Price | Stock | Sold | Delete) ────────

function LayerTable({ layer, items, parentId, productId, pq, reloadProduct,
                      selectedId, onSelect, isLeaf, inheritedPrice, onDeleteLayer }) {

  const copyToSiblings = async () => {
    if (!confirm('Replace this list under all sibling parents at the previous layer?')) return;
    const res = await fetch(
      `${API_BASE}/api/products/${productId}/layers/${layer - 1}/${parentId}/copy-to-siblings${pq}`,
      { method: 'POST', credentials: 'include' }
    );
    if (res.ok) reloadProduct?.();
  };

  return (
    <section className="po-block">
      <div className="po-block-head">
        <h2 className="po-block-title">Configuration Layer {layer}</h2>
        {onDeleteLayer && (
          <button className="po-layer-delete-btn" onClick={onDeleteLayer} type="button" title="Delete this layer">
            <Trash weight="bold" /> Delete layer
          </button>
        )}
      </div>
      <div className="cfg-block-body">
        <div className="cfg-list">
          <div className="cfg-list-head">
            <span className="cfg-col cfg-col-name">Configuration Name</span>
            <span className="cfg-col cfg-col-price">Price</span>
            <span className="cfg-col cfg-col-stock">Stock</span>
            <span className="cfg-col cfg-col-sold">Sold</span>
            <span className="cfg-col cfg-col-actions" />
          </div>

          {items.map(item => (
            <LayerTableRow key={item.id}
              layer={layer}
              item={item}
              productId={productId} pq={pq}
              reloadProduct={reloadProduct}
              selected={item.id === selectedId}
              onSelect={() => !isLeaf && onSelect?.(item.id)}
              isLeaf={isLeaf}
              inheritedPrice={inheritedPrice}
              onDelete={async () => {
                const r = await fetch(`${API_BASE}/api/products/${productId}/layers/${layer}/${item.id}${pq}`,
                  { method: 'DELETE', credentials: 'include' });
                if (!r.ok) return;
                if (selectedId === item.id) onSelect?.(null);
                reloadProduct?.();
              }} />
          ))}

          <LayerTableNewRow
            layer={layer}
            parentId={parentId}
            productId={productId} pq={pq}
            onAdded={() => reloadProduct?.()} />
        </div>

        {items.length > 0 && parentId != null && (
          <div className="spec-copy-row">
            <button type="button" className="spec-copy-btn" onClick={copyToSiblings}>
              Copy to siblings
            </button>
            <span className="spec-copy-hint">
              Replaces this list under every other parent at Layer {layer - 1}.
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function LayerTableRow({ layer, item, productId, pq, reloadProduct, selected, onSelect, isLeaf, inheritedPrice, onDelete }) {
  const [name,  setName]  = useState(item.name || '');
  const [price, setPrice] = useState(item.price != null ? String(item.price) : '');
  const [stock, setStock] = useState(String(item.stock_quantity || 0));
  const skipName  = useRef(true);
  const skipPrice = useRef(true);
  const skipStock = useRef(true);

  useEffect(() => {
    skipName.current = true;
    skipPrice.current = true;
    skipStock.current = true;
    setName(item.name || '');
    setPrice(item.price != null ? String(item.price) : '');
    setStock(String(item.stock_quantity || 0));
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (body) => {
    await fetch(`${API_BASE}/api/products/${productId}/layers/${layer}/${item.id}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    reloadProduct?.();
  };

  useEffect(() => {
    if (skipName.current) { skipName.current = false; return; }
    const t = setTimeout(() => save({ name: name.trim() }), 400);
    return () => clearTimeout(t);
  }, [name]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (skipPrice.current) { skipPrice.current = false; return; }
    const t = setTimeout(() => save({ price: price === '' ? null : parseFloat(price) }), 400);
    return () => clearTimeout(t);
  }, [price]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasChildren = (item.children || []).length > 0;
  useEffect(() => {
    if (skipStock.current) { skipStock.current = false; return; }
    if (hasChildren) return;
    const t = setTimeout(() => save({ stock_quantity: parseInt(stock, 10) || 0 }), 400);
    return () => clearTimeout(t);
  }, [stock]); // eslint-disable-line react-hooks/exhaustive-deps

  const displayStock = hasChildren ? sumDeep(item.children, 'stock_quantity') : null;
  const displaySold  = hasChildren
    ? sumDeep(item.children, 'sold_quantity')
    : (item.sold_quantity || 0);

  const pricePlaceholder = inheritedPrice != null ? Number(inheritedPrice).toFixed(2) : '0.00';

  return (
    <div className={`cfg-row${selected ? ' cfg-row--selected' : ''}${!isLeaf ? ' cfg-row--clickable' : ''}`}
      onClick={onSelect}>
      <input className="crm-input cfg-cell" value={name}
        onClick={e => e.stopPropagation()}
        onChange={e => setName(e.target.value)} placeholder="S / 30 cm / 1 L" />
      <input className="crm-input cfg-cell" type="number" min="0" step="0.01"
        value={price}
        onClick={e => e.stopPropagation()}
        onChange={e => setPrice(e.target.value)}
        placeholder={pricePlaceholder} />
      {hasChildren ? (
        <input type="text" readOnly tabIndex={-1}
          className="crm-input cfg-cell cfg-sold-num"
          value={displayStock} />
      ) : (
        <input className="crm-input cfg-cell" type="number" min="0"
          value={stock}
          onClick={e => e.stopPropagation()}
          onChange={e => setStock(e.target.value)} />
      )}
      <input type="text" readOnly tabIndex={-1}
        className="crm-input cfg-cell cfg-sold-num"
        value={displaySold} />
      <button type="button" className="cfg-col-actions cfg-delete-btn"
        onClick={e => { e.stopPropagation(); onDelete?.(); }}
        title="Delete">
        <Trash />
      </button>
    </div>
  );
}

function LayerTableNewRow({ layer, parentId, productId, pq, onAdded }) {
  const [name,  setName]  = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const busyRef = useRef(false);

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
          stock_quantity: parseInt(stock, 10) || 0,
        }),
      });
      busyRef.current = false;
      if (!res.ok) return;
      onAdded?.();
      setName(''); setPrice(''); setStock('');
    }, 600);
    return () => clearTimeout(t);
  }, [name, price, stock, parentId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="cfg-row cfg-row--new">
      <input className="crm-input cfg-cell" value={name}
        onChange={e => setName(e.target.value)} placeholder="New configuration" />
      <input className="crm-input cfg-cell" type="number" min="0" step="0.01"
        value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" />
      <input className="crm-input cfg-cell" type="number" min="0"
        value={stock} onChange={e => setStock(e.target.value)} placeholder="0" />
      <span className="cfg-cell cfg-col-sold" />
      <span className="cfg-col-actions" />
    </div>
  );
}
