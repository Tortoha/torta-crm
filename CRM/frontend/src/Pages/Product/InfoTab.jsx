import { useState } from 'react';
import { API_BASE } from '../../api.js';
import { SaveBtn, InlineField, TextareaField } from './shared.jsx';

export default function InfoTab({ product, productId, pq, onSaved }) {
  const [title,  setTitle]  = useState(product.title           || '');
  const [desc,   setDesc]   = useState(product.description     || '');
  const [chars,  setChars]  = useState(product.characteristics || '');
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  const save = async () => {
    setSaving(true);
    const res = await fetch(`${API_BASE}/api/products/${productId}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description: desc, characteristics: chars }),
    });
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); onSaved?.({ title }); }
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
