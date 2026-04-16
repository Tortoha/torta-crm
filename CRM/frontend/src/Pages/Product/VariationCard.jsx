import { useState, useRef } from 'react';
import { CaretDown, CaretRight, Image, UploadSimple, Plus, Trash, X } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import SizeRow from './SizeRow.jsx';

export default function VariationCard({ variation, productId, pq, onDeleted, onUpdated }) {
  const [open,      setOpen]      = useState(true);
  const [name,      setName]      = useState(variation.variation_name);
  const [imgUrl,    setImgUrl]    = useState(variation.image_url || '');
  const [uploading, setUploading] = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [sizes,     setSizes]     = useState(variation.sizes || []);
  const [dragging,  setDragging]  = useState(false);

  const [showSizeForm,  setShowSizeForm]  = useState(false);
  const [newSizeName,   setNewSizeName]   = useState('');
  const [newSizePrice,  setNewSizePrice]  = useState('');
  const [newSizeStock,  setNewSizeStock]  = useState('0');
  const [addingSize,    setAddingSize]    = useState(false);
  const fileRef = useRef();

  const uploadFile = async file => {
    if (!file || !file.type.startsWith('image/')) return;
    setUploading(true);
    const fd = new FormData(); fd.append('file', file);
    try {
      const res  = await fetch(`${API_BASE}/api/upload/image${pq}`, { method: 'POST', credentials: 'include', body: fd });
      const data = await res.json();
      if (res.ok) setImgUrl(data.url); else alert(data.detail || 'Upload failed');
    } catch { alert('Upload failed'); }
    setUploading(false);
  };

  const saveVariation = async () => {
    setSaving(true);
    await fetch(`${API_BASE}/api/products/${productId}/variations/${variation.id}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variation_name: name, image_url: imgUrl || null }),
    });
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 1500);
    onUpdated({ ...variation, variation_name: name, image_url: imgUrl || null });
  };

  const deleteVariation = async () => {
    if (!confirm(`Delete variation "${name}" and all its sizes?`)) return;
    await fetch(`${API_BASE}/api/products/${productId}/variations/${variation.id}${pq}`,
      { method: 'DELETE', credentials: 'include' });
    onDeleted(variation.id);
  };

  const addSize = async e => {
    e.preventDefault();
    if (!newSizeName.trim()) return;
    setAddingSize(true);
    const res = await fetch(`${API_BASE}/api/products/${productId}/variations/${variation.id}/sizes${pq}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ size_name: newSizeName.trim(), price: parseFloat(newSizePrice) || 0, stock_quantity: parseInt(newSizeStock) || 0 }),
    });
    const data = await res.json();
    if (res.ok) {
      setSizes(prev => [...prev, data]);
      setNewSizeName(''); setNewSizePrice(''); setNewSizeStock('0'); setShowSizeForm(false);
    }
    setAddingSize(false);
  };

  return (
    <div className="prod-variation-card">
      <div className="prod-var-header">
        <button className="prod-var-toggle" onClick={() => setOpen(v => !v)}>
          {open ? <CaretDown className="prod-var-chevron" /> : <CaretRight className="prod-var-chevron" />}
        </button>
        <div className="prod-var-preview">
          {imgUrl ? <img src={imgUrl} alt={name} className="prod-var-img" /> : <Image className="prod-var-img-placeholder" />}
        </div>
        <span className="prod-var-title">{name || 'Unnamed'}</span>
        <span className="prod-var-sizes-count">{sizes.length} size{sizes.length !== 1 ? 's' : ''}</span>
        <button className="crm-icon-btn crm-icon-btn--danger" onClick={deleteVariation} title="Delete variation">
          <Trash className="crm-icon crm-icon--sm" />
        </button>
      </div>

      {open && (
        <div className="prod-var-body">
          <div className="prod-var-fields">
            <div className="prod-field prod-field--inline">
              <label className="prod-field-label">Name</label>
              <input className="prod-field-input" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="prod-field">
              <label className="prod-field-label">Image</label>
              <input ref={fileRef} type="file" accept="image/*" className="hidden-input"
                onChange={e => uploadFile(e.target.files?.[0])} />
              <div
                className={`prod-dropzone${dragging ? ' prod-dropzone--over' : ''}${uploading ? ' prod-dropzone--loading' : ''}`}
                onClick={() => !uploading && fileRef.current.click()}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => { e.preventDefault(); setDragging(false); uploadFile(e.dataTransfer.files?.[0]); }}
              >
                {imgUrl ? (
                  <>
                    <img src={imgUrl} alt={name} className="prod-dropzone-preview" />
                    <div className="prod-dropzone-overlay">
                      <UploadSimple className="prod-dropzone-overlay-icon" /><span>Replace image</span>
                    </div>
                  </>
                ) : uploading ? (
                  <div className="prod-dropzone-empty"><div className="prod-dropzone-spinner" /><span>Uploading…</span></div>
                ) : (
                  <div className="prod-dropzone-empty">
                    <UploadSimple className="prod-dropzone-upload-icon" />
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

          {sizes.length > 0 && (
            <div className="prod-sizes-wrap">
              <table className="prod-sizes-table">
                <thead><tr><th>Size</th><th>Price ($)</th><th>Stock</th><th>Sold</th><th></th></tr></thead>
                <tbody>
                  {sizes.map(s => (
                    <SizeRow key={s.id} size={s} productId={productId} varId={variation.id} pq={pq}
                      onDeleted={sid => setSizes(prev => prev.filter(x => x.id !== sid))}
                      onUpdated={upd => setSizes(prev => prev.map(x => x.id === upd.id ? upd : x))} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

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
                <X className="crm-icon crm-icon--sm" />
              </button>
            </form>
          </div>

          <button className="prod-add-size-btn" onClick={() => setShowSizeForm(v => !v)}>
            <Plus className="prod-add-size-icon" />
            {showSizeForm ? 'Cancel' : 'Add size'}
          </button>
        </div>
      )}
    </div>
  );
}
