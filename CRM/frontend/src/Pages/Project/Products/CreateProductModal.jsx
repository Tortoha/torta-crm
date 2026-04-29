import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { X, Plus, Trash, UploadSimple, Image as ImageIcon } from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';

/**
 * Replacement for the old right-side <NewProductDrawer>. Lets the user fill
 * in everything that matters in one go — title, subtitle, description,
 * category, plus an optional list of variations with their configurations
 * — so they don't have to navigate to the detail page just to flesh things out.
 *
 * Only the "Create" button persists anything. Until the user clicks it,
 * variations + configurations are kept in client-side state. On click we run:
 *
 *   1. POST  /api/products                                  (basic fields + category)
 *   2. POST  /api/products/{id}/variations                  (per variation)
 *      └─ if there's an image_url → already passed in step 2
 *      └─ POST /api/products/{id}/variations/{vid}/configurations  (per config)
 *
 * On any failure the partially-created product is left as-is — the user lands
 * on the detail page where they can finish filling in. (Better than rolling
 * back, which would erase the parts that did succeed.)
 */
export default function CreateProductModal({ open, pq, onClose, onCreated }) {
  const [title,    setTitle]    = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [desc,     setDesc]     = useState('');
  const [catId,    setCatId]    = useState('');
  const [variations, setVariations] = useState([]);  // [{tmpId, name, image_url, configurations: [{tmpId, name, price, stock}]}]
  const [categories, setCategories] = useState([]);
  const [busy,     setBusy]     = useState(false);
  const [err,      setErr]      = useState('');

  // Reset form whenever the modal opens
  useEffect(() => {
    if (!open) return;
    setTitle(''); setSubtitle(''); setDesc(''); setCatId('');
    setVariations([]); setBusy(false); setErr('');
    fetch(`${API_BASE}/api/categories${pq}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setCategories(Array.isArray(d) ? d : []))
      .catch(() => setCategories([]));
  }, [open, pq]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // ── Variation manipulators ──────────────────────────────────
  const addVariation = () => {
    const tmpId = Date.now() + Math.random();
    setVariations(prev => [...prev, { tmpId, name: '', image_url: '', configurations: [] }]);
  };
  const updateVariation = (tmpId, patch) => {
    setVariations(prev => prev.map(v => v.tmpId === tmpId ? { ...v, ...patch } : v));
  };
  const removeVariation = (tmpId) => {
    setVariations(prev => prev.filter(v => v.tmpId !== tmpId));
  };
  const addConfig = (varTmpId) => {
    const tmpId = Date.now() + Math.random();
    updateVariation(varTmpId, { configurations: [
      ...(variations.find(v => v.tmpId === varTmpId)?.configurations || []),
      { tmpId, name: '', price: '', stock: '' },
    ] });
  };
  const updateConfig = (varTmpId, cfgTmpId, patch) => {
    setVariations(prev => prev.map(v => v.tmpId !== varTmpId ? v : {
      ...v,
      configurations: v.configurations.map(c => c.tmpId === cfgTmpId ? { ...c, ...patch } : c),
    }));
  };
  const removeConfig = (varTmpId, cfgTmpId) => {
    setVariations(prev => prev.map(v => v.tmpId !== varTmpId ? v : {
      ...v,
      configurations: v.configurations.filter(c => c.tmpId !== cfgTmpId),
    }));
  };

  const submit = async (e) => {
    e?.preventDefault();
    const t = title.trim();
    if (!t) return setErr('Title is required');
    setErr(''); setBusy(true);
    try {
      // 1) Create the base product
      const res = await fetch(`${API_BASE}/api/products${pq}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: t,
          subtitle: subtitle.trim() || null,
          description: desc.trim() || null,
          category_id: catId === '' ? null : Number(catId),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.detail || 'Create failed'); setBusy(false); return; }

      // 2) Create variations + their configurations sequentially (small N, simpler than Promise.all + ordering)
      for (const v of variations) {
        const name = v.name.trim();
        if (!name) continue;
        const vRes = await fetch(`${API_BASE}/api/products/${data.id}/variations${pq}`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variation_name: name, image_url: v.image_url || null }),
        });
        if (!vRes.ok) continue;
        const vData = await vRes.json();
        for (const c of (v.configurations || [])) {
          if (!c.name.trim()) continue;
          await fetch(`${API_BASE}/api/products/${data.id}/variations/${vData.id}/configurations${pq}`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              configuration_name: c.name.trim(),
              price: parseFloat(c.price) || 0,
              stock_quantity: parseInt(c.stock, 10) || 0,
            }),
          });
        }
      }

      onCreated(data);
    } catch {
      setErr('Network error');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="auth-modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="auth-modal cpm-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">New product</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  Fill in basics now or later — you can add variations after creation too.
                </span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body cpm-body">
          <form onSubmit={submit}>
            {/* ── Basics ──────────────────────────────────────── */}
            <div className="cpm-section">
              <label className="po-field-label">Title</label>
              <input className="crm-input" autoFocus value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Product name" maxLength={200} />
            </div>
            <div className="cpm-section">
              <label className="po-field-label">Subtitle</label>
              <input className="crm-input" value={subtitle}
                onChange={e => setSubtitle(e.target.value)}
                placeholder="Short tagline shown under the title" maxLength={300} />
            </div>
            <div className="cpm-section">
              <label className="po-field-label">Description</label>
              <textarea className="crm-input cpm-textarea" rows={4} value={desc}
                onChange={e => setDesc(e.target.value)}
                placeholder="Long body text — materials, features…" />
            </div>
            <div className="cpm-section">
              <label className="po-field-label">Category</label>
              <select className="crm-input crm-input-select" value={catId}
                onChange={e => setCatId(e.target.value)}>
                <option value="">— Uncategorized —</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            {/* ── Variations (optional) ───────────────────────── */}
            <div className="cpm-section cpm-vars-section">
              <div className="cpm-vars-head">
                <label className="po-field-label" style={{ margin: 0 }}>Variations</label>
                <button type="button" className="po-add-pill" onClick={addVariation}>
                  <Plus weight="bold" /> Add variation
                </button>
              </div>

              {variations.length === 0 && (
                <p className="cpm-empty">
                  Optional — colors, sizes, options. Skip this and add later from the product page.
                </p>
              )}

              {variations.map(v => (
                <CpmVariationDraft key={v.tmpId} v={v} pq={pq}
                  onChange={(patch) => updateVariation(v.tmpId, patch)}
                  onRemove={() => removeVariation(v.tmpId)}
                  onAddConfig={() => addConfig(v.tmpId)}
                  onConfigChange={(cfgTmpId, patch) => updateConfig(v.tmpId, cfgTmpId, patch)}
                  onConfigRemove={(cfgTmpId) => removeConfig(v.tmpId, cfgTmpId)} />
              ))}
            </div>

            {err && <span className="crm-form-error">{err}</span>}

            <div className="auth-actions">
              <button className="crm-submit-btn" type="submit" disabled={busy}>
                {busy ? 'Creating…' : 'Create product'}
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

// ─── Single draft variation (in modal, not yet persisted) ─────
function CpmVariationDraft({ v, pq, onChange, onRemove, onAddConfig, onConfigChange, onConfigRemove }) {
  const fileRef = useRef();
  const [uploading, setUploading] = useState(false);

  const upload = async (file) => {
    if (!file || !file.type?.startsWith('image/')) return;
    setUploading(true);
    const fd = new FormData(); fd.append('file', file);
    try {
      const res = await fetch(`${API_BASE}/api/upload/image${pq}`, { method: 'POST', credentials: 'include', body: fd });
      const data = await res.json();
      if (res.ok) onChange({ image_url: data.url });
    } catch {}
    setUploading(false);
  };

  return (
    <div className="cpm-var-card">
      <div className="cpm-var-head">
        <div className="cpm-var-thumb-wrap" onClick={() => !uploading && fileRef.current?.click()}>
          <input ref={fileRef} type="file" accept="image/*" className="hidden-input"
            onChange={e => upload(e.target.files?.[0])} />
          {v.image_url ? (
            <img src={v.image_url} alt={v.name} className="cpm-var-thumb" />
          ) : uploading ? (
            <div className="cpm-var-thumb-empty"><div className="cfg-dropzone-spinner" /></div>
          ) : (
            <div className="cpm-var-thumb-empty"><ImageIcon weight="duotone" /></div>
          )}
        </div>
        <input className="crm-input cpm-var-name" value={v.name}
          onChange={e => onChange({ name: e.target.value })}
          placeholder="Variation name (e.g. Black)" maxLength={100} />
        <button type="button" className="cpm-var-delete" onClick={onRemove} title="Remove variation">
          <Trash />
        </button>
      </div>

      {v.configurations.length > 0 && (
        <div className="cpm-cfg-list">
          {v.configurations.map(c => (
            <div key={c.tmpId} className="cpm-cfg-row">
              <input className="crm-input" placeholder="Configuration (S / 30cm)"
                value={c.name} onChange={e => onConfigChange(c.tmpId, { name: e.target.value })} />
              <input className="crm-input" type="number" min="0" step="0.01" placeholder="Price"
                value={c.price} onChange={e => onConfigChange(c.tmpId, { price: e.target.value })} />
              <input className="crm-input" type="number" min="0" placeholder="Stock"
                value={c.stock} onChange={e => onConfigChange(c.tmpId, { stock: e.target.value })} />
              <button type="button" className="cpm-cfg-delete" onClick={() => onConfigRemove(c.tmpId)} title="Remove">
                <Trash />
              </button>
            </div>
          ))}
        </div>
      )}

      <button type="button" className="po-add-row-btn cpm-add-cfg-btn" onClick={onAddConfig}>
        <Plus weight="bold" /> Add configuration
      </button>
    </div>
  );
}
