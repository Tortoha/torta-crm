import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import {
  Plus, Trash, Image as ImageIcon, DotsThreeOutline, PencilSimple, X, UploadSimple,
} from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { decodeHash } from '../../Utils/hashids.js';
import ConfigurationBlock from './ConfigurationBlock.jsx';
import { CpmCategorySelect } from '../Project/Products/CreateProductModal.jsx';
import { InteractiveSection } from '../../Utils/InteractiveSection.js';
import '../../Style/Authentication.css';
import '../../Style/Organization.css';
import '../../Style/Products.css';

const VAR_TILT = {
  maxAngle: 12, lerp: 0.05, lerpOut: 0.07,
  scale: 1.04, perspective: 750,
  gloss: { opacity: 0.14, spread: 60 },
};


export default function ProductOverview() {
  const { projectId, setProductContext } = useOutletContext();
  const { productHash } = useParams();
  const productId = decodeHash(productHash);
  const pq = `?project_id=${projectId}`;

  const [product,  setProduct]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [toast,    setToast]    = useState('');
  const [selectedVarId, setSelectedVarId] = useState(null);
  const toastRef = useRef(null);

  // Auto-pick a variation: keep current if it still exists, otherwise pick first.
  useEffect(() => {
    const list = product?.variations || [];
    setSelectedVarId(prev => {
      if (prev != null && list.find(v => v.id === prev)) return prev;
      return list[0]?.id ?? null;
    });
  }, [product?.variations]);

  // Toast auto-dismiss helper — same pattern as the auth-toast we use elsewhere.
  const showToast = useCallback((msg) => {
    setToast(msg);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(''), 2400);
  }, []);

  // Initial load
  useEffect(() => {
    if (!productId) { setNotFound(true); setLoading(false); return; }
    setLoading(true);
    fetch(`${API_BASE}/api/products/${productId}${pq}`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => {
        setProduct(data);
        setProductContext?.({ name: data.title, hash: productHash });
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [productId, projectId, productHash, pq, setProductContext]);

  useEffect(() => () => setProductContext?.(null), [setProductContext]);

  const reloadProduct = useCallback(async () => {
    const res  = await fetch(`${API_BASE}/api/products/${productId}${pq}`, { credentials: 'include' });
    if (res.ok) setProduct(await res.json());
  }, [productId, pq]);

  if (loading)  return <Shell><p className="crm-placeholder">Loading…</p></Shell>;
  if (notFound) return <Shell><p className="crm-placeholder">Product not found.</p></Shell>;

  return (
    <Shell>
      <h1 className="crm-page-title">{product.title || 'Untitled'}</h1>

      <GeneralBlock product={product} pq={pq} setProduct={setProduct}
        setProductContext={setProductContext} productHash={productHash}
        showToast={showToast} />

      <VariationsBlock product={product} productId={productId} pq={pq}
        selectedVarId={selectedVarId} onSelect={setSelectedVarId}
        reloadProduct={reloadProduct} showToast={showToast} />

      {selectedVarId != null && (
        <ConfigurationBlock
          productId={productId}
          pq={pq}
          variation={product.variations?.find(v => v.id === selectedVarId)} />
      )}

      <CustomFieldsBlock product={product} productId={productId} pq={pq}
        setProduct={setProduct} showToast={showToast} />

      <SeoBlock product={product} pq={pq} setProduct={setProduct} showToast={showToast} />

      {toast && createPortal(
        <div className="auth-toast">{toast}</div>,
        document.body
      )}
    </Shell>
  );
}

function Shell({ children }) {
  return <div className="prod-page po-page">{children}</div>;
}

function GeneralBlock({ product, pq, setProduct, setProductContext, productHash, showToast }) {
  const [title,    setTitle]    = useState(product.title || '');
  const [subtitle, setSubtitle] = useState(product.subtitle || '');
  const [desc,     setDesc]     = useState(product.description || '');
  const [catId,    setCatId]    = useState(product.category_id ?? '');
  const [categories, setCategories] = useState([]);

  const skipTitle    = useRef(true);
  const skipSubtitle = useRef(true);
  const skipDesc     = useRef(true);
  const skipCat      = useRef(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/categories${pq}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setCategories(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [pq]);

  // Generic patch helper — sends only the fields that changed.
  const patch = useCallback(async (body) => {
    const res = await fetch(`${API_BASE}/api/products/${product.id}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { showToast('Save failed'); return false; }
    setProduct(p => ({ ...p, ...body }));
    showToast('Saved');
    return true;
  }, [product.id, pq, setProduct, showToast]);

  // Title debounced (500 ms after last keystroke)
  useEffect(() => {
    if (skipTitle.current) { skipTitle.current = false; return; }
    const t = setTimeout(async () => {
      const trimmed = title.trim();
      if (!trimmed) return;
      const ok = await patch({ title: trimmed });
      if (ok) setProductContext?.({ name: trimmed, hash: productHash });
    }, 500);
    return () => clearTimeout(t);
  }, [title]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (skipSubtitle.current) { skipSubtitle.current = false; return; }
    const t = setTimeout(() => patch({ subtitle }), 500);
    return () => clearTimeout(t);
  }, [subtitle]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (skipDesc.current) { skipDesc.current = false; return; }
    const t = setTimeout(() => patch({ description: desc }), 500);
    return () => clearTimeout(t);
  }, [desc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Category — instant save (selects don't really need debounce)
  useEffect(() => {
    if (skipCat.current) { skipCat.current = false; return; }
    patch({ category_id: catId === '' ? null : Number(catId) });
  }, [catId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="po-block">
      <div className="po-form">
        <Field label="Title">
          <input className="crm-input po-input" value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Product name" maxLength={200} />
        </Field>
        <Field label="Subtitle">
          <input className="crm-input po-input" value={subtitle}
            onChange={e => setSubtitle(e.target.value)}
            placeholder="Short tagline shown under the title" maxLength={300} />
        </Field>
        <Field label="Description">
          <textarea className="crm-input po-textarea" value={desc} rows={5}
            onChange={e => setDesc(e.target.value)}
            placeholder="Full product description, materials, features…" />
        </Field>
        <Field label="Category">
          <CpmCategorySelect
            value={catId == null ? '' : String(catId)}
            categories={categories}
            onChange={setCatId} />
        </Field>
      </div>
    </section>
  );
}

function Field({ label, children }) {
  return (
    <div className="po-field">
      <label className="po-field-label1">{label}</label>
      {children}
    </div>
  );
}


function VariationsBlock({ product, productId, pq, selectedVarId, onSelect, reloadProduct, showToast }) {
  const [vars, setVars] = useState(product.variations || []);
  const [editVar, setEditVar] = useState(null);
  const dragId = useRef(null);

  useEffect(() => { setVars(product.variations || []); }, [product.variations]);

  const deleteVariation = async (v) => {
    if (!confirm(`Delete variation "${v.variation_name}" and all its configurations?`)) return;
    const res = await fetch(`${API_BASE}/api/products/${productId}/variations/${v.id}${pq}`,
      { method: 'DELETE', credentials: 'include' });
    if (!res.ok) { showToast('Delete failed'); return; }
    if (selectedVarId === v.id) onSelect?.(null);
    reloadProduct();
  };

  const onDragStart = (id) => (e) => {
    dragId.current = id;
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.classList.add('po-var-card--dragging');
  };
  const onDragEnd = (e) => {
    e.currentTarget.classList.remove('po-var-card--dragging');
    dragId.current = null;
  };
  const onDragOver = (id) => (e) => {
    e.preventDefault();
    if (dragId.current == null || dragId.current === id) return;
    setVars(prev => {
      const fromIdx = prev.findIndex(v => v.id === dragId.current);
      const toIdx   = prev.findIndex(v => v.id === id);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };
  // Persist new order on drop
  const onDrop = async () => {
    if (dragId.current == null) return;
    dragId.current = null;
    const ids = vars.map(v => v.id);
    const res = await fetch(`${API_BASE}/api/products/${productId}/variations/reorder${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variation_ids: ids }),
    });
    if (!res.ok) { showToast('Reorder failed'); reloadProduct(); }
    else showToast('Order saved');
  };

  const addVariation = async () => {
    const res = await fetch(`${API_BASE}/api/products/${productId}/variations${pq}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variation_name: 'New variation', image_url: null }),
    });
    if (!res.ok) { showToast('Create failed'); return; }
    const created = await res.json();
    await reloadProduct();
    onSelect?.(created.id);
  };

  return (
    <section className="po-block">
      <div className="po-block-head">
        <h2 className="crm-page-title1">Variations</h2>
        <button className="po-add-pill" onClick={addVariation} type="button">
          <Plus weight="bold" /> Add variation
        </button>
      </div>

      <div className="prod-grid" onDrop={onDrop} onDragOver={e => e.preventDefault()}>
        {vars.length === 0 && (
          <div className="po-empty">
            No variations yet. Click <b>Add variation</b> — colors, sizes, options.
          </div>
        )}

        {vars.map(v => (
          <VarCard key={v.id} v={v}
            selected={v.id === selectedVarId}
            onOpen={() => onSelect?.(v.id)}
            onEdit={() => setEditVar(v)}
            onDelete={() => deleteVariation(v)}
            onDragStart={onDragStart(v.id)}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver(v.id)} />
        ))}
      </div>

      {editVar && (
        <VarEditModal
          productId={productId}
          variation={editVar}
          pq={pq}
          onClose={() => setEditVar(null)}
          onSaved={() => { setEditVar(null); reloadProduct(); }} />
      )}
    </section>
  );
}

function VarCard({ v, selected, onOpen, onEdit, onDelete, onDragStart, onDragEnd, onDragOver }) {
  const menuBtnRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { ref, glossRef, handlers } = InteractiveSection(VAR_TILT, menuOpen);
  const cfgCount = v.configurations?.length || 0;

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
    <div ref={ref}
      className={`org-card org-card--tilt prod-card${selected ? ' prod-card--selected' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onClick={onOpen}
      title="Click to configure"
      {...handlers}>
      <div ref={glossRef} className="org-card-gloss prod-card-gloss" />
      <div className="pcard-inner">
        <div className="pcard-img-wrap">
          {v.image_url
            ? <img className="pcard-img" src={v.image_url} alt={v.variation_name} />
            : <div className="pcard-img-empty"><ImageIcon weight="duotone" /></div>}
        </div>
        <div className="pcard-body">
          <div className="pcard-title">{v.variation_name || 'Unnamed'}</div>
          <div className="pcard-row1">
            <span className="pcard-stock">
              {cfgCount} {cfgCount === 1 ? 'config' : 'configs'}
            </span>
          </div>
        </div>
      </div>
      <button ref={menuBtnRef} className="org-card-menu-btn pcard-menu-btn" type="button"
        onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}>
        <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
      </button>
      {menuOpen && (
        <VarMenu btnRef={menuBtnRef}
          onEdit={() => { setMenuOpen(false); onEdit?.(); }}
          onDelete={() => { setMenuOpen(false); onDelete?.(); }}
          onClose={() => setMenuOpen(false)} />
      )}
    </div>
  );
}

function VarMenu({ btnRef, onEdit, onDelete, onClose }) {
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

function VarEditModal({ productId, variation, pq, onClose, onSaved }) {
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
    if (!trimmed) return setErr('Name is required');
    setBusy(true); setErr('');
    const res = await fetch(`${API_BASE}/api/products/${productId}/variations/${variation.id}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variation_name: trimmed, image_url: imgUrl || null }),
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
            <div className="cfg-top">
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

              <div className="cfg-name-col">
                <label className="po-field-label">Variation name</label>
                <input className="crm-input" autoFocus value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Black, Spicy, 1L…" maxLength={100} />
              </div>
            </div>

            {err && <span className="crm-form-error">{err}</span>}

            <div className="auth-actions" style={{ marginTop: 16 }}>
              <button className="crm-submit-btn" type="submit" disabled={busy || !name.trim()}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button className="crm-submit-btn auth-btn-secondary" type="button" onClick={onClose}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─────────────────────────────────────────────────────────────────
// BLOCK 3 — Custom Fields (inline-editable list, instant persistence)
// ─────────────────────────────────────────────────────────────────
function CustomFieldsBlock({ product, productId, pq, setProduct, showToast }) {
  const fields = product.custom_fields || [];

  const upsert = async (field_key, field_value, field_type, is_global) => {
    const res = await fetch(`${API_BASE}/api/products/${productId}/custom-fields${pq}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field_key, field_value, field_type, is_global }),
    });
    if (!res.ok) { showToast('Save failed'); return false; }
    setProduct(p => {
      const arr = [...(p.custom_fields || [])];
      const idx = arr.findIndex(f => f.field_key === field_key);
      const entry = { field_key, field_value, field_type, is_global };
      if (idx >= 0) arr[idx] = entry; else arr.push(entry);
      return { ...p, custom_fields: arr };
    });
    return true;
  };

  const remove = async (key) => {
    if (!confirm(`Delete field "${key}"?`)) return;
    const res = await fetch(`${API_BASE}/api/products/${productId}/custom-fields/${encodeURIComponent(key)}${pq}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (!res.ok) { showToast('Delete failed'); return; }
    setProduct(p => ({ ...p, custom_fields: (p.custom_fields || []).filter(f => f.field_key !== key) }));
    showToast('Field deleted');
  };

  return (
    <section className="po-block">
      <h2 className="crm-page-title1">Custom Fields</h2>
      <p className="po-block-hint">
        Free-form attributes returned by the storefront API. Toggle <b>Global</b>
        to share the value across every product.
      </p>
      <div className="po-block-card">
        {fields.length === 0 && <div className="po-empty">No custom fields.</div>}

        {fields.map(f => (
          <CfRow key={f.field_key} field={f} onSave={upsert} onDelete={() => remove(f.field_key)}
            showToast={showToast} />
        ))}

        <CfNewRow existingKeys={fields.map(f => f.field_key)} onSave={upsert} showToast={showToast} />
      </div>
    </section>
  );
}

function CfRow({ field, onSave, onDelete }) {
  const [value, setValue] = useState(field.field_value ?? '');
  const skip = useRef(true);
  // Re-sync if parent updates (e.g. after Global toggle)
  useEffect(() => { setValue(field.field_value ?? ''); skip.current = true; }, [field.field_value]);

  // Debounced auto-save of value
  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    const t = setTimeout(() => onSave(field.field_key, value, field.field_type, field.is_global), 500);
    return () => clearTimeout(t);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="po-cf-row">
      <code className="po-cf-key">{field.field_key}</code>
      <input className="crm-input po-cf-value" value={value} onChange={e => setValue(e.target.value)}
        placeholder="value" />
      <span className="po-cf-type">{field.field_type}</span>
      <button type="button"
        className={`po-cf-toggle${field.is_global ? ' po-cf-toggle--on' : ''}`}
        onClick={() => onSave(field.field_key, value, field.field_type, !field.is_global)}
        title={field.is_global ? 'Global field' : 'Per-product field'}>
        <span className="po-cf-toggle-knob" />
      </button>
      <button type="button" className="po-cf-delete" onClick={onDelete} title="Delete field">
        <Trash />
      </button>
    </div>
  );
}

function CfNewRow({ existingKeys, onSave, showToast }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [val, setVal] = useState('');
  const [type, setType] = useState('string');
  const [global, setGlobal] = useState(false);

  const reset = () => { setKey(''); setVal(''); setType('string'); setGlobal(false); setOpen(false); };

  const submit = async (e) => {
    e?.preventDefault();
    const k = key.trim();
    if (!k) return showToast('Key is required');
    if (existingKeys.includes(k)) return showToast('Key already exists');
    const ok = await onSave(k, val, type, global);
    if (ok) reset();
  };

  if (!open) {
    return (
      <button type="button" className="po-add-row-btn" onClick={() => setOpen(true)}>
        <Plus weight="bold" /> New field
      </button>
    );
  }

  return (
    <form className="po-cf-row po-cf-row--new" onSubmit={submit}>
      <input className="crm-input po-cf-key-input" autoFocus value={key}
        onChange={e => setKey(e.target.value)} placeholder="field_key" />
      <input className="crm-input po-cf-value" value={val}
        onChange={e => setVal(e.target.value)} placeholder="value" />
      <select className="crm-input crm-input-select po-cf-type-input" value={type}
        onChange={e => setType(e.target.value)}>
        <option value="string">string</option>
        <option value="number">number</option>
        <option value="boolean">boolean</option>
        <option value="json">json</option>
      </select>
      <button type="button"
        className={`po-cf-toggle${global ? ' po-cf-toggle--on' : ''}`}
        onClick={() => setGlobal(g => !g)}
        title={global ? 'Global field' : 'Per-product field'}>
        <span className="po-cf-toggle-knob" />
      </button>
      <div className="po-cf-actions">
        <button type="submit" className="crm-submit-btn po-cf-add">Add</button>
        <button type="button" className="crm-submit-btn auth-btn-secondary" onClick={reset}>Cancel</button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────
// BLOCK 4 — SEO (3 fields, debounced auto-save)
// ─────────────────────────────────────────────────────────────────
function SeoBlock({ product, pq, setProduct, showToast }) {
  const [seoTitle, setSeoTitle] = useState(product.seo_title || '');
  const [seoDesc,  setSeoDesc]  = useState(product.seo_description || '');
  const [seoKw,    setSeoKw]    = useState(product.seo_keywords || '');

  const skipT = useRef(true), skipD = useRef(true), skipK = useRef(true);

  const patch = useCallback(async (body) => {
    const res = await fetch(`${API_BASE}/api/products/${product.id}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { showToast('Save failed'); return; }
    setProduct(p => ({ ...p, ...body }));
    showToast('Saved');
  }, [product.id, pq, setProduct, showToast]);

  useEffect(() => {
    if (skipT.current) { skipT.current = false; return; }
    const t = setTimeout(() => patch({ seo_title: seoTitle }), 500);
    return () => clearTimeout(t);
  }, [seoTitle]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (skipD.current) { skipD.current = false; return; }
    const t = setTimeout(() => patch({ seo_description: seoDesc }), 500);
    return () => clearTimeout(t);
  }, [seoDesc]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (skipK.current) { skipK.current = false; return; }
    const t = setTimeout(() => patch({ seo_keywords: seoKw }), 500);
    return () => clearTimeout(t);
  }, [seoKw]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="po-block">
      <h2 className="crm-page-title1">SEO</h2>
      <p className="po-block-hint">Used by the storefront for search-engine results.</p>
      <div className="po-form">
        <Field label="SEO Title">
          <input className="crm-input po-input" value={seoTitle}
            onChange={e => setSeoTitle(e.target.value)} placeholder="e.g. Buy Trousers Online" maxLength={200} />
        </Field>
        <Field label={<>SEO Description <span className="po-char-count">{seoDesc.length}/160</span></>}>
          <textarea className="crm-input po-textarea" rows={3} maxLength={160} value={seoDesc}
            onChange={e => setSeoDesc(e.target.value)}
            placeholder="Brief page description for search results…" />
        </Field>
        <Field label="Keywords">
          <input className="crm-input po-input" value={seoKw}
            onChange={e => setSeoKw(e.target.value)} placeholder="trousers, pants, fashion" maxLength={300} />
        </Field>
      </div>
    </section>
  );
}
