// Project-wide Product Settings — bulk-apply form: pick fields, set values, stamp across all products in one call. Redesigned for clarity (Nov 2026): each field is one card with an obvious Apply switch, sticky footer summarises the batch, confirm modal shows the diff.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router-dom';
import {
  Truck, Package, Buildings, ArrowRight, CheckCircle, Stack, TreeStructure,
  Hash, ArrowsClockwise, CurrencyDollar,
} from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { Combobox } from '../Booking/BookingCreateModal.jsx';
import '../../../Style/Authentication.css';
import '../../../Style/Products.css';

const SHIPPING_CLASS_OPTIONS = [
  { value: 'standard',   labelKey: 'products.settings.shippingClassOptions.standard' },
  { value: 'fragile',    labelKey: 'products.settings.shippingClassOptions.fragile' },
  { value: 'oversized',  labelKey: 'products.settings.shippingClassOptions.oversized' },
  { value: 'hazmat',     labelKey: 'products.settings.shippingClassOptions.hazmat' },
  { value: 'perishable', labelKey: 'products.settings.shippingClassOptions.perishable' },
];

export default function ProductsSettings() {
  const { t } = useTranslation();
  const { projectId, project } = useOutletContext();
  const orgId = project?.org_id;

  const [shipping, setShipping] = useState({ apply: false, value: 'standard' });
  const [reqShip,  setReqShip]  = useState({ apply: false, value: true });
  const [intl,     setIntl]     = useState({ apply: false, value: false });
  const [leadTime, setLeadTime] = useState({ apply: false, value: 0 });
  const [contOos,  setContOos]  = useState({ apply: false, value: false });
  const [lowStock, setLowStock] = useState({ apply: false, value: 5 });
  const [netTerms, setNetTerms] = useState({ apply: false, value: 0 });
  const [allowPo,  setAllowPo]  = useState({ apply: false, value: false });

  const [confirm, setConfirm] = useState(false);
  const [busy,    setBusy]    = useState(false);
  const [toast,   setToast]   = useState('');
  const showToast = useCallback((msg) => {
    setToast(msg); setTimeout(() => setToast(''), 2400);
  }, []);

  const fields = useMemo(() => {
    const out = {};
    if (shipping.apply) out.shipping_class       = shipping.value;
    if (reqShip.apply)  out.requires_shipping    = reqShip.value;
    if (intl.apply)     out.ships_internationally = intl.value;
    if (leadTime.apply) out.lead_time_days       = parseInt(leadTime.value, 10) || 0;
    if (contOos.apply)  out.continue_selling_oos = contOos.value;
    if (lowStock.apply) out.low_stock_threshold  = parseInt(lowStock.value, 10) || 0;
    if (netTerms.apply) out.net_terms_days       = parseInt(netTerms.value, 10) || 0;
    if (allowPo.apply)  out.allow_po             = allowPo.value;
    return out;
  }, [shipping, reqShip, intl, leadTime, contOos, lowStock, netTerms, allowPo]);

  const hasAny = Object.keys(fields).length > 0;

  const apply = async () => {
    if (!hasAny) return;
    setBusy(true);
    try {
      const r = await fetch(
        `${API_BASE}/api/projects/${projectId}/products/bulk-apply-defaults`,
        {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields }),
        }
      );
      if (r.ok) {
        const j = await r.json();
        showToast(j.affected === 1 ? t('products.settings.toast.appliedOne', { count: j.affected }) : t('products.settings.toast.appliedMany', { count: j.affected }));
        setConfirm(false);
      } else {
        const j = await r.json().catch(() => ({}));
        showToast(j.detail || t('products.settings.toast.applyFailed'));
      }
    } finally { setBusy(false); }
  };

  return (
    <div className="bulk-settings">
      {/* No <h1> here — the parent Products layout (Products.jsx) already
          renders a `crm-page-title` based on the active tab. Adding one
          here would produce a duplicate title on screen. */}

      <Section icon={<Truck weight="duotone" />} title={t('products.settings.shippingTitle')}
        subtitle={t('products.settings.shippingSubtitle')}>
        <BulkSelect icon="select"  field={shipping}  setField={setShipping}
          label={t('products.settings.shippingClass')} hint={t('products.settings.shippingClassHint')}
          options={SHIPPING_CLASS_OPTIONS.map(o => ({ value: o.value, label: t(o.labelKey) }))} />
        <BulkToggle field={reqShip} setField={setReqShip}
          label={t('products.settings.requiresShipping')}
          hint={t('products.settings.requiresShippingHint')} />
        <BulkToggle field={intl} setField={setIntl}
          label={t('products.settings.shipsInternationally')}
          hint={t('products.settings.shipsInternationallyHint')} />
        <BulkNumber field={leadTime} setField={setLeadTime}
          label={t('products.settings.leadTime')} unit={t('products.settings.unitDays')} min={0} max={365}
          hint={t('products.settings.leadTimeHint')} />
      </Section>

      <Section icon={<Package weight="duotone" />} title={t('products.settings.inventoryTitle')}
        subtitle={t('products.settings.inventorySubtitle')}>
        <BulkToggle field={contOos} setField={setContOos}
          label={t('products.settings.allowBackorders')}
          hint={t('products.settings.allowBackordersHint')} />
        <BulkNumber field={lowStock} setField={setLowStock}
          label={t('products.settings.lowStockThreshold')} unit={t('products.settings.unitUnits')} min={0} max={100000}
          hint={t('products.settings.lowStockHint')} />
      </Section>

      <Section icon={<Buildings weight="duotone" />} title={t('products.settings.b2bTitle')}
        subtitle={t('products.settings.b2bSubtitle')}>
        <BulkNumber field={netTerms} setField={setNetTerms}
          label={t('products.settings.netTerms')} unit={t('products.settings.unitDays')} min={0} max={365}
          hint={t('products.settings.netTermsHint')} />
        <BulkToggle field={allowPo} setField={setAllowPo}
          label={t('products.settings.allowPo')}
          hint={t('products.settings.allowPoHint')} />
      </Section>

      {/* Identification — SKU generation (org-wide setting; lives here because the
          merchant naturally goes to Product Settings to manage SKU behaviour). */}
      <SkuGenerationSection orgId={orgId} showToast={showToast} />

      {/* Shipping fees (project-wide, save on blur — drives Cart Summary's
          "Estimated Shipping" + "To free shipping" lines via External API). */}
      <ShippingSection projectId={projectId} project={project} showToast={showToast} />

      {/* Batch grouping + naming are project-wide rules — save immediately, no confirm step.
          Barcode binding moved into the Print barcodes modal itself (per-print choice). */}
      <BatchGroupingSection projectId={projectId} showToast={showToast} />
      <BatchNamingSection   projectId={projectId} showToast={showToast} />

      {/* Sticky footer — only appears when something is staged */}
      {hasAny && (
        <div className="bulk-footer">
          <div className="bulk-footer-summary">
            <CheckCircle weight="fill" className="bulk-footer-icon" />
            <span dangerouslySetInnerHTML={{ __html: Object.keys(fields).length === 1
              ? t('products.settings.footer.readyOne', { count: Object.keys(fields).length })
              : t('products.settings.footer.readyMany', { count: Object.keys(fields).length }) }} />
          </div>
          <button type="button" className="crm-submit-btn bulk-footer-btn"
            disabled={busy} onClick={() => setConfirm(true)}>
            {t('products.settings.footer.reviewApply')} <ArrowRight weight="bold" />
          </button>
        </div>
      )}

      {confirm && (
        <ConfirmModal fields={fields} busy={busy}
          onConfirm={apply} onClose={() => setConfirm(false)} />
      )}

      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
    </div>
  );
}

// ── Product SKU generation (org-level — applies to every project in the org) ──
// Save-on-change section. Mirrors BatchGroupingSection's noswitch pattern.

const SKU_MODE_OPTIONS = [
  { value: 'numeric',      labelKey: 'products.settings.sku.modeNumeric' },
  { value: 'letters',      labelKey: 'products.settings.sku.modeLetters' },
  { value: 'alphanumeric', labelKey: 'products.settings.sku.modeAlphanumeric' },
  { value: 'manual',       labelKey: 'products.settings.sku.modeManual' },
];

const SKU_MODE_HINT = {
  numeric:      'products.settings.sku.hintNumeric',
  letters:      'products.settings.sku.hintLetters',
  alphanumeric: 'products.settings.sku.hintAlphanumeric',
  manual:       'products.settings.sku.hintManual',
};

function SkuGenerationSection({ orgId, showToast }) {
  const { t } = useTranslation();
  const [mode,   setMode]   = useState('numeric');
  const [length, setLength] = useState(8);
  const [loaded, setLoaded] = useState(false);
  const [regen,  setRegen]  = useState(false);

  useEffect(() => {
    if (!orgId) return;
    fetch(`${API_BASE}/api/orgs/${orgId}/sku-settings`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (j) { setMode(j.mode); setLength(j.length); }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [orgId]);

  const save = async (next) => {
    if (!orgId) return;
    const body = { mode: next.mode ?? mode, length: next.length ?? length };
    const r = await fetch(`${API_BASE}/api/orgs/${orgId}/sku-settings`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) showToast?.(t('products.settings.toast.saved'));
  };

  const onModeChange = (next) => { setMode(next); save({ mode: next }); };

  const onLengthChange = (raw) => {
    const n = Math.max(4, Math.min(64, parseInt(raw, 10) || 8));
    setLength(n);
    save({ length: n });
  };

  const regenerate = async () => {
    if (regen || !orgId) return;
    if (!confirm(t('products.settings.sku.confirmRegen'))) return;
    setRegen(true);
    try {
      const r = await fetch(`${API_BASE}/api/orgs/${orgId}/sku-regenerate`, {
        method: 'POST', credentials: 'include',
      });
      if (r.ok) {
        const j = await r.json();
        showToast?.(t('products.settings.toast.regenDone', { products: j.products_updated, skus: j.skus_updated }));
      } else {
        showToast?.(t('products.settings.toast.regenFailed'));
      }
    } finally { setRegen(false); }
  };

  return (
    <section className="bulk-section">
      <header className="bulk-section-head">
        <div className="bulk-section-icon"><Hash weight="duotone" /></div>
        <div className="bulk-section-text">
          <h2 className="bulk-section-title">{t('products.settings.sku.title')}</h2>
          <p className="bulk-section-sub" dangerouslySetInnerHTML={{ __html: t('products.settings.sku.subtitle') }} />
        </div>
      </header>

      <div className="bulk-section-fields">
        {/* Mode card — same shell as BatchGroupingSection / BatchNamingSection. */}
        <div className="bulk-field bulk-field--noswitch bulk-field--on">
          <div className="bulk-field-head">
            <div className="bulk-field-text">
              <span className="bulk-field-label">{t('products.settings.sku.mode')}</span>
              <span className="bulk-field-hint">{t(SKU_MODE_HINT[mode])}</span>
            </div>
          </div>
          <div className="bulk-field-value">
            <SegmentSwitch value={mode} disabled={!loaded}
              options={SKU_MODE_OPTIONS.map(o => ({ value: o.value, label: t(o.labelKey) }))} onChange={onModeChange} />
          </div>
        </div>

        {/* Length card — only when not manual mode */}
        {mode !== 'manual' && (
          <div className="bulk-field bulk-field--noswitch bulk-field--on">
            <div className="bulk-field-head">
              <div className="bulk-field-text">
                <span className="bulk-field-label">{t('products.settings.sku.length')}</span>
                <span className="bulk-field-hint">{t('products.settings.sku.lengthHint')}</span>
              </div>
            </div>
            <div className="bulk-field-value">
              <input className="crm-input" type="number" min={4} max={64}
                value={length}
                disabled={!loaded}
                style={{ maxWidth: 120 }}
                onChange={e => setLength(parseInt(e.target.value, 10) || 0)}
                onBlur={e => onLengthChange(e.target.value)} />
            </div>
          </div>
        )}

        {/* Regenerate action card */}
        <div className="bulk-field bulk-field--noswitch bulk-field--on">
          <div className="bulk-field-head">
            <div className="bulk-field-text">
              <span className="bulk-field-label">{t('products.settings.sku.regenLabel')}</span>
              <span className="bulk-field-hint" dangerouslySetInnerHTML={{ __html: t('products.settings.sku.regenHint') }} />
            </div>
          </div>
          <div className="bulk-field-value">
            <button type="button" className="crm-submit-btn auth-btn-secondary"
              disabled={regen || !loaded} onClick={regenerate}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <ArrowsClockwise weight="bold" size={14} />
              {regen ? t('products.settings.sku.regenerating') : t('products.settings.sku.regenAll')}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}


// ── Section with icon + title + subtitle ────────────────────────────

function Section({ icon, title, subtitle, children }) {
  return (
    <section className="bulk-section">
      <header className="bulk-section-head">
        <div className="bulk-section-icon">{icon}</div>
        <div className="bulk-section-text">
          <h2 className="bulk-section-title">{title}</h2>
          {subtitle && <p className="bulk-section-sub">{subtitle}</p>}
        </div>
      </header>
      <div className="bulk-section-fields">{children}</div>
    </section>
  );
}

// ── Field card — Apply switch + label + hint + value control ────────

function FieldCard({ field, setField, label, hint, children }) {
  const { t } = useTranslation();
  const on = field.apply;
  return (
    <div className={`bulk-field${on ? ' bulk-field--on' : ''}`}>
      <div className="bulk-field-head">
        <button type="button"
          className={`bulk-apply-switch${on ? ' bulk-apply-switch--on' : ''}`}
          onClick={() => setField(s => ({ ...s, apply: !s.apply }))}
          aria-pressed={on} title={t('products.settings.fieldCard.includeHint')}>
          <span className="bulk-apply-switch-knob" />
        </button>
        <div className="bulk-field-text">
          <span className="bulk-field-label">{label}</span>
          {hint && <span className="bulk-field-hint">{hint}</span>}
        </div>
      </div>
      <div className={`bulk-field-value${on ? '' : ' bulk-field-value--disabled'}`}>
        {children}
      </div>
    </div>
  );
}

function BulkToggle({ field, setField, label, hint }) {
  const { t } = useTranslation();
  const on = field.apply;
  return (
    <FieldCard field={field} setField={setField} label={label} hint={hint}>
      <SegmentSwitch
        value={field.value ? 'on' : 'off'}
        disabled={!on}
        options={[{ value: 'off', label: t('products.settings.off') }, { value: 'on', label: t('products.settings.on') }]}
        onChange={(v) => setField(s => ({ ...s, value: v === 'on' }))}
      />
    </FieldCard>
  );
}

/**
 * SegmentSwitch — sliding pill toggle that matches the SortToggle pattern used
 * everywhere else in the CRM (Organization page, Promo codes, Batches). The
 * indicator follows hover first, falls back to the active value when not
 * hovering. Writes directly to style (no re-renders).
 */
function SegmentSwitch({ value, options, onChange, disabled }) {
  const indRef = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);
  const current = hovered ?? value;

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el = btnRefs.current[current];
      if (!ind || !el) return;
      ind.style.opacity = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [current, value]);

  return (
    <div className={`seg-switch${disabled ? ' seg-switch--disabled' : ''}`}
      onMouseLeave={() => setHovered(null)}>
      <div ref={indRef} className="seg-switch-indicator" />
      {options.map(({ value: v, label }) => (
        <button key={String(v)} type="button" disabled={disabled}
          ref={el => { btnRefs.current[v] = el; }}
          className={`seg-switch-btn${current === v ? ' seg-switch-btn--current' : ''}`}
          onMouseEnter={() => !disabled && setHovered(v)}
          onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function BulkNumber({ field, setField, label, hint, unit, min, max }) {
  const on = field.apply;
  return (
    <FieldCard field={field} setField={setField} label={label} hint={hint}>
      <div className="bulk-number-wrap">
        <input className="crm-input bulk-number-input" type="number"
          min={min} max={max} disabled={!on}
          value={field.value}
          onChange={(e) => setField(s => ({ ...s, value: e.target.value }))} />
        {unit && <span className="bulk-number-unit">{unit}</span>}
      </div>
    </FieldCard>
  );
}

function BulkSelect({ field, setField, label, hint, options }) {
  const on = field.apply;
  return (
    <FieldCard field={field} setField={setField} label={label} hint={hint}>
      <div className={`po-cb-wrap${on ? '' : ' po-bulk-cb-disabled'}`}>
        <Combobox value={field.value} options={options}
          onChange={(v) => setField(s => ({ ...s, value: v }))} />
      </div>
    </FieldCard>
  );
}

// ── Batch grouping section — three-way switch controlling how auto-named ────
// batches are scoped during a multi-SKU receive (and how dates auto-propagate).

const GROUPING_OPTIONS = [
  { value: 'config',  labelKey: 'products.settings.batchGrouping.perConfig' },
  { value: 'product', labelKey: 'products.settings.batchGrouping.perProduct' },
  { value: 'global',  labelKey: 'products.settings.batchGrouping.oneGlobal' },
];

const GROUPING_HINT = {
  config:  'products.settings.batchGrouping.hintConfig',
  product: 'products.settings.batchGrouping.hintProduct',
  global:  'products.settings.batchGrouping.hintGlobal',
};

// ── Shipping settings (per-project, save-on-blur) ──
// Two scalars: flat shipping_cost charged per order, and the
// free_shipping_threshold above which the cost drops to zero.
// Both default to 0 — semantically "no free shipping configured" (cost
// charged on every order) and "shipping always free" respectively.
//
// Save-on-blur (mirrors BatchGroupingSection pattern): the user types,
// onBlur fires PUT, success → toast. Backend UPSERTs so the row exists
// even on first-ever save. Stable across reloads via the GET on mount.

function ShippingSection({ projectId, project, showToast }) {
  const { t } = useTranslation();
  // Project currency is the source of truth for the `$` / `₸` prefix.
  // Falls back to `$` if the project hasn't set one yet (rare — project
  // creation always picks a currency).
  const currency = project?.currency || 'USD';

  const [cost,       setCost]      = useState('');
  const [threshold,  setThreshold] = useState('');
  const [loaded,     setLoaded]    = useState(false);

  // Track last-saved values so blur only fires when something actually changed
  // — avoids spurious "Saved" toasts when the user just tabs through.
  const savedRef = useRef({ cost: 0, threshold: 0 });

  useEffect(() => {
    fetch(`${API_BASE}/api/projects/${projectId}/shipping-settings`,
          { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          const c = Number(d.shipping_cost) || 0;
          const th = Number(d.free_shipping_threshold) || 0;
          setCost(String(c));
          setThreshold(String(th));
          savedRef.current = { cost: c, threshold: th };
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [projectId]);

  const save = async (patch) => {
    const r = await fetch(`${API_BASE}/api/projects/${projectId}/shipping-settings`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (r.ok) {
      const j = await r.json().catch(() => null);
      if (j) {
        savedRef.current = {
          cost:      Number(j.shipping_cost) || 0,
          threshold: Number(j.free_shipping_threshold) || 0,
        };
      }
      showToast?.(t('products.settings.toast.saved'));
    }
  };

  // Normalise + persist on blur. Parse loose (e.g. "10,5" → 10.5), clamp
  // negative → 0, write back to state so the input shows the normalised
  // value the backend actually stored.
  const onCostBlur = () => {
    const raw = String(cost).replace(',', '.').trim();
    const n = raw === '' ? 0 : Math.max(0, parseFloat(raw) || 0);
    setCost(String(n));
    if (n !== savedRef.current.cost) save({ shipping_cost: n });
  };

  const onThresholdBlur = () => {
    const raw = String(threshold).replace(',', '.').trim();
    const n = raw === '' ? 0 : Math.max(0, parseFloat(raw) || 0);
    setThreshold(String(n));
    if (n !== savedRef.current.threshold) save({ free_shipping_threshold: n });
  };

  return (
    <section className="bulk-section">
      <header className="bulk-section-head">
        <div className="bulk-section-icon"><CurrencyDollar weight="duotone" /></div>
        <div className="bulk-section-text">
          <h2 className="bulk-section-title">{t('products.settings.shipping.title')}</h2>
          {/* dangerouslySetInnerHTML — subtitle includes <b> tags around the
              two terms that appear in the storefront UI ("Estimated Shipping",
              "To free shipping"). Same pattern as SkuGenerationSection. Plain
              `{t(...)}` would escape them and render literal `<b>` text. */}
          <p className="bulk-section-sub"
             dangerouslySetInnerHTML={{ __html: t('products.settings.shipping.subtitle') }} />
        </div>
      </header>

      <div className="bulk-section-fields">
        {/* Shipping cost (flat fee charged on every order, dropped to 0 over threshold) */}
        <div className="bulk-field bulk-field--noswitch bulk-field--on">
          <div className="bulk-field-head">
            <div className="bulk-field-text">
              <span className="bulk-field-label">{t('products.settings.shipping.costLabel')}</span>
              <span className="bulk-field-hint">{t('products.settings.shipping.costHint')}</span>
            </div>
          </div>
          <div className="bulk-field-value">
            <input className="crm-input" type="number" min={0} step="0.01"
              value={cost}
              disabled={!loaded}
              placeholder="0"
              style={{ maxWidth: 160 }}
              onChange={e => setCost(e.target.value)}
              onBlur={onCostBlur} />
            <span className="bulk-field-unit">{currency}</span>
          </div>
        </div>

        {/* Free-shipping threshold (subtotal above which cost → 0). 0 = never free. */}
        <div className="bulk-field bulk-field--noswitch bulk-field--on">
          <div className="bulk-field-head">
            <div className="bulk-field-text">
              <span className="bulk-field-label">{t('products.settings.shipping.thresholdLabel')}</span>
              <span className="bulk-field-hint">{t('products.settings.shipping.thresholdHint')}</span>
            </div>
          </div>
          <div className="bulk-field-value">
            <input className="crm-input" type="number" min={0} step="0.01"
              value={threshold}
              disabled={!loaded}
              placeholder="0"
              style={{ maxWidth: 160 }}
              onChange={e => setThreshold(e.target.value)}
              onBlur={onThresholdBlur} />
            <span className="bulk-field-unit">{currency}</span>
          </div>
        </div>
      </div>
    </section>
  );
}


function BatchGroupingSection({ projectId, showToast }) {
  const { t } = useTranslation();
  const [mode,   setMode]   = useState('config');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/projects/${projectId}/batch-settings`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) setMode(d.batch_grouping_mode || 'config');
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [projectId]);

  const save = async (next) => {
    setMode(next);
    const r = await fetch(`${API_BASE}/api/projects/${projectId}/batch-settings`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch_grouping_mode: next }),
    });
    if (r.ok) showToast?.(t('products.settings.toast.saved'));
  };

  return (
    <section className="bulk-section">
      <header className="bulk-section-head">
        <div className="bulk-section-icon"><TreeStructure weight="duotone" /></div>
        <div className="bulk-section-text">
          <h2 className="bulk-section-title">{t('products.settings.batchGrouping.title')}</h2>
          <p className="bulk-section-sub">
            {t('products.settings.batchGrouping.subtitle')}
          </p>
        </div>
      </header>

      <div className="bulk-section-fields bulk-section-fields--single">
        <div className="bulk-field bulk-field--noswitch bulk-field--on">
          <div className="bulk-field-head">
            <div className="bulk-field-text">
              <span className="bulk-field-label">{t('products.settings.batchGrouping.mode')}</span>
              <span className="bulk-field-hint">{t(GROUPING_HINT[mode])}</span>
            </div>
          </div>
          <div className="bulk-field-value">
            <SegmentSwitch value={mode} disabled={!loaded}
              options={GROUPING_OPTIONS.map(o => ({ value: o.value, label: t(o.labelKey) }))} onChange={save} />
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Batch naming section — distinct from bulk-apply fields (saves on change, no Apply switch) ──

function BatchNamingSection({ projectId, showToast }) {
  const { t } = useTranslation();
  const [mode,   setMode]   = useState('auto');
  const [format, setFormat] = useState('B-{YYYY}{MM}-{seq:03}');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/projects/${projectId}/batch-settings`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setMode(d.batch_naming_mode || 'auto');
          setFormat(d.batch_naming_format || 'B-{YYYY}{MM}-{seq:03}');
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [projectId]);

  const save = async (patch) => {
    const r = await fetch(`${API_BASE}/api/projects/${projectId}/batch-settings`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (r.ok) showToast?.(t('products.settings.toast.saved'));
  };

  // Live preview of what an auto-name would look like RIGHT NOW.
  // Keep in sync with backend _generate_batch_name placeholder set.
  const preview = useMemo(() => {
    const now = new Date();
    const pad = (n, w) => String(n).padStart(w, '0');
    // Dummy counters for preview only — real values come from the DB on save.
    const ctx = {
      YYYY:     String(now.getFullYear()),
      YY:       String(now.getFullYear()).slice(-2),
      MM:       pad(now.getMonth() + 1, 2),
      DD:       pad(now.getDate(), 2),
      sku:      'SKU-CODE',
      qty:      '100',
      seq:      '1',
      seq_day:  '1',
      seq_year: '1',
      seq_all:  '1',
    };
    return (format || '').replace(/\{([A-Za-z_]+(?::[0-9]+)?)\}/g, (m, token) => {
      const [base, widthRaw] = token.split(':');
      const val = ctx[base];
      if (val === undefined) return m;
      if (widthRaw !== undefined) {
        const w = Math.max(1, Math.min(parseInt(widthRaw, 10) || 1, 10));
        return pad(val, w);
      }
      return val;
    });
  }, [format]);

  return (
    <section className="bulk-section">
      <header className="bulk-section-head">
        <div className="bulk-section-icon"><Stack weight="duotone" /></div>
        <div className="bulk-section-text">
          <h2 className="bulk-section-title">{t('products.settings.batchNaming.title')}</h2>
          <p className="bulk-section-sub">
            {t('products.settings.batchNaming.subtitle')}
          </p>
        </div>
      </header>

      <div className="bulk-section-fields">
        {/* Mode card — same shell as other FieldCards, but without an Apply switch */}
        <div className="bulk-field bulk-field--noswitch bulk-field--on">
          <div className="bulk-field-head">
            <div className="bulk-field-text">
              <span className="bulk-field-label">{t('products.settings.batchNaming.mode')}</span>
              <span className="bulk-field-hint">
                {t('products.settings.batchNaming.modeHint')}
              </span>
            </div>
          </div>
          <div className="bulk-field-value">
            <SegmentSwitch
              value={mode}
              disabled={!loaded}
              options={[{ value: 'manual', label: t('products.settings.batchNaming.manual') }, { value: 'auto', label: t('products.settings.batchNaming.auto') }]}
              onChange={(v) => { setMode(v); save({ batch_naming_mode: v }); }}
            />
          </div>
        </div>

        {/* Template card — only renders in Auto mode. Live preview + placeholder reference. */}
        {mode === 'auto' && (
          <div className="bulk-field bulk-field--noswitch bulk-field--on">
            <div className="bulk-field-head">
              <div className="bulk-field-text">
                <span className="bulk-field-label">{t('products.settings.batchNaming.template')}</span>
                <span className="bulk-field-hint"
                  dangerouslySetInnerHTML={{ __html: t('products.settings.batchNaming.templateHint', { seq04: '{seq:04}', sku: '{sku}' }) }} />
              </div>
            </div>
            <div className="bulk-field-value batch-template-value">
              <input className="crm-input batch-template-input"
                value={format} disabled={!loaded}
                onChange={(e) => setFormat(e.target.value)}
                onBlur={(e) => save({ batch_naming_format: e.target.value })}
                placeholder="B-{YYYY}{MM}-{seq:03}" />
              <div className="batch-template-preview">
                <span className="batch-template-preview-label">{t('products.settings.batchNaming.preview')}</span>
                <code className="batch-template-preview-value">{preview}</code>
              </div>

              <div className="batch-template-tokens">
                <span className="batch-template-tokens-label">{t('products.settings.batchNaming.tokensDate')}</span>
                <code>{'{YYYY}'}</code><span>{t('products.settings.batchNaming.tokenYear')}</span>
                <code>{'{MM}'}</code><span>{t('products.settings.batchNaming.tokenMonth')}</span>
                <code>{'{DD}'}</code><span>{t('products.settings.batchNaming.tokenDay')}</span>
              </div>
              <div className="batch-template-tokens">
                <span className="batch-template-tokens-label">{t('products.settings.batchNaming.tokensSequence')}</span>
                <code>{'{seq}'}</code><span>{t('products.settings.batchNaming.tokenMonthly')}</span>
                <code>{'{seq_day}'}</code><span>{t('products.settings.batchNaming.tokenDaily')}</span>
                <code>{'{seq_year}'}</code><span>{t('products.settings.batchNaming.tokenYearly')}</span>
                <code>{'{seq_all}'}</code><span>{t('products.settings.batchNaming.tokenAllTime')}</span>
              </div>
              <div className="batch-template-tokens">
                <span className="batch-template-tokens-label">{t('products.settings.batchNaming.tokensOther')}</span>
                <code>{'{qty}'}</code><span>{t('products.settings.batchNaming.tokenQty')}</span>
                <code>{'{sku}'}</code><span>{t('products.settings.batchNaming.tokenSku')}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Confirm modal — diff table + Apply button ──────────────────────

function ConfirmModal({ fields, busy, onConfirm, onClose }) {
  const { t } = useTranslation();
  const fmt = (v) => typeof v === 'boolean' ? (v ? t('products.settings.on') : t('products.settings.off')) : String(v);
  const entries = Object.entries(fields);
  return createPortal(
    <div className="auth-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal po-bulk-confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="auth-modal-body">
          <h2 className="po-block-title" style={{ marginTop: 0 }}>{t('products.settings.confirm.title')}</h2>
          <p className="po-block-hint">
            {t('products.settings.confirm.body')}
          </p>

          <div className="bulk-confirm-list">
            {entries.map(([k, v]) => (
              <div key={k} className="bulk-confirm-row">
                <span className="bulk-confirm-label">{t(`products.settings.fieldLabels.${k}`, k)}</span>
                <ArrowRight weight="bold" className="bulk-confirm-arrow" />
                <span className="bulk-confirm-value">{fmt(v)}</span>
              </div>
            ))}
          </div>

          <div className="auth-actions" style={{ marginTop: 18 }}>
            <button type="button" className="crm-submit-btn"
              disabled={busy} onClick={onConfirm}>
              {busy ? t('products.settings.confirm.applying') : (entries.length === 1 ? t('products.settings.confirm.applyOne', { count: entries.length }) : t('products.settings.confirm.applyMany', { count: entries.length }))}
            </button>
            <button type="button" className="crm-submit-btn auth-btn-secondary"
              disabled={busy} onClick={onClose}>{t('common.cancel')}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
