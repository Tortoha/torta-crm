import { useState } from 'react';
import { API_BASE } from '../../api.js';
import { SaveBtn, InlineField } from './shared.jsx';

export default function SeoTab({ product, productId, pq }) {
  const [seoTitle, setSeoTitle] = useState(product.seo_title       || '');
  const [seoDesc,  setSeoDesc]  = useState(product.seo_description || '');
  const [seoKw,    setSeoKw]    = useState(product.seo_keywords    || '');
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);

  const save = async () => {
    setSaving(true);
    const res = await fetch(`${API_BASE}/api/products/${productId}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seo_title: seoTitle, seo_description: seoDesc, seo_keywords: seoKw }),
    });
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
    setSaving(false);
  };

  return (
    <div className="prod-tab-content">
      <p className="prod-tab-hint">SEO fields are used by the storefront for search engine visibility.</p>
      <InlineField label="SEO Title" value={seoTitle} onChange={setSeoTitle} placeholder="e.g. Buy Trousers Online" />
      <div className="prod-field">
        <label className="prod-field-label">
          SEO Description <span className="prod-char-count">{seoDesc.length}/160</span>
        </label>
        <textarea
          className="prod-field-textarea" rows={3} value={seoDesc}
          onChange={e => setSeoDesc(e.target.value)} maxLength={160}
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
