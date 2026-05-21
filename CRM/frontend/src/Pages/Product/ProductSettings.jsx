// Product Settings — bulk-style (Section + FieldCard, save-on-change) mirroring
// Project Settings / Products Settings. Catalog, per-SKU, shipping, inventory,
// B2B and social blocks; every field auto-saves on change with a toast.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Barcode, Cube, Truck, Package, Buildings, ImageSquare } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { decodeHash } from '../../Utils/hashids.js';
import { DateTimePicker } from '../../Utils/DateTimePicker.jsx';
import { Section, FieldCard, SegmentSwitch, SearchableCombobox } from '../Project/ProjectSettings.jsx';
import '../../Style/Authentication.css';
import '../../Style/Products.css';

const SHIPPING_CLASS_VALUES = ['standard', 'fragile', 'oversized', 'hazmat', 'perishable'];

export default function ProductSettings() {
  const { t } = useTranslation();
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
      showToast(t('productDetail.settings.saved'));
    } else { showToast(t('productDetail.settings.saveFailed')); }
    return r.ok;
  }, [productId, pq, showToast, t]);

  if (loading) return <p className="crm-placeholder">{t('common.loading')}</p>;
  if (!product) return <p className="crm-placeholder">{t('productDetail.common.notFound')}</p>;

  return (
    <>
      <h1 className="crm-page-title">{t('productDetail.settings.title')} · {product.title}</h1>

      <div className="bulk-settings">
        <CatalogBlock product={product} save={saveProduct} taxCats={taxCats} />
        <PerSkuBlock product={product} pq={pq} showToast={showToast} />
        <ShippingBlock product={product} save={saveProduct} />
        <InventoryBlock product={product} save={saveProduct} />
        <B2BBlock product={product} save={saveProduct} />
        <SocialBlock product={product} save={saveProduct} />
      </div>

      {toast && createPortal(
        <div className="auth-toast">{toast}</div>,
        document.body,
      )}
    </>
  );
}

// ── Debounced controls (label/hint live on the FieldCard) ────────────
function TextInput({ value, onSave, type = 'text', placeholder, maxLength }) {
  const [v, setV] = useState(value ?? '');
  const skip = useRef(true);
  useEffect(() => { skip.current = true; setV(value ?? ''); }, [value]);
  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    const timer = setTimeout(() => onSave(v), 500);
    return () => clearTimeout(timer);
  }, [v]); // eslint-disable-line
  return (
    <input className="crm-input" type={type} value={v}
      placeholder={placeholder} maxLength={maxLength}
      onChange={e => setV(e.target.value)} />
  );
}

function NumberInput({ value, onSave, min = 0, max, step = 1 }) {
  const [v, setV] = useState(String(value ?? 0));
  const skip = useRef(true);
  useEffect(() => { skip.current = true; setV(String(value ?? 0)); }, [value]);
  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    const timer = setTimeout(() => onSave(parseInt(v, 10) || 0), 500);
    return () => clearTimeout(timer);
  }, [v]); // eslint-disable-line
  return (
    <input className="crm-input" type="number" min={min} max={max} step={step}
      value={v} onChange={e => setV(e.target.value)} />
  );
}

// Float input that keeps "" (null) distinct from 0 — for nullable per-SKU fields.
function NumberOptInput({ value, onSave, step = 1, min = 0 }) {
  const [v, setV] = useState(value === null || value === undefined ? '' : String(value));
  const skip = useRef(true);
  useEffect(() => {
    skip.current = true;
    setV(value === null || value === undefined ? '' : String(value));
  }, [value]);
  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    const timer = setTimeout(() => {
      const trimmed = v.trim();
      if (trimmed === '') { onSave(null); return; }
      const n = parseFloat(trimmed);
      if (!isNaN(n)) onSave(n);
    }, 500);
    return () => clearTimeout(timer);
  }, [v]); // eslint-disable-line
  return (
    <input className="crm-input" type="number" min={min} step={step}
      value={v} placeholder="—" onChange={e => setV(e.target.value)} />
  );
}

// Boolean → On/Off SegmentSwitch (same pill as Project Settings toggles).
function ToggleSwitch({ value, onSave }) {
  const { t } = useTranslation();
  return (
    <SegmentSwitch
      value={value ? 'on' : 'off'}
      options={[
        { value: 'on',  label: t('productDetail.settings.on') },
        { value: 'off', label: t('productDetail.settings.off') },
      ]}
      onChange={(v) => onSave(v === 'on')} />
  );
}

// ── Per-SKU details — combobox + cards for the selected leaf SKU ─────
function PerSkuBlock({ product, pq, showToast }) {
  const { t } = useTranslation();
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
      showToast(t('productDetail.settings.saved'));
    } else {
      showToast(t('productDetail.settings.saveFailed'));
    }
  }, [product.id, pq, selectedId, showToast, t]);

  if (leafs.length === 0) {
    return (
      <Section icon={<Cube weight="duotone" />} title={t('productDetail.settings.perSku.title')}
        subtitle={t('productDetail.settings.perSku.hintEmpty')}>
        <FieldCard label={t('productDetail.settings.perSku.configuration')}>
          <span className="bulk-field-hint">{t('productDetail.settings.perSku.hintEmpty')}</span>
        </FieldCard>
      </Section>
    );
  }

  return (
    <Section icon={<Cube weight="duotone" />} title={t('productDetail.settings.perSku.title')}
      subtitle={t('productDetail.settings.perSku.hint')}>
      <FieldCard label={t('productDetail.settings.perSku.configuration')}>
        <SearchableCombobox value={selectedId}
          options={leafs.map(l => ({ value: l.id, label: l.label }))}
          onChange={(v) => setSelectedId(Number(v))} />
      </FieldCard>

      {sku && <>
        <FieldCard key={`sku-${sku.id}`} label={t('productDetail.settings.perSku.skuCode')}
          hint={t('productDetail.settings.perSku.skuCodeHint')}>
          <TextInput value={sku.sku_code || ''} maxLength={80}
            onSave={v => saveSkuField('sku_code', v)} />
        </FieldCard>
        <FieldCard key={`bc-${sku.id}`} label={t('productDetail.settings.perSku.barcode')}
          hint={t('productDetail.settings.perSku.barcodeHint')}>
          <TextInput value={sku.barcode || ''} maxLength={80}
            onSave={v => saveSkuField('barcode', v)} />
        </FieldCard>
        <FieldCard key={`l-${sku.id}`} label={t('productDetail.settings.perSku.length')}>
          <NumberOptInput value={sku.length_cm} step={0.1}
            onSave={v => saveSkuField('length_cm', v)} />
        </FieldCard>
        <FieldCard key={`wd-${sku.id}`} label={t('productDetail.settings.perSku.width')}>
          <NumberOptInput value={sku.width_cm} step={0.1}
            onSave={v => saveSkuField('width_cm', v)} />
        </FieldCard>
        <FieldCard key={`h-${sku.id}`} label={t('productDetail.settings.perSku.height')}>
          <NumberOptInput value={sku.height_cm} step={0.1}
            onSave={v => saveSkuField('height_cm', v)} />
        </FieldCard>
        <FieldCard key={`cap-${sku.id}`} label={t('productDetail.settings.perSku.compareAtPrice')}
          hint={t('productDetail.settings.perSku.compareAtPriceHint')}>
          <NumberOptInput value={sku.compare_at_price} step={0.01}
            onSave={v => saveSkuField('compare_at_price', v)} />
        </FieldCard>
        <FieldCard key={`cp-${sku.id}`} label={t('productDetail.settings.perSku.costPrice')}
          hint={t('productDetail.settings.perSku.costPriceHint')}>
          <NumberOptInput value={sku.cost_price} step={0.01}
            onSave={v => saveSkuField('cost_price', v)} />
        </FieldCard>
        <FieldCard key={`sp-${sku.id}`} label={t('productDetail.settings.perSku.salePrice')}
          hint={t('productDetail.settings.perSku.salePriceHint')}>
          <NumberOptInput value={sku.sale_price} step={0.01}
            onSave={v => saveSkuField('sale_price', v)} />
        </FieldCard>
        <FieldCard key={`ss-${sku.id}`} label={t('productDetail.settings.perSku.saleStartsAt')}>
          <DateTimePicker value={(sku.sale_starts_at || '').slice(0, 16)}
            onChange={v => saveSkuField('sale_starts_at', v || null)} />
        </FieldCard>
        <FieldCard key={`se-${sku.id}`} label={t('productDetail.settings.perSku.saleEndsAt')}>
          <DateTimePicker value={(sku.sale_ends_at || '').slice(0, 16)}
            onChange={v => saveSkuField('sale_ends_at', v || null)} />
        </FieldCard>
      </>}
    </Section>
  );
}

// ── Catalog identification ──────────────────────────────────────────
function CatalogBlock({ product, save, taxCats }) {
  const { t } = useTranslation();
  return (
    <Section icon={<Barcode weight="duotone" />} title={t('productDetail.settings.catalog.title')}
      subtitle={t('productDetail.settings.catalog.hint')}>
      <FieldCard label={t('productDetail.settings.catalog.sku')} hint={t('productDetail.settings.catalog.skuHint')}>
        <TextInput value={product.sku} maxLength={80} onSave={v => save({ sku: v })} />
      </FieldCard>
      <FieldCard label={t('productDetail.settings.catalog.barcode')} hint={t('productDetail.settings.catalog.barcodeHint')}>
        <TextInput value={product.barcode} maxLength={80} onSave={v => save({ barcode: v })} />
      </FieldCard>
      <FieldCard label={t('productDetail.settings.catalog.brand')} hint={t('productDetail.settings.catalog.brandHint')}>
        <TextInput value={product.brand} maxLength={120} onSave={v => save({ brand: v })} />
      </FieldCard>
      <FieldCard label={t('productDetail.settings.catalog.manufacturer')} hint={t('productDetail.settings.catalog.manufacturerHint')}>
        <TextInput value={product.manufacturer} maxLength={120} onSave={v => save({ manufacturer: v })} />
      </FieldCard>
      <FieldCard label={t('productDetail.settings.catalog.vendor')} hint={t('productDetail.settings.catalog.vendorHint')}>
        <TextInput value={product.vendor} maxLength={120} onSave={v => save({ vendor: v })} />
      </FieldCard>
      <FieldCard label={t('productDetail.settings.catalog.countryOfOrigin')} hint={t('productDetail.settings.catalog.countryOfOriginHint')}>
        <TextInput value={product.country_of_origin} maxLength={80} onSave={v => save({ country_of_origin: v })} />
      </FieldCard>
      <FieldCard label={t('productDetail.settings.catalog.hsCode')} hint={t('productDetail.settings.catalog.hsCodeHint')}>
        <TextInput value={product.hs_code} maxLength={20} onSave={v => save({ hs_code: v })} />
      </FieldCard>
      <FieldCard label={t('productDetail.settings.catalog.taxCategory')} hint={t('productDetail.settings.catalog.taxCategoryHint')}>
        <SearchableCombobox
          value={product.tax_category_id ?? ''}
          placeholder={t('productDetail.settings.catalog.none')}
          options={[
            { value: '', label: t('productDetail.settings.catalog.none') },
            ...taxCats.map(tc => ({ value: tc.id, label: `${tc.name} (${tc.rate}%)` })),
          ]}
          onChange={(v) => save({ tax_category_id: v === '' ? null : Number(v) })} />
      </FieldCard>
    </Section>
  );
}

// ── Shipping ────────────────────────────────────────────────────────
function ShippingBlock({ product, save }) {
  const { t } = useTranslation();
  const shippingClassOptions = SHIPPING_CLASS_VALUES.map(v => ({
    value: v, label: t(`productDetail.settings.shippingClass.${v}`),
  }));
  return (
    <Section icon={<Truck weight="duotone" />} title={t('productDetail.settings.shipping.title')}
      subtitle={t('productDetail.settings.shipping.hint')}>
      <FieldCard label={t('productDetail.settings.shipping.requiresShipping')} hint={t('productDetail.settings.shipping.requiresShippingHint')}>
        <ToggleSwitch value={product.requires_shipping} onSave={v => save({ requires_shipping: v })} />
      </FieldCard>
      <FieldCard label={t('productDetail.settings.shipping.shipsInternationally')} hint={t('productDetail.settings.shipping.shipsInternationallyHint')}>
        <ToggleSwitch value={product.ships_internationally} onSave={v => save({ ships_internationally: v })} />
      </FieldCard>
      <FieldCard label={t('productDetail.settings.shipping.shippingClass')} hint={t('productDetail.settings.shipping.shippingClassHint')}>
        <SearchableCombobox value={product.shipping_class || 'standard'}
          options={shippingClassOptions}
          onChange={(v) => save({ shipping_class: v })} />
      </FieldCard>
      <FieldCard label={t('productDetail.settings.shipping.leadTime')} hint={t('productDetail.settings.shipping.leadTimeHint')}>
        <NumberInput value={product.lead_time_days} min={0} max={365}
          onSave={v => save({ lead_time_days: v })} />
      </FieldCard>
    </Section>
  );
}

// ── Inventory thresholds + flags ────────────────────────────────────
function InventoryBlock({ product, save }) {
  const { t } = useTranslation();
  return (
    <Section icon={<Package weight="duotone" />} title={t('productDetail.settings.inventory.title')}
      subtitle={t('productDetail.settings.inventory.hint')}>
      <FieldCard label={t('productDetail.settings.inventory.continueSelling')} hint={t('productDetail.settings.inventory.continueSellingHint')}>
        <ToggleSwitch value={product.continue_selling_oos} onSave={v => save({ continue_selling_oos: v })} />
      </FieldCard>
      <FieldCard label={t('productDetail.settings.inventory.lowStock')} hint={t('productDetail.settings.inventory.lowStockHint')}>
        <NumberInput value={product.low_stock_threshold} min={0}
          onSave={v => save({ low_stock_threshold: v })} />
      </FieldCard>
      <FieldCard label={t('productDetail.settings.inventory.preOrder')} hint={t('productDetail.settings.inventory.preOrderHint')}>
        <ToggleSwitch value={product.is_pre_order} onSave={v => save({ is_pre_order: v })} />
      </FieldCard>
      <FieldCard label={t('productDetail.settings.inventory.preOrderReleaseAt')} hint={t('productDetail.settings.inventory.preOrderReleaseAtHint')}>
        <DateTimePicker value={(product.pre_order_release_at || '').slice(0, 16)}
          onChange={v => save({ pre_order_release_at: v || null })} />
      </FieldCard>
    </Section>
  );
}

// ── B2B fields ──────────────────────────────────────────────────────
function B2BBlock({ product, save }) {
  const { t } = useTranslation();
  return (
    <Section icon={<Buildings weight="duotone" />} title={t('productDetail.settings.b2b.title')}
      subtitle={t('productDetail.settings.b2b.hint')}>
      <FieldCard label={t('productDetail.settings.b2b.moq')} hint={t('productDetail.settings.b2b.moqHint')}>
        <NumberInput value={product.moq} min={1} onSave={v => save({ moq: Math.max(1, v) })} />
      </FieldCard>
      <FieldCard label={t('productDetail.settings.b2b.orderIncrement')} hint={t('productDetail.settings.b2b.orderIncrementHint')}>
        <NumberInput value={product.order_increment} min={1} onSave={v => save({ order_increment: Math.max(1, v) })} />
      </FieldCard>
      <FieldCard label={t('productDetail.settings.b2b.netTerms')} hint={t('productDetail.settings.b2b.netTermsHint')}>
        <NumberInput value={product.net_terms_days} min={0} max={180} onSave={v => save({ net_terms_days: v })} />
      </FieldCard>
      <FieldCard label={t('productDetail.settings.b2b.allowPo')} hint={t('productDetail.settings.b2b.allowPoHint')}>
        <ToggleSwitch value={product.allow_po} onSave={v => save({ allow_po: v })} />
      </FieldCard>
    </Section>
  );
}

// ── Social / SEO image ──────────────────────────────────────────────
function SocialBlock({ product, save }) {
  const { t } = useTranslation();
  return (
    <Section icon={<ImageSquare weight="duotone" />} title={t('productDetail.settings.social.title')}
      subtitle={t('productDetail.settings.social.hint')}>
      <FieldCard label={t('productDetail.settings.social.ogImage')} hint={t('productDetail.settings.social.ogImageHint')}>
        <TextInput value={product.og_image_url || ''} maxLength={1000}
          onSave={v => save({ og_image_url: v || null })} />
        {product.og_image_url && (
          <div className="po-og-preview" style={{ marginTop: 12 }}>
            <img src={product.og_image_url} alt={t('productDetail.settings.social.ogPreviewAlt')} className="po-og-img" />
          </div>
        )}
      </FieldCard>
    </Section>
  );
}
