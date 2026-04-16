import { useState, useRef } from 'react';
import { Plus, UploadSimple } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import VariationCard from './VariationCard.jsx';

export default function VariationsTab({ product, productId, pq }) {
  const [variations,   setVariations]   = useState(product.variations || []);
  const [showVarForm,  setShowVarForm]  = useState(false);
  const [varName,      setVarName]      = useState('');
  const [varImg,       setVarImg]       = useState('');
  const [varUploading, setVarUploading] = useState(false);
  const [varDragging,  setVarDragging]  = useState(false);
  const [adding,       setAdding]       = useState(false);
  const [varErr,       setVarErr]       = useState('');
  const varFileRef = useRef();

  const uploadVarImg = async file => {
    if (!file || !file.type.startsWith('image/')) return;
    setVarUploading(true);
    const fd = new FormData(); fd.append('file', file);
    try {
      const res  = await fetch(`${API_BASE}/api/upload/image${pq}`, { method: 'POST', credentials: 'include', body: fd });
      const data = await res.json();
      if (res.ok) setVarImg(data.url); else alert(data.detail || 'Upload failed');
    } catch { alert('Upload failed'); }
    setVarUploading(false);
  };

  const addVariation = async e => {
    e.preventDefault();
    if (!varName.trim()) return setVarErr('Enter variation name');
    setAdding(true); setVarErr('');
    const res = await fetch(`${API_BASE}/api/products/${productId}/variations${pq}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variation_name: varName.trim(), image_url: varImg || null }),
    });
    const data = await res.json();
    if (!res.ok) { setVarErr(data.detail || 'Error'); setAdding(false); return; }
    setVariations(prev => [...prev, data]);
    setVarName(''); setVarImg(''); setShowVarForm(false); setAdding(false);
  };

  return (
    <div className="prod-tab-content">
      {variations.length === 0 && !showVarForm && (
        <div className="prod-empty-state">No variations yet. Add one to define colors, styles, etc.</div>
      )}

      {variations.map(v => (
        <VariationCard key={v.id} variation={v} productId={productId} pq={pq}
          onDeleted={id => setVariations(prev => prev.filter(x => x.id !== id))}
          onUpdated={upd => setVariations(prev => prev.map(x => x.id === upd.id ? upd : x))} />
      ))}

      <div className={`prod-form-wrap${showVarForm ? ' prod-form-wrap--open' : ''}`}>
        <form className="prod-new-var-form" onSubmit={addVariation}>
          <input className="prod-field-input" placeholder="Variation name (e.g. Black)"
            value={varName} onChange={e => setVarName(e.target.value)} />
          <input ref={varFileRef} type="file" accept="image/*" className="hidden-input"
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
                  <UploadSimple className="prod-dropzone-overlay-icon" /><span>Replace image</span>
                </div>
              </>
            ) : varUploading ? (
              <div className="prod-dropzone-empty"><div className="prod-dropzone-spinner" /><span>Uploading…</span></div>
            ) : (
              <div className="prod-dropzone-empty">
                <UploadSimple className="prod-dropzone-upload-icon" />
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

      <button className="crm-add-btn crm-add-btn--mt" onClick={() => { setShowVarForm(v => !v); setVarErr(''); }}>
        <Plus className="crm-add-btn-icon" />
        {showVarForm ? 'Cancel' : 'New Variation'}
      </button>
    </div>
  );
}
