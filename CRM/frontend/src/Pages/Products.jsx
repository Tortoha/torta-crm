import { useEffect, useRef, useState, useCallback } from 'react';
import {
  PlusIcon, TrashIcon, PencilIcon, EllipsisVerticalIcon,
  MagnifyingGlassIcon, XMarkIcon, CheckIcon, ChevronDownIcon,
  ChevronRightIcon, PhotoIcon, ArrowUpTrayIcon,
} from '@heroicons/react/24/solid';
import { StarIcon } from '@heroicons/react/24/solid';
import { API_BASE } from '../api.js';
import '../Style/Products.css';

// ── helpers ────────────────────────────────────────────────────

function SaveBtn({ saving, onClick, label = 'Save changes' }) {
  return (
    <button className="prod-save-btn" onClick={onClick} disabled={saving}>
      {saving ? 'Saving…' : label}
    </button>
  );
}

function InlineField({ label, value, onChange, type = 'text', placeholder = '', mono = false }) {
  return (
    <div className="prod-field">
      <label className="prod-field-label">{label}</label>
      <input
        className={`prod-field-input${mono ? ' prod-field-input--mono' : ''}`}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function TextareaField({ label, value, onChange, placeholder = '', rows = 4 }) {
  return (
    <div className="prod-field">
      <label className="prod-field-label">{label}</label>
      <textarea
        className="prod-field-textarea"
        rows={rows}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

// ── InfoTab ────────────────────────────────────────────────────

function InfoTab({ product, productId, onSaved }) {
  const [title,  setTitle]  = useState(product.title           || '');
  const [desc,   setDesc]   = useState(product.description     || '');
  const [chars,  setChars]  = useState(product.characteristics || '');
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  const save = async () => {
    setSaving(true);
    const res = await fetch(`${API_BASE}/api/products/${productId}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description: desc, characteristics: chars }),
    });
    if (res.ok) {
      setSaved(true); setTimeout(() => setSaved(false), 2000);
      onSaved({ title });
    }
    setSaving(false);
  };

  return (
    <div className="prod-tab-content">
      <InlineField label="Title" value={title} onChange={setTitle} placeholder="Product name" />
      <TextareaField label="Description" value={desc} onChange={setDesc} placeholder="Short description…" rows={3} />
      <TextareaField label="Characteristics" value={chars} onChange={setChars} placeholder="Material, features…" rows={5} />
      <div className="prod-tab-footer">
        {saved && <span className="prod-saved-hint">✓ Saved</span>}
        <SaveBtn saving={saving} onClick={save} />
      </div>
    </div>
  );
}

// ── SeoTab ─────────────────────────────────────────────────────

function SeoTab({ product, productId, onSaved }) {
  const [seoTitle, setSeoTitle]   = useState(product.seo_title       || '');
  const [seoDesc,  setSeoDesc]    = useState(product.seo_description  || '');
  const [seoKw,    setSeoKw]      = useState(product.seo_keywords     || '');
  const [saving,   setSaving]     = useState(false);
  const [saved,    setSaved]      = useState(false);

  const save = async () => {
    setSaving(true);
    const res = await fetch(`${API_BASE}/api/products/${productId}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seo_title: seoTitle, seo_description: seoDesc, seo_keywords: seoKw }),
    });
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); onSaved({}); }
    setSaving(false);
  };

  return (
    <div className="prod-tab-content">
      <p className="prod-tab-hint">SEO fields are used by the storefront for search engine visibility.</p>
      <InlineField label="SEO Title" value={seoTitle} onChange={setSeoTitle} placeholder="e.g. Buy Trousers Online" />
      <div className="prod-field">
        <label className="prod-field-label">SEO Description <span className="prod-char-count">{seoDesc.length}/160</span></label>
        <textarea
          className="prod-field-textarea"
          rows={3}
          value={seoDesc}
          onChange={e => setSeoDesc(e.target.value)}
          maxLength={160}
          placeholder="Brief page description for search results…"
        />
      </div>
      <InlineField label="Keywords" value={seoKw} onChange={setSeoKw} placeholder="trousers, pants, fashion" />
      <div className="prod-tab-footer">
        {saved && <span className="prod-saved-hint">✓ Saved</span>}
        <SaveBtn saving={saving} onClick={save} />
      </div>
    </div>
  );
}

// ── SizeRow ────────────────────────────────────────────────────

function SizeRow({ size, productId, varId, onDeleted, onUpdated }) {
  const [name,  setName]  = useState(size.size_name);
  const [price, setPrice] = useState(String(size.price));
  const [stock, setStock] = useState(String(size.stock_quantity));
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  const save = async () => {
    setSaving(true);
    await fetch(`${API_BASE}/api/products/${productId}/variations/${varId}/sizes/${size.id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ size_name: name, price: parseFloat(price) || 0, stock_quantity: parseInt(stock) || 0 }),
    });
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 1500);
    onUpdated({ ...size, size_name: name, price: parseFloat(price), stock_quantity: parseInt(stock) });
  };

  const del = async () => {
    if (!confirm('Delete this size?')) return;
    await fetch(`${API_BASE}/api/products/${productId}/variations/${varId}/sizes/${size.id}`,
      { method: 'DELETE', credentials: 'include' });
    onDeleted(size.id);
  };

  return (
    <tr className="prod-size-row">
      <td>
        <input className="prod-cell-input" value={name} onChange={e => setName(e.target.value)} />
      </td>
      <td>
        <input className="prod-cell-input prod-cell-input--num" type="number" min="0" step="0.01"
          value={price} onChange={e => setPrice(e.target.value)} />
      </td>
      <td>
        <input className="prod-cell-input prod-cell-input--num" type="number" min="0"
          value={stock} onChange={e => setStock(e.target.value)} />
      </td>
      <td className="prod-size-sold">{size.sold_quantity || 0}</td>
      <td>
        <div className="prod-size-actions">
          {saved
            ? <CheckIcon className="prod-check-icon" />
            : <button className="crm-icon-btn" title="Save" onClick={save} disabled={saving}>
                <CheckIcon className="crm-icon crm-icon--sm" style={{ color: saving ? '#ccc' : '#16a34a' }} />
              </button>
          }
          <button className="crm-icon-btn crm-icon-btn--danger" title="Delete" onClick={del}>
            <TrashIcon className="crm-icon crm-icon--sm" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── VariationCard ──────────────────────────────────────────────

function VariationCard({ variation, productId, onDeleted, onUpdated }) {
  const [open,       setOpen]       = useState(true);
  const [name,       setName]       = useState(variation.variation_name);
  const [imgUrl,     setImgUrl]     = useState(variation.image_url || '');
  const [uploading,  setUploading]  = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [sizes,      setSizes]      = useState(variation.sizes || []);
  const [dragging,   setDragging]   = useState(false);
  const fileRef = useRef();

  const uploadFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res  = await fetch(`${API_BASE}/api/upload/image`, { method: 'POST', credentials: 'include', body: fd });
      const data = await res.json();
      if (res.ok) { setImgUrl(data.url); }
      else alert(data.detail || 'Upload failed');
    } catch { alert('Upload failed'); }
    setUploading(false);
  };

  const handleImgUpload = (e) => uploadFile(e.target.files?.[0]);

  const handleDragOver = (e) => { e.preventDefault(); setDragging(true); };
  const handleDragLeave = () => setDragging(false);
  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    uploadFile(e.dataTransfer.files?.[0]);
  };

  // new size form
  const [showSizeForm, setShowSizeForm] = useState(false);
  const [newSizeName,  setNewSizeName]  = useState('');
  const [newSizePrice, setNewSizePrice] = useState('');
  const [newSizeStock, setNewSizeStock] = useState('0');
  const [addingSize,   setAddingSize]   = useState(false);

  const saveVariation = async () => {
    setSaving(true);
    await fetch(`${API_BASE}/api/products/${productId}/variations/${variation.id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variation_name: name, image_url: imgUrl || null }),
    });
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 1500);
    onUpdated({ ...variation, variation_name: name, image_url: imgUrl || null });
  };

  const deleteVariation = async () => {
    if (!confirm(`Delete variation "${name}" and all its sizes?`)) return;
    await fetch(`${API_BASE}/api/products/${productId}/variations/${variation.id}`,
      { method: 'DELETE', credentials: 'include' });
    onDeleted(variation.id);
  };

  const addSize = async (e) => {
    e.preventDefault();
    if (!newSizeName.trim()) return;
    setAddingSize(true);
    const res = await fetch(`${API_BASE}/api/products/${productId}/variations/${variation.id}/sizes`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        size_name:      newSizeName.trim(),
        price:          parseFloat(newSizePrice) || 0,
        stock_quantity: parseInt(newSizeStock) || 0,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setSizes(prev => [...prev, data]);
      setNewSizeName(''); setNewSizePrice(''); setNewSizeStock('0');
      setShowSizeForm(false);
    }
    setAddingSize(false);
  };

  return (
    <div className="prod-variation-card">
      {/* Header */}
      <div className="prod-var-header">
        <button className="prod-var-toggle" onClick={() => setOpen(v => !v)}>
          {open
            ? <ChevronDownIcon className="prod-var-chevron" />
            : <ChevronRightIcon className="prod-var-chevron" />}
        </button>
        <div className="prod-var-preview">
          {imgUrl
            ? <img src={imgUrl} alt={name} className="prod-var-img" />
            : <PhotoIcon className="prod-var-img-placeholder" />}
        </div>
        <span className="prod-var-title">{name || 'Unnamed'}</span>
        <span className="prod-var-sizes-count">{sizes.length} size{sizes.length !== 1 ? 's' : ''}</span>
        <button className="crm-icon-btn crm-icon-btn--danger" onClick={deleteVariation} title="Delete variation">
          <TrashIcon className="crm-icon crm-icon--sm" />
        </button>
      </div>

      {/* Body */}
      {open && (
        <div className="prod-var-body">
          <div className="prod-var-fields">
            <div className="prod-field prod-field--inline">
              <label className="prod-field-label">Name</label>
              <input className="prod-field-input" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="prod-field">
              <label className="prod-field-label">Image</label>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImgUpload} />
              <div
                className={`prod-dropzone${dragging ? ' prod-dropzone--over' : ''}${uploading ? ' prod-dropzone--loading' : ''}`}
                onClick={() => !uploading && fileRef.current.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {imgUrl ? (
                  <>
                    <img src={imgUrl} alt={name} className="prod-dropzone-preview" />
                    <div className="prod-dropzone-overlay">
                      <ArrowUpTrayIcon className="prod-dropzone-overlay-icon" />
                      <span>Replace image</span>
                    </div>
                  </>
                ) : uploading ? (
                  <div className="prod-dropzone-empty">
                    <div className="prod-dropzone-spinner" />
                    <span>Uploading…</span>
                  </div>
                ) : (
                  <div className="prod-dropzone-empty">
                    <ArrowUpTrayIcon className="prod-dropzone-upload-icon" />
                    <span className="prod-dropzone-title">Drop image here</span>
                    <span className="prod-dropzone-hint">or click to browse · WebP</span>
                  </div>
                )}
              </div>
            </div>
            <div className="prod-var-save-row">
              {saved && <span className="prod-saved-hint">✓ Saved</span>}
              <button className="prod-save-btn prod-save-btn--sm" onClick={saveVariation} disabled={saving}>
                {saving ? 'Saving…' : 'Save variation'}
              </button>
            </div>
          </div>

          {/* Sizes table */}
          {sizes.length > 0 && (
            <div className="prod-sizes-wrap">
              <table className="prod-sizes-table">
                <thead>
                  <tr>
                    <th>Size</th>
                    <th>Price ($)</th>
                    <th>Stock</th>
                    <th>Sold</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sizes.map(s => (
                    <SizeRow
                      key={s.id}
                      size={s}
                      productId={productId}
                      varId={variation.id}
                      onDeleted={sid => setSizes(prev => prev.filter(x => x.id !== sid))}
                      onUpdated={upd => setSizes(prev => prev.map(x => x.id === upd.id ? upd : x))}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Add size form */}
          <div className={`prod-form-wrap${showSizeForm ? ' prod-form-wrap--open' : ''}`}>
            <form className="prod-add-size-form" onSubmit={addSize}>
              <input className="prod-cell-input" placeholder="Size (S/M/L…)"
                value={newSizeName} onChange={e => setNewSizeName(e.target.value)} />
              <input className="prod-cell-input prod-cell-input--num" type="number" placeholder="Price"
                min="0" step="0.01" value={newSizePrice} onChange={e => setNewSizePrice(e.target.value)} />
              <input className="prod-cell-input prod-cell-input--num" type="number" placeholder="Stock"
                min="0" value={newSizeStock} onChange={e => setNewSizeStock(e.target.value)} />
              <button className="prod-save-btn prod-save-btn--sm" type="submit" disabled={addingSize}>Add</button>
              <button className="crm-icon-btn" type="button" onClick={() => setShowSizeForm(false)}>
                <XMarkIcon className="crm-icon crm-icon--sm" />
              </button>
            </form>
          </div>

          <button className="prod-add-size-btn" onClick={() => setShowSizeForm(v => !v)}>
            <PlusIcon className="prod-add-size-icon" />
            {showSizeForm ? 'Cancel' : 'Add size'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── VariationsTab ──────────────────────────────────────────────

function VariationsTab({ product, productId, onSaved }) {
  const [variations,    setVariations]    = useState(product.variations || []);
  const [showVarForm,   setShowVarForm]   = useState(false);
  const [varName,       setVarName]       = useState('');
  const [varImg,        setVarImg]        = useState('');
  const [varUploading,  setVarUploading]  = useState(false);
  const [varDragging,   setVarDragging]   = useState(false);
  const [adding,        setAdding]        = useState(false);
  const [varErr,        setVarErr]        = useState('');
  const varFileRef = useRef();

  const uploadVarImg = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setVarUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res  = await fetch(`${API_BASE}/api/upload/image`, { method: 'POST', credentials: 'include', body: fd });
      const data = await res.json();
      if (res.ok) setVarImg(data.url);
      else alert(data.detail || 'Upload failed');
    } catch { alert('Upload failed'); }
    setVarUploading(false);
  };

  const addVariation = async (e) => {
    e.preventDefault();
    if (!varName.trim()) return setVarErr('Enter variation name');
    setAdding(true); setVarErr('');
    const res = await fetch(`${API_BASE}/api/products/${productId}/variations`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variation_name: varName.trim(), image_url: varImg || null }),
    });
    const data = await res.json();
    if (!res.ok) { setVarErr(data.detail || 'Error'); setAdding(false); return; }
    setVariations(prev => [...prev, data]);
    setVarName(''); setVarImg(''); setShowVarForm(false);
    setAdding(false);
  };

  return (
    <div className="prod-tab-content">
      {variations.length === 0 && !showVarForm && (
        <div className="prod-empty-state">No variations yet. Add one to define colors, styles, etc.</div>
      )}

      {variations.map(v => (
        <VariationCard
          key={v.id}
          variation={v}
          productId={productId}
          onDeleted={id => setVariations(prev => prev.filter(x => x.id !== id))}
          onUpdated={upd => setVariations(prev => prev.map(x => x.id === upd.id ? upd : x))}
        />
      ))}

      {/* New variation form */}
      <div className={`prod-form-wrap${showVarForm ? ' prod-form-wrap--open' : ''}`}>
        <form className="prod-new-var-form" onSubmit={addVariation}>
          <input className="prod-field-input" placeholder="Variation name (e.g. Black)"
            value={varName} onChange={e => setVarName(e.target.value)} />

          <input ref={varFileRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => uploadVarImg(e.target.files?.[0])} />
          <div
            className={`prod-dropzone${varDragging ? ' prod-dropzone--over' : ''}${varUploading ? ' prod-dropzone--loading' : ''}`}
            onClick={() => !varUploading && varFileRef.current.click()}
            onDragOver={e => { e.preventDefault(); setVarDragging(true); }}
            onDragLeave={() => setVarDragging(false)}
            onDrop={e => { e.preventDefault(); setVarDragging(false); uploadVarImg(e.dataTransfer.files?.[0]); }}
          >
            {varImg ? (
              <>
                <img src={varImg} alt="variation" className="prod-dropzone-preview" />
                <div className="prod-dropzone-overlay">
                  <ArrowUpTrayIcon className="prod-dropzone-overlay-icon" />
                  <span>Replace image</span>
                </div>
              </>
            ) : varUploading ? (
              <div className="prod-dropzone-empty">
                <div className="prod-dropzone-spinner" />
                <span>Uploading…</span>
              </div>
            ) : (
              <div className="prod-dropzone-empty">
                <ArrowUpTrayIcon className="prod-dropzone-upload-icon" />
                <span className="prod-dropzone-title">Drop image here</span>
                <span className="prod-dropzone-hint">or click to browse · WebP</span>
              </div>
            )}
          </div>

          {varErr && <span className="crm-form-error">{varErr}</span>}
          <button className="prod-save-btn" type="submit" disabled={adding}>
            {adding ? 'Adding…' : 'Add variation'}
          </button>
        </form>
      </div>

      <button className="crm-add-btn" style={{ marginTop: 12 }}
        onClick={() => { setShowVarForm(v => !v); setVarErr(''); }}>
        <PlusIcon className="crm-add-btn-icon" />
        {showVarForm ? 'Cancel' : 'New Variation'}
      </button>
    </div>
  );
}

// ── CustomFieldsTab ────────────────────────────────────────────

function CustomFieldsTab({ product, productId }) {
  const [fields,   setFields]   = useState(product.custom_fields || []);
  const [showForm, setShowForm] = useState(false);
  const [newKey,   setNewKey]   = useState('');
  const [newVal,   setNewVal]   = useState('');
  const [newType,  setNewType]  = useState('string');
  const [newGlobal,setNewGlobal]= useState(false);
  const [adding,   setAdding]   = useState(false);
  const [err,      setErr]      = useState('');

  const saveField = async (e) => {
    e.preventDefault();
    if (!newKey.trim()) return setErr('Key is required');
    setAdding(true); setErr('');
    const res = await fetch(`${API_BASE}/api/products/${productId}/custom-fields`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field_key: newKey.trim(), field_value: newVal, field_type: newType, is_global: newGlobal }),
    });
    const data = await res.json();
    if (!res.ok) { setErr(data.detail || 'Error'); setAdding(false); return; }
    const newEntry = { field_key: data.field_key, field_value: newVal, field_type: newType, is_global: newGlobal };
    setFields(prev => {
      const idx = prev.findIndex(f => f.field_key === data.field_key);
      return idx >= 0 ? prev.map((f, i) => i === idx ? newEntry : f) : [...prev, newEntry];
    });
    setNewKey(''); setNewVal(''); setNewType('string'); setNewGlobal(false); setShowForm(false);
    setAdding(false);
  };

  const deleteField = async (key) => {
    if (!confirm(`Delete field "${key}"?`)) return;
    await fetch(`${API_BASE}/api/products/${productId}/custom-fields/${encodeURIComponent(key)}`,
      { method: 'DELETE', credentials: 'include' });
    setFields(prev => prev.filter(f => f.field_key !== key));
  };

  const toggleGlobal = async (key) => {
    const res  = await fetch(`${API_BASE}/api/products/${productId}/custom-fields/${encodeURIComponent(key)}/global`,
      { method: 'PATCH', credentials: 'include' });
    const data = await res.json();
    if (res.ok) setFields(prev => prev.map(f => f.field_key === key ? { ...f, is_global: data.is_global } : f));
  };

  return (
    <div className="prod-tab-content">
      <p className="prod-tab-hint">
        Custom fields appear in the storefront API. Toggle <strong>Global</strong> to share a field across all products in this project.
      </p>

      {fields.length > 0 && (
        <div className="prod-cf-table-wrap">
          <table className="prod-cf-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
                <th>Type</th>
                <th>Global</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {fields.map(f => (
                <tr key={f.field_key} className="prod-cf-row">
                  <td><code className="prod-cf-key">{f.field_key}</code></td>
                  <td className="prod-cf-val">{f.field_value ?? '—'}</td>
                  <td><span className="prod-type-badge">{f.field_type}</span></td>
                  <td>
                    <button
                      className={`prod-cf-toggle${f.is_global ? ' prod-cf-toggle--on' : ''}`}
                      onClick={() => toggleGlobal(f.field_key)}
                      title={f.is_global ? 'Global (click to make local)' : 'Local (click to make global)'}
                    />
                  </td>
                  <td>
                    <button className="crm-icon-btn crm-icon-btn--danger" onClick={() => deleteField(f.field_key)}>
                      <TrashIcon className="crm-icon crm-icon--sm" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {fields.length === 0 && !showForm && (
        <div className="prod-empty-state">No custom fields yet.</div>
      )}

      <div className={`prod-form-wrap${showForm ? ' prod-form-wrap--open' : ''}`}>
        <form className="prod-cf-form" onSubmit={saveField}>
          <input className="prod-field-input prod-field-input--mono" placeholder="field_key"
            value={newKey} onChange={e => setNewKey(e.target.value)} />
          <input className="prod-field-input" placeholder="value"
            value={newVal} onChange={e => setNewVal(e.target.value)} />
          <select className="prod-field-input crm-input-select" value={newType} onChange={e => setNewType(e.target.value)}>
            <option value="string">string</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
            <option value="json">json</option>
          </select>
          <label className="prod-cf-global-label">
            <button
              type="button"
              className={`prod-cf-toggle${newGlobal ? ' prod-cf-toggle--on' : ''}`}
              onClick={() => setNewGlobal(v => !v)}
            />
            Global field
          </label>
          {err && <span className="crm-form-error">{err}</span>}
          <button className="prod-save-btn" type="submit" disabled={adding}>
            {adding ? 'Adding…' : 'Add field'}
          </button>
        </form>
      </div>

      <button className="crm-add-btn" style={{ marginTop: 12 }}
        onClick={() => { setShowForm(v => !v); setErr(''); }}>
        <PlusIcon className="crm-add-btn-icon" />
        {showForm ? 'Cancel' : 'New Field'}
      </button>
    </div>
  );
}

// ── ReviewsTab ─────────────────────────────────────────────────

function ReviewsTab({ product }) {
  const reviews = product.reviews || [];

  if (reviews.length === 0)
    return (
      <div className="prod-tab-content">
        <div className="prod-empty-state">No reviews yet.</div>
      </div>
    );

  return (
    <div className="prod-tab-content">
      <div className="prod-reviews-list">
        {reviews.map(r => (
          <div key={r.id} className="prod-review-card">
            <div className="prod-review-header">
              <span className="prod-review-author">{r.user_name}</span>
              <div className="prod-review-stars">
                {[1,2,3,4,5].map(n => (
                  <StarIcon key={n} className={`prod-star${n <= r.rating ? ' prod-star--on' : ''}`} />
                ))}
              </div>
              <span className="prod-review-date">
                {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
            {r.comment && <p className="prod-review-comment">{r.comment}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ApiPreviewTab ──────────────────────────────────────────────

function ApiPreviewTab({ product }) {
  const firstVariation = (product.variations || [])[0];
  const firstSize      = firstVariation?.sizes?.[0];

  const preview = {
    id:    product.id,
    hash:  `[hashid of ${product.id}]`,
    title: product.title,
    price: firstSize?.price ?? 0,
    image: firstVariation?.image_url ?? null,
    seo_title:       product.seo_title       || null,
    seo_description: product.seo_description || null,
    seo_keywords:    product.seo_keywords    || null,
    custom_fields: Object.fromEntries(
      (product.custom_fields || []).map(f => [f.field_key, f.field_value])
    ),
  };

  const productPagePreview = {
    id:               product.id,
    product_hash:     `[hashid of ${product.id}]`,
    title:            product.title,
    description:      product.description       || '',
    characteristics:  product.characteristics   || '',
    seo_title:        product.seo_title          || null,
    seo_description:  product.seo_description    || null,
    seo_keywords:     product.seo_keywords       || null,
    custom_fields:    Object.fromEntries(
      (product.custom_fields || []).map(f => [f.field_key, f.field_value])
    ),
    is_authenticated: false,
    is_favorite:      false,
    can_review:       false,
    reviews_count:    (product.reviews || []).length,
    average_rating:   0,
    variations: (product.variations || []).map(v => ({
      id:             v.id,
      variation_name: v.variation_name,
      image:          v.image_url,
      sizes: (v.sizes || []).map(s => ({
        id:             s.id,
        size_name:      s.size_name,
        price:          s.price,
        stock_quantity: s.stock_quantity,
      })),
    })),
    reviews: (product.reviews || []).slice(0, 2).map(r => ({
      id: r.id, user_name: r.user_name, rating: r.rating, comment: r.comment,
    })),
  };

  return (
    <div className="prod-tab-content">
      <p className="prod-tab-hint">
        Preview of what your storefront API returns for this product. Actual values are live data.
      </p>

      <div className="prod-api-section">
        <div className="prod-api-endpoint">
          <span className="prod-api-method">GET</span>
          <code className="prod-api-url">/{'{api_key}'}/api-products</code>
          <span className="prod-api-desc">— item in the array</span>
        </div>
        <pre className="prod-api-json">{JSON.stringify(preview, null, 2)}</pre>
      </div>

      <div className="prod-api-section">
        <div className="prod-api-endpoint">
          <span className="prod-api-method">GET</span>
          <code className="prod-api-url">/{'{api_key}'}/api/product/{'{hash}'}</code>
          <span className="prod-api-desc">— full product page</span>
        </div>
        <pre className="prod-api-json">{JSON.stringify(productPagePreview, null, 2)}</pre>
      </div>
    </div>
  );
}

// ── ProductDrawer ──────────────────────────────────────────────

const TABS = ['Info', 'Variations', 'SEO', 'Custom Fields', 'API Preview', 'Reviews'];

function ProductDrawer({ open, loading, product, onClose, onSaved, onCreated }) {
  const [activeTab, setActiveTab] = useState('Info');
  const [localTitle, setLocalTitle] = useState('');

  // New product form
  const [newTitle,   setNewTitle]   = useState('');
  const [creating,   setCreating]   = useState(false);
  const [createErr,  setCreateErr]  = useState('');

  useEffect(() => {
    if (product) setLocalTitle(product.title || '');
    setActiveTab('Info');
  }, [product?.id]);

  const createProduct = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return setCreateErr('Title is required');
    setCreating(true); setCreateErr('');
    const res = await fetch(`${API_BASE}/api/products`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle.trim() }),
    });
    const data = await res.json();
    if (!res.ok) { setCreateErr(data.detail || 'Error'); setCreating(false); return; }
    setNewTitle('');
    onCreated(data);
    setCreating(false);
  };

  const isNew = product && product.id === null;

  return (
    <div className={`prod-drawer${open ? ' prod-drawer--open' : ''}`}>
      {/* Drawer header */}
      <div className="prod-drawer-head">
        <div className="prod-drawer-title">
          {loading
            ? <span className="prod-drawer-loading">Loading…</span>
            : isNew
              ? <span>New Product</span>
              : <span className="prod-drawer-product-name">{localTitle || 'Product'}</span>
          }
        </div>
        <button className="crm-icon-btn" onClick={onClose} title="Close">
          <XMarkIcon className="crm-icon" />
        </button>
      </div>

      {loading && <div className="prod-drawer-spinner" />}

      {/* New product: just title form */}
      {!loading && isNew && (
        <div className="prod-tab-content">
          <p className="prod-tab-hint">Enter a title to create the product, then you can add variations, SEO, etc.</p>
          <form onSubmit={createProduct}>
            <InlineField label="Title" value={newTitle} onChange={setNewTitle} placeholder="Product name" />
            {createErr && <span className="crm-form-error">{createErr}</span>}
            <div className="prod-tab-footer">
              <SaveBtn saving={creating} onClick={createProduct} label="Create product" />
            </div>
          </form>
        </div>
      )}

      {/* Existing product: tabs */}
      {!loading && product && !isNew && (
        <>
          <div className="prod-drawer-tabs">
            {TABS.map(t => (
              <button
                key={t}
                className={`prod-drawer-tab${activeTab === t ? ' prod-drawer-tab--active' : ''}`}
                onClick={() => setActiveTab(t)}
              >
                {t}
                {t === 'Variations' && product.variations?.length > 0 &&
                  <span className="prod-tab-badge">{product.variations.length}</span>}
                {t === 'Reviews' && product.reviews?.length > 0 &&
                  <span className="prod-tab-badge">{product.reviews.length}</span>}
                {t === 'Custom Fields' && product.custom_fields?.length > 0 &&
                  <span className="prod-tab-badge">{product.custom_fields.length}</span>}
              </button>
            ))}
          </div>

          <div className="prod-drawer-body">
            {activeTab === 'Info'          && <InfoTab         product={product} productId={product.id} onSaved={u => { if (u.title) setLocalTitle(u.title); onSaved({ ...product, ...u }); }} />}
            {activeTab === 'Variations'    && <VariationsTab   product={product} productId={product.id} onSaved={onSaved} />}
            {activeTab === 'SEO'           && <SeoTab          product={product} productId={product.id} onSaved={u => onSaved({ ...product, ...u })} />}
            {activeTab === 'Custom Fields' && <CustomFieldsTab product={product} productId={product.id} />}
            {activeTab === 'API Preview'   && <ApiPreviewTab   product={product} />}
            {activeTab === 'Reviews'       && <ReviewsTab      product={product} />}
          </div>
        </>
      )}
    </div>
  );
}

// ── ProductRow ─────────────────────────────────────────────────

function ProductRow({ p, selected, menuId, setMenuId, menuRef, onOpen, onDelete }) {
  const priceLabel =
    p.min_price === 0 && p.max_price === 0 ? '—'
    : p.min_price === p.max_price          ? `$${p.min_price.toFixed(0)}`
    :                                        `$${p.min_price.toFixed(0)}–${p.max_price.toFixed(0)}`;

  return (
    <tr
      className={`prod-tr${selected ? ' prod-tr--selected' : ''}`}
      onClick={onOpen}
    >
      <td className="prod-td prod-td--id">{p.id}</td>
      <td className="prod-td prod-td--title">{p.title}</td>
      <td className="prod-td prod-td--num">{p.variations_count || '—'}</td>
      <td className="prod-td prod-td--num">{p.total_stock > 0 ? p.total_stock : '—'}</td>
      <td className="prod-td prod-td--num">{priceLabel}</td>
      <td className="prod-td prod-td--num">
        {p.reviews_count > 0
          ? <span className="prod-rating"><StarIcon className="prod-star prod-star--on prod-star--sm" /> {p.avg_rating.toFixed(1)}</span>
          : '—'}
      </td>
      <td className="prod-td prod-td--act" onClick={e => e.stopPropagation()}>
        <div className="prod-menu-wrap" ref={menuId === p.id ? menuRef : null}>
          <button className="crm-icon-btn"
            onClick={() => setMenuId(menuId === p.id ? null : p.id)} title="Options">
            <EllipsisVerticalIcon className="crm-icon" />
          </button>
          {menuId === p.id && (
            <div className="api-drop-menu">
              <button className="api-drop-item" onClick={() => { onOpen(); setMenuId(null); }}>
                <PencilIcon className="api-drop-icon" /> Edit
              </button>
              <button className="api-drop-item api-drop-item--danger" onClick={() => { onDelete(); setMenuId(null); }}>
                <TrashIcon className="api-drop-icon" /> Delete
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Products (main page) ───────────────────────────────────────

function Products() {
  const [products,     setProducts]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [selectedId,   setSelectedId]   = useState(null);
  const [showDrawer,   setShowDrawer]   = useState(false);
  const [drawerProduct,setDrawerProduct]= useState(null);
  const [drawerLoading,setDrawerLoading]= useState(false);
  const [menuId,       setMenuId]       = useState(null);
  const menuRef = useRef();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/api/products`, { credentials: 'include' });
      const data = await res.json();
      setProducts(Array.isArray(data) ? data : []);
    } catch { setProducts([]); }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    window.addEventListener('api-key-switched', load);
    return () => window.removeEventListener('api-key-switched', load);
  }, [load]);

  // Close context menu on outside click
  useEffect(() => {
    const h = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuId(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const openDrawer = async (id) => {
    setSelectedId(id);
    setShowDrawer(true);
    setDrawerLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/api/products/${id}`, { credentials: 'include' });
      const data = await res.json();
      setDrawerProduct(res.ok ? data : null);
    } catch { setDrawerProduct(null); }
    setDrawerLoading(false);
  };

  const closeDrawer = () => {
    setShowDrawer(false);
    setSelectedId(null);
    setDrawerProduct(null);
  };

  const openNewDrawer = () => {
    setSelectedId(null);
    setDrawerProduct({ id: null, title: '', description: '', characteristics: '',
      seo_title: '', seo_description: '', seo_keywords: '',
      variations: [], custom_fields: [], reviews: [] });
    setShowDrawer(true);
  };

  const deleteProduct = async (id) => {
    if (!confirm('Delete this product? All variations, sizes and reviews will also be deleted.')) return;
    await fetch(`${API_BASE}/api/products/${id}`, { method: 'DELETE', credentials: 'include' });
    if (selectedId === id) closeDrawer();
    load();
  };

  const filtered = products.filter(p =>
    !search || p.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="prod-page">
      {/* Page header */}
      <div className="prod-page-head">
        <h1 className="crm-page-title" style={{ paddingTop: 0 }}>Products</h1>
        <div className="prod-toolbar">
          <div className="prod-search-wrap">
            <MagnifyingGlassIcon className="prod-search-icon" />
            <input
              className="prod-search"
              placeholder="Search products…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button className="crm-add-btn" onClick={openNewDrawer}>
            <PlusIcon className="crm-add-btn-icon" /> New Product
          </button>
        </div>
      </div>

      {/* Table */}
      <div className={`prod-table-card${showDrawer ? ' prod-table-card--shrink' : ''}`}>
        <div className="prod-table-wrap">
          <table className="prod-table">
            <thead>
              <tr>
                <th className="prod-th prod-th--id">ID</th>
                <th className="prod-th">Title</th>
                <th className="prod-th prod-th--num">Variations</th>
                <th className="prod-th prod-th--num">Stock</th>
                <th className="prod-th prod-th--num">Price</th>
                <th className="prod-th prod-th--num">Rating</th>
                <th className="prod-th prod-th--act" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="prod-td-empty">Loading…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="prod-td-empty">
                    {search ? 'No products match your search.' : 'No products yet. Click "New Product" to add one.'}
                  </td>
                </tr>
              )}
              {filtered.map(p => (
                <ProductRow
                  key={p.id}
                  p={p}
                  selected={selectedId === p.id}
                  menuId={menuId}
                  setMenuId={setMenuId}
                  menuRef={menuRef}
                  onOpen={() => openDrawer(p.id)}
                  onDelete={() => deleteProduct(p.id)}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer row count */}
        {!loading && (
          <div className="prod-table-footer">
            {filtered.length} product{filtered.length !== 1 ? 's' : ''}
            {search && products.length !== filtered.length && ` of ${products.length}`}
          </div>
        )}
      </div>

      {/* Backdrop */}
      <div className={`prod-backdrop${showDrawer ? ' prod-backdrop--open' : ''}`} onClick={closeDrawer} />

      {/* Drawer */}
      <ProductDrawer
        open={showDrawer}
        loading={drawerLoading}
        product={drawerProduct}
        onClose={closeDrawer}
        onSaved={(updated) => {
          setDrawerProduct(updated);
          load();
        }}
        onCreated={(newProduct) => {
          load();
          openDrawer(newProduct.id);
        }}
      />
    </div>
  );
}

export default Products;
