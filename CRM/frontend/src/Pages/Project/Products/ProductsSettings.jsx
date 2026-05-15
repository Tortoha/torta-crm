// Project-wide Product Settings — bulk-apply form: pick fields, set values, stamp across all products in one call. Redesigned for clarity (Nov 2026): each field is one card with an obvious Apply switch, sticky footer summarises the batch, confirm modal shows the diff.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import {
  Truck, Package, Buildings, Info, ArrowRight, CheckCircle, Stack, TreeStructure,
  Hash, ArrowsClockwise,
} from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { Combobox } from '../Booking/BookingCreateModal.jsx';
import '../../../Style/Authentication.css';
import '../../../Style/Products.css';

const SHIPPING_CLASS_OPTIONS = [
  { value: 'standard',   label: 'Standard' },
  { value: 'fragile',    label: 'Fragile' },
  { value: 'oversized',  label: 'Oversized' },
  { value: 'hazmat',     label: 'Hazmat' },
  { value: 'perishable', label: 'Perishable' },
];

const FIELD_LABELS = {
  shipping_class:        'Shipping class',
  requires_shipping:     'Requires shipping',
  ships_internationally: 'Ships internationally',
  lead_time_days:        'Lead time (days)',
  continue_selling_oos:  'Allow backorders',
  low_stock_threshold:   'Low-stock alert threshold',
  net_terms_days:        'Net terms (days)',
  allow_po:              'Allow Purchase Orders',
};

export default function ProductsSettings() {
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
        showToast(`Applied to ${j.affected} product${j.affected === 1 ? '' : 's'}`);
        setConfirm(false);
      } else {
        const j = await r.json().catch(() => ({}));
        showToast(j.detail || 'Apply failed');
      }
    } finally { setBusy(false); }
  };

  return (
    <div className="bulk-settings">
      {/* Hero banner explains the page in one sentence — fixes "what does this do?" confusion. */}
      <div className="bulk-hero">
        <div className="bulk-hero-icon"><Info weight="fill" /></div>
        <div className="bulk-hero-body">
          <div className="bulk-hero-title">Bulk-update product settings</div>
          <div className="bulk-hero-sub">
            Pick fields, set a value, and apply — it overwrites the chosen field on
            <b> every product</b> in this project. Per-product overrides live on each product's
            own Settings page.
          </div>
        </div>
      </div>

      <Section icon={<Truck weight="duotone" />} title="Shipping & fulfillment"
        subtitle="How orders ship — class, lead time, international defaults">
        <BulkSelect icon="select"  field={shipping}  setField={setShipping}
          label="Shipping class" hint="Default carrier-API class for all products"
          options={SHIPPING_CLASS_OPTIONS} />
        <BulkToggle field={reqShip} setField={setReqShip}
          label="Requires shipping"
          hint="Off blocks the shipping step at checkout (digital goods)" />
        <BulkToggle field={intl} setField={setIntl}
          label="Ships internationally"
          hint="Off blocks foreign-address checkout" />
        <BulkNumber field={leadTime} setField={setLeadTime}
          label="Lead time" unit="days" min={0} max={365}
          hint="Days from order to ship-out" />
      </Section>

      <Section icon={<Package weight="duotone" />} title="Inventory behaviour"
        subtitle="Stock rules — backorders and low-stock alerts">
        <BulkToggle field={contOos} setField={setContOos}
          label="Allow backorders"
          hint="When ON, customers can buy a product even at zero stock" />
        <BulkNumber field={lowStock} setField={setLowStock}
          label="Low-stock alert threshold" unit="units" min={0} max={100000}
          hint="Notify when stock drops to this number (0 = alerts off)" />
      </Section>

      <Section icon={<Buildings weight="duotone" />} title="B2B / Wholesale"
        subtitle="Net-term invoicing and purchase orders for business customers">
        <BulkNumber field={netTerms} setField={setNetTerms}
          label="Net terms" unit="days" min={0} max={365}
          hint="0 = pay immediately, 30 = invoice with 30-day terms" />
        <BulkToggle field={allowPo} setField={setAllowPo}
          label="Allow Purchase Orders"
          hint="Business customers can pay via PO number instead of card" />
      </Section>

      {/* Identification — SKU generation (org-wide setting; lives here because the
          merchant naturally goes to Product Settings to manage SKU behaviour). */}
      <SkuGenerationSection orgId={orgId} showToast={showToast} />

      {/* Batch grouping + naming are project-wide rules — save immediately, no confirm step.
          Barcode binding moved into the Print barcodes modal itself (per-print choice). */}
      <BatchGroupingSection projectId={projectId} showToast={showToast} />
      <BatchNamingSection   projectId={projectId} showToast={showToast} />

      {/* Sticky footer — only appears when something is staged */}
      {hasAny && (
        <div className="bulk-footer">
          <div className="bulk-footer-summary">
            <CheckCircle weight="fill" className="bulk-footer-icon" />
            <span>
              <b>{Object.keys(fields).length}</b> field{Object.keys(fields).length === 1 ? '' : 's'} ready to apply across every product in this project
            </span>
          </div>
          <button type="button" className="crm-submit-btn bulk-footer-btn"
            disabled={busy} onClick={() => setConfirm(true)}>
            Review & apply <ArrowRight weight="bold" />
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
  { value: 'numeric',      label: 'Digits' },
  { value: 'letters',      label: 'Letters' },
  { value: 'alphanumeric', label: 'Mix' },
  { value: 'manual',       label: 'Manual' },
];

const SKU_MODE_HINT = {
  numeric:      'Random digits 0–9 (Wildberries-style, default).',
  letters:      'Random uppercase A–Z.',
  alphanumeric: 'Random letters + digits.',
  manual:       'No auto-gen. Field stays empty until you type a value yourself.',
};

function SkuGenerationSection({ orgId, showToast }) {
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
    if (r.ok) showToast?.('Saved');
  };

  const onModeChange = (next) => { setMode(next); save({ mode: next }); };

  const onLengthChange = (raw) => {
    const n = Math.max(4, Math.min(64, parseInt(raw, 10) || 8));
    setLength(n);
    save({ length: n });
  };

  const regenerate = async () => {
    if (regen || !orgId) return;
    if (!confirm('Regenerate SKU codes for every product and configuration in this organization? Existing values will be replaced.')) return;
    setRegen(true);
    try {
      const r = await fetch(`${API_BASE}/api/orgs/${orgId}/sku-regenerate`, {
        method: 'POST', credentials: 'include',
      });
      if (r.ok) {
        const j = await r.json();
        showToast?.(`Updated ${j.products_updated} products + ${j.skus_updated} SKUs`);
      } else {
        showToast?.('Regenerate failed');
      }
    } finally { setRegen(false); }
  };

  return (
    <section className="bulk-section">
      <header className="bulk-section-head">
        <div className="bulk-section-icon"><Hash weight="duotone" /></div>
        <div className="bulk-section-text">
          <h2 className="bulk-section-title">SKU generation</h2>
          <p className="bulk-section-sub">
            New products and configurations get a random unique code on creation.
            <b> Org-wide setting</b> — applies to every project in this organization. Saved on change.
          </p>
        </div>
      </header>

      <div className="bulk-section-fields">
        {/* Mode card — same shell as BatchGroupingSection / BatchNamingSection. */}
        <div className="bulk-field bulk-field--noswitch bulk-field--on">
          <div className="bulk-field-head">
            <div className="bulk-field-text">
              <span className="bulk-field-label">Mode</span>
              <span className="bulk-field-hint">{SKU_MODE_HINT[mode]}</span>
            </div>
          </div>
          <div className="bulk-field-value">
            <SegmentSwitch value={mode} disabled={!loaded}
              options={SKU_MODE_OPTIONS} onChange={onModeChange} />
          </div>
        </div>

        {/* Length card — only when not manual mode */}
        {mode !== 'manual' && (
          <div className="bulk-field bulk-field--noswitch bulk-field--on">
            <div className="bulk-field-head">
              <div className="bulk-field-text">
                <span className="bulk-field-label">Length</span>
                <span className="bulk-field-hint">Number of characters per code (4–64). Default 8.</span>
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
              <span className="bulk-field-label">Regenerate all existing SKUs</span>
              <span className="bulk-field-hint">
                Wipes + re-randomises every <code>product.sku</code> and <code>l2.sku_code</code> in
                the org under current settings. <b>Existing values are replaced</b> — barcodes printed
                with old SKU codes will no longer match.
              </span>
            </div>
          </div>
          <div className="bulk-field-value">
            <button type="button" className="crm-submit-btn auth-btn-secondary"
              disabled={regen || !loaded} onClick={regenerate}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <ArrowsClockwise weight="bold" size={14} />
              {regen ? 'Regenerating…' : 'Regenerate all'}
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
  const on = field.apply;
  return (
    <div className={`bulk-field${on ? ' bulk-field--on' : ''}`}>
      <div className="bulk-field-head">
        <button type="button"
          className={`bulk-apply-switch${on ? ' bulk-apply-switch--on' : ''}`}
          onClick={() => setField(s => ({ ...s, apply: !s.apply }))}
          aria-pressed={on} title="Include this field in the bulk apply">
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
  const on = field.apply;
  return (
    <FieldCard field={field} setField={setField} label={label} hint={hint}>
      <SegmentSwitch
        value={field.value ? 'on' : 'off'}
        disabled={!on}
        options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]}
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
  { value: 'config',  label: 'Per configuration' },
  { value: 'product', label: 'Per product' },
  { value: 'global',  label: 'One global' },
];

const GROUPING_HINT = {
  config:  'Each (product × variation × SKU) gets its own batch. Most granular — recommended when shelf-life or production date varies per SKU.',
  product: 'All variations of the same product share one batch. Receiving 5 colours × 3 sizes of a T-shirt creates one batch per product, not 15.',
  global:  'The whole receipt is one batch. Set a date or rename once and it applies to every row.',
};

function BatchGroupingSection({ projectId, showToast }) {
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
    if (r.ok) showToast?.('Saved');
  };

  return (
    <section className="bulk-section">
      <header className="bulk-section-head">
        <div className="bulk-section-icon"><TreeStructure weight="duotone" /></div>
        <div className="bulk-section-text">
          <h2 className="bulk-section-title">Batch grouping</h2>
          <p className="bulk-section-sub">
            How a multi-SKU stock receipt is split into batches. Affects auto-naming + how
            production / expiry dates auto-fill across rows. Saved on change.
          </p>
        </div>
      </header>

      <div className="bulk-section-fields bulk-section-fields--single">
        <div className="bulk-field bulk-field--noswitch bulk-field--on">
          <div className="bulk-field-head">
            <div className="bulk-field-text">
              <span className="bulk-field-label">Grouping mode</span>
              <span className="bulk-field-hint">{GROUPING_HINT[mode]}</span>
            </div>
          </div>
          <div className="bulk-field-value">
            <SegmentSwitch value={mode} disabled={!loaded}
              options={GROUPING_OPTIONS} onChange={save} />
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Batch naming section — distinct from bulk-apply fields (saves on change, no Apply switch) ──

function BatchNamingSection({ projectId, showToast }) {
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
    if (r.ok) showToast?.('Saved');
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
          <h2 className="bulk-section-title">Batch naming</h2>
          <p className="bulk-section-sub">
            How new batch names are generated when you receive stock. Saved on change — no Apply needed.
          </p>
        </div>
      </header>

      <div className="bulk-section-fields">
        {/* Mode card — same shell as other FieldCards, but without an Apply switch */}
        <div className="bulk-field bulk-field--noswitch bulk-field--on">
          <div className="bulk-field-head">
            <div className="bulk-field-text">
              <span className="bulk-field-label">Naming mode</span>
              <span className="bulk-field-hint">
                Auto fills the name from a template; Manual asks you on every receipt
              </span>
            </div>
          </div>
          <div className="bulk-field-value">
            <SegmentSwitch
              value={mode}
              disabled={!loaded}
              options={[{ value: 'manual', label: 'Manual' }, { value: 'auto', label: 'Auto' }]}
              onChange={(v) => { setMode(v); save({ batch_naming_mode: v }); }}
            />
          </div>
        </div>

        {/* Template card — only renders in Auto mode. Live preview + placeholder reference. */}
        {mode === 'auto' && (
          <div className="bulk-field bulk-field--noswitch bulk-field--on">
            <div className="bulk-field-head">
              <div className="bulk-field-text">
                <span className="bulk-field-label">Template</span>
                <span className="bulk-field-hint">
                  Each <code>seq</code> scope has its own counter — pick the reset cadence you want.
                  Add <code>:NN</code> for zero-padding (e.g. <code>{'{seq:04}'}</code> → 0001).
                  Put <code>{'{sku}'}</code> in the template and a multi-SKU receipt creates one batch per SKU.
                </span>
              </div>
            </div>
            <div className="bulk-field-value batch-template-value">
              <input className="crm-input batch-template-input"
                value={format} disabled={!loaded}
                onChange={(e) => setFormat(e.target.value)}
                onBlur={(e) => save({ batch_naming_format: e.target.value })}
                placeholder="B-{YYYY}{MM}-{seq:03}" />
              <div className="batch-template-preview">
                <span className="batch-template-preview-label">Preview</span>
                <code className="batch-template-preview-value">{preview}</code>
              </div>

              <div className="batch-template-tokens">
                <span className="batch-template-tokens-label">Date</span>
                <code>{'{YYYY}'}</code><span>year</span>
                <code>{'{MM}'}</code><span>month</span>
                <code>{'{DD}'}</code><span>day</span>
              </div>
              <div className="batch-template-tokens">
                <span className="batch-template-tokens-label">Sequence</span>
                <code>{'{seq}'}</code><span>monthly</span>
                <code>{'{seq_day}'}</code><span>daily</span>
                <code>{'{seq_year}'}</code><span>yearly</span>
                <code>{'{seq_all}'}</code><span>all-time</span>
              </div>
              <div className="batch-template-tokens">
                <span className="batch-template-tokens-label">Other</span>
                <code>{'{qty}'}</code><span>quantity received</span>
                <code>{'{sku}'}</code><span>SKU code</span>
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
  const fmt = (v) => typeof v === 'boolean' ? (v ? 'On' : 'Off') : String(v);
  const entries = Object.entries(fields);
  return createPortal(
    <div className="auth-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal po-bulk-confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="auth-modal-body">
          <h2 className="po-block-title" style={{ marginTop: 0 }}>Apply to every product?</h2>
          <p className="po-block-hint">
            These fields will overwrite the current value on every product in this project.
            Per-SKU stock, sku_code, barcode and OG image are NOT touched.
          </p>

          <div className="bulk-confirm-list">
            {entries.map(([k, v]) => (
              <div key={k} className="bulk-confirm-row">
                <span className="bulk-confirm-label">{FIELD_LABELS[k] || k}</span>
                <ArrowRight weight="bold" className="bulk-confirm-arrow" />
                <span className="bulk-confirm-value">{fmt(v)}</span>
              </div>
            ))}
          </div>

          <div className="auth-actions" style={{ marginTop: 18 }}>
            <button type="button" className="crm-submit-btn"
              disabled={busy} onClick={onConfirm}>
              {busy ? 'Applying…' : `Apply ${entries.length} field${entries.length === 1 ? '' : 's'}`}
            </button>
            <button type="button" className="crm-submit-btn auth-btn-secondary"
              disabled={busy} onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
