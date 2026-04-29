import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useOutletContext, useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Cube, Plus, Trash, Image as ImageIcon, ChatCircleText, Code, DotsSixVertical,
} from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { decodeHash } from '../../Utils/hashids.js';
import ConfigurationModal from './ConfigurationModal.jsx';
import '../../Style/Authentication.css';
import '../../Style/Products.css';

/**
 * /project/:apiKey/products/:productHash — single-page replacement for the
 * old 6-tab ProductPage. Four visible sections, all auto-saved:
 *
 *   1) General     — title / subtitle / description / category
 *   2) Variations  — drag-and-drop ordered cards (click → configuration modal)
 *   3) Custom Fields — inline-editable list, immediate persistence
 *   4) SEO         — title / description / keywords
 *
 * Reviews and API Preview are separate pages reached from the header.
 */
export default function ProductOverview() {
  const { project, projectId, setProductContext } = useOutletContext();
  const { productHash } = useParams();
  const navigate = useNavigate();
  const productId = decodeHash(productHash);
  const pq = `?project_id=${projectId}`;
  // The product detail page lives under its own top-level layout, so the
  // project apiKey isn't in the URL — it comes from the project context.
  const apiKey = project?.api_key;

  const [product,  setProduct]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [toast,    setToast]    = useState('');
  const toastRef = useRef(null);

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

  // Clean up the breadcrumb on unmount so the header doesn't keep stale state.
  useEffect(() => () => setProductContext?.(null), [setProductContext]);

  // Reload only the variations sub-tree (used after configuration modal closes
  // and after drag-and-drop reorder). Avoids a full page refresh.
  const reloadProduct = useCallback(async () => {
    const res  = await fetch(`${API_BASE}/api/products/${productId}${pq}`, { credentials: 'include' });
    if (res.ok) setProduct(await res.json());
  }, [productId, pq]);

  if (loading)  return <Shell><p className="crm-placeholder">Loading…</p></Shell>;
  if (notFound) return <Shell><p className="crm-placeholder">Product not found.</p></Shell>;

  return (
    <Shell>
      <PageHeader
        product={product}
        onBack={() => apiKey && navigate(`/project/${apiKey}/products`)}
        onReviews={() => navigate(`/product/${productHash}/reviews`)}
        onApi={() => navigate(`/product/${productHash}/api-preview`)} />

      <GeneralBlock product={product} pq={pq} setProduct={setProduct}
        setProductContext={setProductContext} productHash={productHash}
        showToast={showToast} />

      <VariationsBlock product={product} productId={productId} pq={pq}
        reloadProduct={reloadProduct} showToast={showToast} />

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

// ─────────────────────────────────────────────────────────────────
// Shell — gives every state (loading / not-found / loaded) the same
// outer wrapper so the page doesn't jump.
// ─────────────────────────────────────────────────────────────────
function Shell({ children }) {
  return <div className="prod-page po-page">{children}</div>;
}

// ─────────────────────────────────────────────────────────────────
// Page header — back, icon, title, action buttons (Reviews, API)
// ─────────────────────────────────────────────────────────────────
function PageHeader({ product, onBack, onReviews, onApi }) {
  return (
    <div className="po-header">
      <button className="po-back-btn" onClick={onBack} type="button" title="Back to Products">
        <ArrowLeft className="po-back-icon" />
      </button>
      <div className="po-title-icon"><Cube weight="duotone" /></div>
      <h1 className="crm-page-title po-title">{product.title || 'Untitled'}</h1>
      <div className="po-header-actions">
        <button className="po-header-btn" onClick={onReviews} type="button" title="Reviews">
          <ChatCircleText className="po-header-btn-icon" />
          <span>Reviews</span>
          <span className="po-header-btn-count">{(product.reviews || []).length}</span>
        </button>
        <button className="po-header-btn" onClick={onApi} type="button" title="API Preview">
          <Code className="po-header-btn-icon" />
          <span>API</span>
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// BLOCK 1 — General
// Auto-save with debounce. Each field has its own debounced effect.
// ─────────────────────────────────────────────────────────────────
function GeneralBlock({ product, pq, setProduct, setProductContext, productHash, showToast }) {
  const [title,    setTitle]    = useState(product.title || '');
  const [subtitle, setSubtitle] = useState(product.subtitle || '');
  const [desc,     setDesc]     = useState(product.description || '');
  const [catId,    setCatId]    = useState(product.category_id ?? '');
  const [categories, setCategories] = useState([]);

  // Refs to skip the very first effect run (which would otherwise PUT the
  // exact same values back to the server immediately on mount).
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
      <h2 className="po-block-title">General</h2>
      <div className="po-block-card">
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
          <select className="crm-input crm-input-select po-input" value={catId}
            onChange={e => setCatId(e.target.value)}>
            <option value="">— Uncategorized —</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>
    </section>
  );
}

function Field({ label, children }) {
  return (
    <div className="po-field">
      <label className="po-field-label">{label}</label>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// BLOCK 2 — Variations (drag-and-drop, click opens ConfigurationModal)
// ─────────────────────────────────────────────────────────────────
function VariationsBlock({ product, productId, pq, reloadProduct, showToast }) {
  // Local copy so drag-and-drop reorders feel instant; persisted via reorder API.
  const [vars, setVars] = useState(product.variations || []);
  const [openVarId, setOpenVarId] = useState(null);
  const dragId = useRef(null);

  // Sync from props whenever the parent fetches fresh data
  useEffect(() => { setVars(product.variations || []); }, [product.variations]);

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
    // Simple inline create — modal opens immediately so the user can fill details
    const res = await fetch(`${API_BASE}/api/products/${productId}/variations${pq}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variation_name: 'New variation', image_url: null }),
    });
    if (!res.ok) { showToast('Create failed'); return; }
    const created = await res.json();
    setVars(prev => [...prev, { ...created, configurations: [] }]);
    setOpenVarId(created.id);
  };

  return (
    <section className="po-block">
      <div className="po-block-head">
        <h2 className="po-block-title">Variations</h2>
        <button className="po-add-pill" onClick={addVariation} type="button">
          <Plus weight="bold" /> Add variation
        </button>
      </div>

      <div className="po-block-card po-var-grid" onDrop={onDrop} onDragOver={e => e.preventDefault()}>
        {vars.length === 0 && (
          <div className="po-empty">
            No variations yet. Click <b>Add variation</b> — colors, sizes, options.
          </div>
        )}

        {vars.map(v => (
          <div key={v.id}
            className="po-var-card"
            draggable
            onDragStart={onDragStart(v.id)}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver(v.id)}
            onClick={() => setOpenVarId(v.id)}
            title="Click to configure">
            <div className="po-var-handle" title="Drag to reorder">
              <DotsSixVertical />
            </div>
            <div className="po-var-thumb-wrap">
              {v.image_url
                ? <img className="po-var-thumb" src={v.image_url} alt={v.variation_name} />
                : <div className="po-var-thumb-empty"><ImageIcon weight="duotone" /></div>}
            </div>
            <div className="po-var-name">{v.variation_name || 'Unnamed'}</div>
            <div className="po-var-meta">
              {v.configurations?.length || 0} {(v.configurations?.length || 0) === 1 ? 'config' : 'configs'}
            </div>
          </div>
        ))}
      </div>

      {openVarId != null && (
        <ConfigurationModal
          productId={productId}
          variation={vars.find(v => v.id === openVarId)}
          pq={pq}
          onClose={() => { setOpenVarId(null); reloadProduct(); }}
          onDeleted={() => {
            setVars(prev => prev.filter(v => v.id !== openVarId));
            setOpenVarId(null);
          }}
        />
      )}
    </section>
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
      <h2 className="po-block-title">Custom Fields</h2>
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
      <h2 className="po-block-title">SEO</h2>
      <p className="po-block-hint">Used by the storefront for search-engine results.</p>
      <div className="po-block-card">
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
