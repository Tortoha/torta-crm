import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Plus, Trash, UploadSimple, Image as ImageIcon } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';

export default function ConfigurationModal({ productId, variation, pq, onClose, onDeleted }) {
  const [name,    setName]    = useState(variation?.variation_name || '');
  const [imgUrl,  setImgUrl]  = useState(variation?.image_url || '');
  const [configs, setConfigs] = useState(variation?.configurations || []);
  const [uploading, setUploading] = useState(false);
  const [dragging,  setDragging]  = useState(false);
  const [err,     setErr]     = useState('');
  const fileRef = useRef();
  const skipName = useRef(true);

  // Debounced name save
  useEffect(() => {
    if (skipName.current) { skipName.current = false; return; }
    const trimmed = name.trim();
    if (!trimmed) return;  // empty → don't save (validation below blocks blur too)
    const t = setTimeout(() => saveVariation({ variation_name: trimmed }), 400);
    return () => clearTimeout(t);
  }, [name]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc closes
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!variation) return null;

  const saveVariation = async (patch) => {
    const res = await fetch(`${API_BASE}/api/products/${productId}/variations/${variation.id}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) setErr('Save failed'); else setErr('');
  };

  const uploadFile = async (file) => {
    if (!file || !file.type?.startsWith('image/')) return;
    setUploading(true);
    const fd = new FormData(); fd.append('file', file);
    try {
      const res = await fetch(`${API_BASE}/api/upload/image${pq}`, { method: 'POST', credentials: 'include', body: fd });
      const data = await res.json();
      if (res.ok) {
        setImgUrl(data.url);
        await saveVariation({ image_url: data.url });
      } else {
        setErr(data.detail || 'Upload failed');
      }
    } catch {
      setErr('Upload failed');
    }
    setUploading(false);
  };

  const deleteVariation = async () => {
    if (!confirm(`Delete variation "${name}" and all its configurations?`)) return;
    const res = await fetch(`${API_BASE}/api/products/${productId}/variations/${variation.id}${pq}`,
      { method: 'DELETE', credentials: 'include' });
    if (res.ok) onDeleted?.();
  };

  const updateConfig = useCallback((cfgId, patch) => {
    setConfigs(prev => prev.map(c => c.id === cfgId ? { ...c, ...patch } : c));
  }, []);

  const removeConfig = async (cfgId) => {
    if (!confirm('Delete this configuration?')) return;
    const res = await fetch(`${API_BASE}/api/products/${productId}/variations/${variation.id}/configurations/${cfgId}${pq}`,
      { method: 'DELETE', credentials: 'include' });
    if (res.ok) setConfigs(prev => prev.filter(c => c.id !== cfgId));
  };

  return createPortal(
    <div className="auth-modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="auth-modal cfg-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">Edit variation</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">Changes are saved automatically.</span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body cfg-modal-body">
          {/* ── Top: name + image side-by-side ─────────────────── */}
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
              <p className="cfg-hint">
                A variation groups configurations that share an image — like a colour
                that comes in S/M/L, or a pizza style that comes in 30/40/50 cm.
              </p>
            </div>
          </div>

          {/* ── Configurations list ──────────────────────────────── */}
          <div className="cfg-list">
            <div className="cfg-list-head">
              <span className="cfg-col cfg-col-name">Configuration</span>
              <span className="cfg-col cfg-col-price">Price</span>
              <span className="cfg-col cfg-col-stock">Stock</span>
              <span className="cfg-col cfg-col-sold">Sold</span>
              <span className="cfg-col cfg-col-actions" />
            </div>

            {configs.length === 0 && (
              <div className="cfg-empty">
                No configurations yet. Add one below — e.g. <i>S / M / L</i>, <i>30 cm / 40 cm</i>, <i>0.5 L / 1 L</i>.
              </div>
            )}

            {configs.map(c => (
              <CfgRow key={c.id} cfg={c} productId={productId} variationId={variation.id} pq={pq}
                onChange={updateConfig} onDelete={() => removeConfig(c.id)} />
            ))}

            <CfgNewRow productId={productId} variationId={variation.id} pq={pq}
              onAdded={(created) => setConfigs(prev => [...prev, created])} />
          </div>

          {err && <span className="crm-form-error">{err}</span>}

          <div className="cfg-footer">
            <button className="crm-submit-btn auth-btn-danger" type="button" onClick={deleteVariation}>
              <Trash weight="bold" style={{ marginRight: 6, verticalAlign: 'middle' }} />
              Delete variation
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─────────────────────────────────────────────────────────────────
// Single configuration row — debounced auto-save on each field
// ─────────────────────────────────────────────────────────────────
function CfgRow({ cfg, productId, variationId, pq, onChange, onDelete }) {
  const [name,  setName]  = useState(cfg.configuration_name);
  const [price, setPrice] = useState(String(cfg.price));
  const [stock, setStock] = useState(String(cfg.stock_quantity));
  const skip = useRef(true);

  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    const t = setTimeout(async () => {
      const body = {
        configuration_name: name.trim() || cfg.configuration_name,
        price: parseFloat(price) || 0,
        stock_quantity: parseInt(stock, 10) || 0,
      };
      await fetch(`${API_BASE}/api/products/${productId}/variations/${variationId}/configurations/${cfg.id}${pq}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      onChange(cfg.id, body);
    }, 400);
    return () => clearTimeout(t);
  }, [name, price, stock]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="cfg-row">
      <input className="crm-input cfg-cell cfg-col-name" value={name}
        onChange={e => setName(e.target.value)} placeholder="S / 30cm / 1L" />
      <input className="crm-input cfg-cell cfg-col-price" type="number" min="0" step="0.01"
        value={price} onChange={e => setPrice(e.target.value)} />
      <input className="crm-input cfg-cell cfg-col-stock" type="number" min="0"
        value={stock} onChange={e => setStock(e.target.value)} />
      <span className="cfg-cell cfg-col-sold cfg-sold-num">{cfg.sold_quantity || 0}</span>
      <button type="button" className="cfg-cell cfg-col-actions cfg-delete-btn" onClick={onDelete} title="Delete">
        <Trash />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// "Add new configuration" row — only persists on Enter / Add click
// (so users don't accidentally create empty rows by tabbing through)
// ─────────────────────────────────────────────────────────────────
function CfgNewRow({ productId, variationId, pq, onAdded }) {
  const [name,  setName]  = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [busy,  setBusy]  = useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const res = await fetch(`${API_BASE}/api/products/${productId}/variations/${variationId}/configurations${pq}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        configuration_name: name.trim(),
        price: parseFloat(price) || 0,
        stock_quantity: parseInt(stock, 10) || 0,
      }),
    });
    setBusy(false);
    if (!res.ok) return;
    const data = await res.json();
    onAdded(data);
    setName(''); setPrice(''); setStock('');
  };

  return (
    <form className="cfg-row cfg-row--new" onSubmit={submit}>
      <input className="crm-input cfg-cell cfg-col-name" value={name}
        onChange={e => setName(e.target.value)} placeholder="New configuration" />
      <input className="crm-input cfg-cell cfg-col-price" type="number" min="0" step="0.01"
        value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" />
      <input className="crm-input cfg-cell cfg-col-stock" type="number" min="0"
        value={stock} onChange={e => setStock(e.target.value)} placeholder="0" />
      <span className="cfg-cell cfg-col-sold" />
      <button type="submit" className="cfg-cell cfg-col-actions cfg-add-btn" disabled={busy || !name.trim()}>
        <Plus weight="bold" />
      </button>
    </form>
  );
}
