import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import { Plus, Trash } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { decodeHash } from '../../Utils/hashids.js';
import LayerBlock from './LayerBlock.jsx';
import SpecificationsBlock from './SpecificationsBlock.jsx';
import { CpmCategorySelect } from '../Project/Products/CreateProductModal.jsx';
import '../../Style/Authentication.css';
import '../../Style/Organization.css';
import '../../Style/Products.css';


export default function ProductOverview() {
  const { projectId, setProductContext } = useOutletContext();
  const { productHash } = useParams();
  const productId = decodeHash(productHash);
  const pq = `?project_id=${projectId}`;

  const [product,  setProduct]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [toast,    setToast]    = useState('');
  // Selected row id at each layer 1..5. chain[N-1] = id of selected row at layer N.
  const [chain, setChain] = useState([null, null, null, null, null]);
  // How many layers are visible. Min = max(1, backend max_layer); user expands via "Create new layer".
  const [shownLayers, setShownLayers] = useState(1);
  const toastRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(''), 2400);
  }, []);

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

  // Reset chain + shownLayers when navigating to a different product so
  // expansion state from product A doesn't leak into product B.
  useEffect(() => {
    setShownLayers(1);
    setChain([null, null, null, null, null]);
  }, [productId]);

  const reloadProduct = useCallback(async () => {
    const res = await fetch(`${API_BASE}/api/products/${productId}${pq}`, { credentials: 'include' });
    if (res.ok) setProduct(await res.json());
  }, [productId, pq]);

  // Sync shownLayers from backend's max_layer; auto-pick first row at each layer.
  useEffect(() => {
    if (!product) return;
    const maxLayer = product.max_layer || 1;
    setShownLayers(prev => Math.max(prev, maxLayer));
    setChain(prev => {
      const next = [...prev];
      let level = product.variations || [];
      const target = Math.max(maxLayer, prev.findIndex(x => x == null) + 1 || 1, 1);
      for (let i = 0; i < target && i < 5; i++) {
        if (!level || level.length === 0) { next[i] = null; continue; }
        const cur = next[i];
        let chosen = cur != null ? level.find(x => x.id === cur) : null;
        if (!chosen) chosen = level[0];
        next[i] = chosen ? chosen.id : null;
        level = chosen ? (i === 0 ? (chosen.configurations || []) : (chosen.children || [])) : [];
      }
      return next;
    });
  }, [product]); // eslint-disable-line react-hooks/exhaustive-deps

  // Walk the tree per chain → items at each layer + parent's effective_price for placeholder.
  const layers = useMemo(() => {
    if (!product) return null;
    const out = [{ items: product.variations || [], parentId: null, parentEffectivePrice: null }];
    let level = product.variations || [];
    for (let i = 0; i < 5; i++) {
      const sel = level.find(x => x.id === chain[i]);
      if (!sel) break;
      const nextItems = i === 0 ? (sel.configurations || []) : (sel.children || []);
      out.push({
        items: nextItems,
        parentId: sel.id,
        parentEffectivePrice: sel.effective_price ?? null,
      });
      level = nextItems;
    }
    return out;
  }, [product, chain]);

  const setChainAt = (level, id) => {
    setChain(prev => {
      const next = [...prev];
      next[level] = id;
      for (let i = level + 1; i < 5; i++) next[i] = null;
      return next;
    });
  };

  const createNewLayer = () => setShownLayers(n => Math.min(n + 1, 5));

  const deleteLastLayer = async () => {
    if (shownLayers <= 1) return;
    if (!confirm(`Delete entire Layer ${shownLayers}?\nAll rows at this layer will be lost. Carts/orders referencing them will break.`)) return;
    const res = await fetch(`${API_BASE}/api/products/${productId}/layers/${shownLayers}${pq}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (res.ok) {
      setShownLayers(prev => Math.max(prev - 1, 1));
      await reloadProduct();
    }
  };

  if (loading)  return <Shell><p className="crm-placeholder">Loading…</p></Shell>;
  if (notFound) return <Shell><p className="crm-placeholder">Product not found.</p></Shell>;

  const lastLayerSelected = chain[shownLayers - 1] != null;
  const canCreateNewLayer = shownLayers < 5 && lastLayerSelected;

  return (
    <Shell>
      <h1 className="crm-page-title">{product.title || 'Untitled'}</h1>

      <GeneralBlock product={product} pq={pq} setProduct={setProduct}
        setProductContext={setProductContext} productHash={productHash}
        showToast={showToast} />

      {layers && [1, 2, 3, 4, 5].map(n => {
        if (n > shownLayers) return null;
        const layerData = layers[n - 1];
        if (!layerData) return null;
        const isLeaf = n === shownLayers;
        const showDelete = n >= 2 && n === shownLayers;
        return (
          <LayerBlock key={n}
            layer={n}
            items={layerData.items}
            parentId={layerData.parentId}
            inheritedPrice={layerData.parentEffectivePrice}
            productId={productId} pq={pq}
            reloadProduct={reloadProduct}
            selectedId={chain[n - 1]}
            onSelect={(id) => setChainAt(n - 1, id)}
            isLeaf={isLeaf}
            onDeleteLayer={showDelete ? deleteLastLayer : null} />
        );
      })}

      {canCreateNewLayer && (
        <button className="po-add-layer-btn" type="button" onClick={createNewLayer}>
          <Plus weight="bold" /> Create Configuration Layer {shownLayers + 1}
        </button>
      )}

      <SpecificationsBlock
        product={product}
        productId={productId} pq={pq}
        chain={chain}
        shownLayers={shownLayers}
        reloadProduct={reloadProduct} />

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


// ─── Custom Fields ────────────────────────────────────────────────
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
  useEffect(() => { setValue(field.field_value ?? ''); skip.current = true; }, [field.field_value]);

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


// ─── SEO ──────────────────────────────────────────────────────────
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
