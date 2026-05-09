// Product Settings — debounced auto-save blocks for catalog, shipping, B2B, pre-order, OG image, tax.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext, useParams } from 'react-router-dom';
import { API_BASE } from '../../api.js';
import { decodeHash } from '../../Utils/hashids.js';
import { Combobox } from '../Project/Booking/BookingCreateModal.jsx';
import { DateTimePicker } from '../../Utils/DateTimePicker.jsx';
import '../../Style/Authentication.css';
import '../../Style/Products.css';

const SHIPPING_CLASS_OPTIONS = [
  { value: 'standard',   label: 'Standard' },
  { value: 'fragile',    label: 'Fragile' },
  { value: 'oversized',  label: 'Oversized' },
  { value: 'hazmat',     label: 'Hazmat' },
  { value: 'perishable', label: 'Perishable' },
];

export default function ProductSettings() {
  const { projectId, setProductContext } = useOutletContext();
  const { productHash } = useParams();
  const productId = decodeHash(productHash);
  const pq = `?project_id=${projectId}`;

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [taxCats, setTaxCats] = useState([]);
  const [toast, setToast] = useState('');
  const toastRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(''), 2400);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, tc] = await Promise.all([
        fetch(`${API_BASE}/api/products/${productId}${pq}`, { credentials: 'include' }).then(r => r.ok ? r.json() : null),
        fetch(`${API_BASE}/api/tax-categories${pq}`,        { credentials: 'include' }).then(r => r.ok ? r.json() : []),
      ]);
      setProduct(p);
      setTaxCats(Array.isArray(tc) ? tc : []);
      if (p) setProductContext?.({ name: p.title, hash: productHash });
    } finally { setLoading(false); }
  }, [productId, pq, productHash, setProductContext]);

  useEffect(() => { load(); return () => setProductContext?.(null); }, [load]); // eslint-disable-line

  const saveProduct = useCallback(async (body) => {
    const r = await fetch(`${API_BASE}/api/products/${productId}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      setProduct(p => p ? { ...p, ...body } : p);
      showToast('Saved');
    } else { showToast('Save failed'); }
    return r.ok;
  }, [productId, pq, showToast]);

  if (loading) return <p className="crm-placeholder">Loading…</p>;
  if (!product) return <p className="crm-placeholder">Product not found.</p>;

  return (
    <div className="prod-page po-page">
      <h1 className="crm-page-title">Settings · {product.title}</h1>

      <CatalogBlock product={product} save={saveProduct} taxCats={taxCats} />
      <PerSkuBlock product={product} pq={pq} showToast={showToast} />
      <ShippingBlock product={product} save={saveProduct} />
      <InventoryBlock product={product} save={saveProduct} />
      <B2BBlock product={product} save={saveProduct} />
      <SocialBlock product={product} save={saveProduct} />

      {toast && createPortal(
        <div className="auth-toast">{toast}</div>,
        document.body,
      )}
    </div>
  );
}

// ── Reusable debounced text input that auto-saves on change ──────────
function FieldText({ label, hint, value, onSave, type = 'text', placeholder, maxLength }) {
  const [v, setV] = useState(value ?? '');
  const skip = useRef(true);
  useEffect(() => { skip.current = true; setV(value ?? ''); }, [value]);
  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    const t = setTimeout(() => { onSave(v); }, 500);
    return () => clearTimeout(t);
  }, [v]); // eslint-disable-line
  return (
    <label className="po-set-field">
      <span className="po-set-label">{label}</span>
      <input className="crm-input po-set-input" type={type}
        value={v} placeholder={placeholder} maxLength={maxLength}
        onChange={e => setV(e.target.value)} />
      {hint && <span className="po-set-hint">{hint}</span>}
    </label>
  );
}

function FieldNumber({ label, hint, value, onSave, min = 0, max, step = 1 }) {
  const [v, setV] = useState(String(value ?? 0));
  const skip = useRef(true);
  useEffect(() => { skip.current = true; setV(String(value ?? 0)); }, [value]);
  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    const t = setTimeout(() => { onSave(parseInt(v, 10) || 0); }, 500);
    return () => clearTimeout(t);
  }, [v]); // eslint-disable-line
  return (
    <label className="po-set-field">
      <span className="po-set-label">{label}</span>
      <input className="crm-input po-set-input" type="number"
        min={min} max={max} step={step}
        value={v} onChange={e => setV(e.target.value)} />
      {hint && <span className="po-set-hint">{hint}</span>}
    </label>
  );
}

// Custom date+time picker; wrapped in <div> so label-click doesn't fight popover click-outside.
function FieldDateTime({ label, hint, value, onSave }) {
  return (
    <div className="po-set-field">
      <span className="po-set-label">{label}</span>
      <DateTimePicker value={value || ''} onChange={onSave} />
      {hint && <span className="po-set-hint">{hint}</span>}
    </div>
  );
}

// Shared `.cat-prod-checkbox` style — borderless, 18×18, accent fill with thin SVG check.
function FieldToggle({ label, hint, value, onSave }) {
  return (
    <label className="po-set-field po-set-field--toggle">
      <input type="checkbox" className="cat-prod-checkbox"
        checked={!!value} onChange={e => onSave(e.target.checked)} />
      <span className="po-set-toggle-text">{label}</span>
      {hint && <span className="po-set-hint">{hint}</span>}
    </label>
  );
}

// Float-friendly FieldNumber that distinguishes "" (null) from 0 — for nullable per-SKU fields.
function FieldNumberOpt({ label, hint, value, onSave, step = 1, min = 0 }) {
  const [v, setV] = useState(value === null || value === undefined ? '' : String(value));
  const skip = useRef(true);
  useEffect(() => {
    skip.current = true;
    setV(value === null || value === undefined ? '' : String(value));
  }, [value]);
  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    const t = setTimeout(() => {
      const trimmed = v.trim();
      if (trimmed === '') { onSave(null); return; }
      const n = parseFloat(trimmed);
      if (!isNaN(n)) onSave(n);
    }, 500);
    return () => clearTimeout(t);
  }, [v]); // eslint-disable-line
  return (
    <label className="po-set-field">
      <span className="po-set-label">{label}</span>
      <input className="crm-input po-set-input" type="number"
        min={min} step={step}
        value={v} placeholder="—"
        onChange={e => setV(e.target.value)} />
      {hint && <span className="po-set-hint">{hint}</span>}
    </label>
  );
}

// ── Per-SKU details — combobox + form for the selected leaf SKU ─────
function PerSkuBlock({ product, pq, showToast }) {
  const leafs = useMemo(() => {
    const out = [];
    for (const v of (product.variations || [])) {
      const vName = v.variation_name || v.name || '—';
      for (const c of (v.configurations || [])) {
        out.push({
          id: c.id,
          label: `${vName} / ${c.configuration_name || c.name || '—'}`,
          data: c,
        });
      }
    }
    return out;
  }, [product]);

  const [selectedId, setSelectedId] = useState(leafs[0]?.id ?? null);
  const [overrides, setOverrides]   = useState({});

  useEffect(() => {
    if (selectedId === null && leafs.length > 0) setSelectedId(leafs[0].id);
  }, [leafs, selectedId]);

  const sku = useMemo(() => {
    const base = leafs.find(l => l.id === selectedId)?.data;
    if (!base) return null;
    return { ...base, ...(overrides[selectedId] || {}) };
  }, [leafs, selectedId, overrides]);

  const saveSkuField = useCallback(async (field, value) => {
    if (!selectedId) return;
    const r = await fetch(`${API_BASE}/api/products/${product.id}/layers/2/${selectedId}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    if (r.ok) {
      setOverrides(prev => ({
        ...prev,
        [selectedId]: { ...(prev[selectedId] || {}), [field]: value },
      }));
      showToast('Saved');
    } else {
      showToast('Save failed');
    }
  }, [product.id, pq, selectedId, showToast]);

  if (leafs.length === 0) {
    return (
      <section className="po-block">
        <h2 className="po-block-title">Per-SKU details</h2>
        <p className="po-block-hint">
          Add at least one Layer-2 configuration on the product Overview page
          to start editing per-SKU details (barcode, weight, dimensions,
          per-SKU pricing).
        </p>
      </section>
    );
  }

  return (
    <section className="po-block">
      <h2 className="po-block-title">Per-SKU details</h2>
      <p className="po-block-hint">
        Each leaf configuration has its own SKU code, barcode, weight,
        dimensions and pricing options. Pick one below to edit.
      </p>
      <label className="po-set-field" style={{ maxWidth: 480 }}>
        <span className="po-set-label">Configuration</span>
        <div className="po-cb-wrap">
          <Combobox value={selectedId}
            options={leafs.map(l => ({ value: l.id, label: l.label }))}
            onChange={(v) => setSelectedId(Number(v))} />
        </div>
      </label>

      {sku && (
        <div className="po-set-grid" style={{ marginTop: 12 }}>
          <FieldText key={`sku-${sku.id}`} label="SKU code"
            hint="Internal code (auto-generated, override if needed)"
            value={sku.sku_code || ''} maxLength={80}
            onSave={v => saveSkuField('sku_code', v)} />
          <FieldText key={`bc-${sku.id}`} label="Barcode"
            hint="EAN-13 / UPC printed on this specific SKU"
            value={sku.barcode || ''} maxLength={80}
            onSave={v => saveSkuField('barcode', v)} />
          <FieldNumberOpt key={`w-${sku.id}`} label="Weight (g)"
            hint="Used by carrier-API rate calculation"
            value={sku.weight_g} step={0.01}
            onSave={v => saveSkuField('weight_g', v)} />
          <FieldNumberOpt key={`l-${sku.id}`} label="Length (cm)"
            value={sku.length_cm} step={0.1}
            onSave={v => saveSkuField('length_cm', v)} />
          <FieldNumberOpt key={`wd-${sku.id}`} label="Width (cm)"
            value={sku.width_cm} step={0.1}
            onSave={v => saveSkuField('width_cm', v)} />
          <FieldNumberOpt key={`h-${sku.id}`} label="Height (cm)"
            value={sku.height_cm} step={0.1}
            onSave={v => saveSkuField('height_cm', v)} />
          <FieldNumberOpt key={`cap-${sku.id}`} label="Compare-at price"
            hint="Strike-through original price when on sale"
            value={sku.compare_at_price} step={0.01}
            onSave={v => saveSkuField('compare_at_price', v)} />
          <FieldNumberOpt key={`cp-${sku.id}`} label="Cost price"
            hint="Internal margin / profit calculation"
            value={sku.cost_price} step={0.01}
            onSave={v => saveSkuField('cost_price', v)} />
          <FieldNumberOpt key={`sp-${sku.id}`} label="Sale price"
            hint="Active price during the sale window"
            value={sku.sale_price} step={0.01}
            onSave={v => saveSkuField('sale_price', v)} />
          <FieldDateTime key={`ss-${sku.id}`} label="Sale starts at"
            value={(sku.sale_starts_at || '').slice(0, 16)}
            onSave={v => saveSkuField('sale_starts_at', v || null)} />
          <FieldDateTime key={`se-${sku.id}`} label="Sale ends at"
            value={(sku.sale_ends_at || '').slice(0, 16)}
            onSave={v => saveSkuField('sale_ends_at', v || null)} />
        </div>
      )}
    </section>
  );
}

// ── Catalog identification ──────────────────────────────────────────
function CatalogBlock({ product, save, taxCats }) {
  return (
    <section className="po-block">
      <h2 className="po-block-title">Catalog identification</h2>
      <p className="po-block-hint">
        Inventory codes, brand info, customs / origin. Used by accountants,
        warehouse staff, and regulatory exports (HS code, country of origin).
      </p>
      <div className="po-set-grid">
        <FieldText label="SKU" hint="Human-readable identifier (e.g. TSH-RED-001)"
          value={product.sku} maxLength={80}
          onSave={v => save({ sku: v })} />
        <FieldText label="Barcode" hint="EAN-13 / UPC for POS scanners"
          value={product.barcode} maxLength={80}
          onSave={v => save({ barcode: v })} />
        <FieldText label="Brand" hint="Top-level brand for storefront filters"
          value={product.brand} maxLength={120}
          onSave={v => save({ brand: v })} />
        <FieldText label="Manufacturer" hint="Who actually makes it (may differ from brand)"
          value={product.manufacturer} maxLength={120}
          onSave={v => save({ manufacturer: v })} />
        <FieldText label="Vendor / Supplier" hint="Who you buy it from (internal use)"
          value={product.vendor} maxLength={120}
          onSave={v => save({ vendor: v })} />
        <FieldText label="Country of origin" hint="2-letter ISO or full name"
          value={product.country_of_origin} maxLength={80}
          onSave={v => save({ country_of_origin: v })} />
        <FieldText label="HS code" hint="Harmonised System code for customs"
          value={product.hs_code} maxLength={20}
          onSave={v => save({ hs_code: v })} />
        <label className="po-set-field">
          <span className="po-set-label">Tax category</span>
          <div className="po-cb-wrap">
            <Combobox
              value={product.tax_category_id ?? ''}
              placeholder="— None —"
              options={[
                { value: '', label: '— None —' },
                ...taxCats.map(t => ({ value: t.id, label: `${t.name} (${t.rate}%)` })),
              ]}
              onChange={(v) => save({ tax_category_id: v === '' ? null : Number(v) })}
            />
          </div>
          <span className="po-set-hint">Configure list in Project Settings → Tax categories</span>
        </label>
      </div>
    </section>
  );
}

// ── Shipping ────────────────────────────────────────────────────────
function ShippingBlock({ product, save }) {
  return (
    <section className="po-block">
      <h2 className="po-block-title">Shipping & fulfillment</h2>
      <p className="po-block-hint">
        Controls used by carrier-API rate calculation and checkout shipping options.
      </p>
      <div className="po-set-grid">
        <FieldToggle label="Requires shipping" hint="Off for self-pickup / digital"
          value={product.requires_shipping}
          onSave={v => save({ requires_shipping: v })} />
        <FieldToggle label="Ships internationally"
          hint="Off blocks foreign-address checkout"
          value={product.ships_internationally}
          onSave={v => save({ ships_internationally: v })} />
        <label className="po-set-field">
          <span className="po-set-label">Shipping class</span>
          <div className="po-cb-wrap">
            <Combobox
              value={product.shipping_class || 'standard'}
              options={SHIPPING_CLASS_OPTIONS}
              onChange={(v) => save({ shipping_class: v })}
            />
          </div>
          <span className="po-set-hint">Carrier API uses this for surcharges</span>
        </label>
        <FieldNumber label="Lead time (days)"
          hint="Days from order to ship-out (made-to-order)"
          value={product.lead_time_days} min={0} max={365}
          onSave={v => save({ lead_time_days: v })} />
      </div>
    </section>
  );
}

// ── Inventory thresholds + flags ────────────────────────────────────
function InventoryBlock({ product, save }) {
  return (
    <section className="po-block">
      <h2 className="po-block-title">Inventory behaviour</h2>
      <p className="po-block-hint">
        Stock-out behaviour and alert thresholds. Per-SKU stock is edited
        on the Overview / Inventory pages.
      </p>
      <div className="po-set-grid">
        <FieldToggle label="Continue selling when out of stock"
          hint="Backorder mode — checkout never blocks on stock=0"
          value={product.continue_selling_oos}
          onSave={v => save({ continue_selling_oos: v })} />
        <FieldNumber label="Low-stock threshold"
          hint="Alert when total stock drops to this level (0 = off)"
          value={product.low_stock_threshold} min={0}
          onSave={v => save({ low_stock_threshold: v })} />
        <FieldToggle label="Pre-order"
          hint="Listed but not yet released — uses release date below"
          value={product.is_pre_order}
          onSave={v => save({ is_pre_order: v })} />
        <FieldDateTime label="Pre-order release at"
          hint="Storefront shows 'Ships from {date}'"
          value={(product.pre_order_release_at || '').slice(0, 16)}
          onSave={v => save({ pre_order_release_at: v || null })} />
      </div>
    </section>
  );
}

// ── B2B fields ──────────────────────────────────────────────────────
function B2BBlock({ product, save }) {
  return (
    <section className="po-block">
      <h2 className="po-block-title">B2B / Wholesale</h2>
      <p className="po-block-hint">
        Minimum quantity, increments, and B2B payment options. Tier pricing
        ladders are configured in Products → Tier pricing.
      </p>
      <div className="po-set-grid">
        <FieldNumber label="Minimum order quantity (MOQ)"
          hint="Cart blocks orders smaller than this"
          value={product.moq} min={1}
          onSave={v => save({ moq: Math.max(1, v) })} />
        <FieldNumber label="Order increment"
          hint="Quantity must be MOQ + N × increment (e.g. dozen-pack)"
          value={product.order_increment} min={1}
          onSave={v => save({ order_increment: Math.max(1, v) })} />
        <FieldNumber label="Net terms (days)"
          hint="0 = pay immediately; 30 = invoice with 30-day terms"
          value={product.net_terms_days} min={0} max={180}
          onSave={v => save({ net_terms_days: v })} />
        <FieldToggle label="Allow Purchase Orders"
          hint="Customer can pay via PO# instead of card"
          value={product.allow_po}
          onSave={v => save({ allow_po: v })} />
      </div>
    </section>
  );
}

// ── Social / SEO image ──────────────────────────────────────────────
function SocialBlock({ product, save }) {
  return (
    <section className="po-block">
      <h2 className="po-block-title">Social preview</h2>
      <p className="po-block-hint">
        URL of the image used by Facebook / Twitter / Telegram link previews
        (Open Graph tags). Falls back to the first variation cover if empty.
      </p>
      <div className="po-set-grid">
        <FieldText label="Open Graph image URL"
          hint="HTTPS URL to a 1200×630 image (Facebook/Twitter recommended)"
          value={product.og_image_url || ''} maxLength={1000}
          onSave={v => save({ og_image_url: v || null })} />
      </div>
      {product.og_image_url && (
        <div className="po-og-preview">
          <img src={product.og_image_url} alt="OG preview" className="po-og-img" />
        </div>
      )}
    </section>
  );
}
