// Project-wide Product Settings — bulk-apply form: tick fields, set values, stamp across all products in one call.

import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
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

export default function ProductsSettings() {
  const { projectId } = useOutletContext();

  // Each field is { include, value } — include=true puts field into the bulk payload; defaults are safe.
  const [shipping, setShipping] = useState({ include: false, value: 'standard' });
  const [reqShip,  setReqShip]  = useState({ include: false, value: true });
  const [intl,     setIntl]     = useState({ include: false, value: false });
  const [leadTime, setLeadTime] = useState({ include: false, value: 0 });
  const [contOos,  setContOos]  = useState({ include: false, value: false });
  const [lowStock, setLowStock] = useState({ include: false, value: 5 });
  const [netTerms, setNetTerms] = useState({ include: false, value: 0 });
  const [allowPo,  setAllowPo]  = useState({ include: false, value: false });

  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2400);
  }, []);

  const collectFields = () => {
    const out = {};
    if (shipping.include) out.shipping_class       = shipping.value;
    if (reqShip.include)  out.requires_shipping    = reqShip.value;
    if (intl.include)     out.ships_internationally = intl.value;
    if (leadTime.include) out.lead_time_days       = parseInt(leadTime.value, 10) || 0;
    if (contOos.include)  out.continue_selling_oos = contOos.value;
    if (lowStock.include) out.low_stock_threshold  = parseInt(lowStock.value, 10) || 0;
    if (netTerms.include) out.net_terms_days       = parseInt(netTerms.value, 10) || 0;
    if (allowPo.include)  out.allow_po             = allowPo.value;
    return out;
  };

  const fields = collectFields();
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
    <div>
      <p className="po-block-hint po-bulk-intro">
        Tick the fields you want to apply, set their values, and click Apply.
        This overwrites the chosen fields on every product in this project.
        Per-product overrides live on each product&apos;s Settings page. SKU
        format (digits / letters / mix / manual + length) is configured at
        the organization level — see Organization Settings.
      </p>

      <section className="po-block">
        <h2 className="po-block-title">Shipping &amp; fulfillment</h2>
        <div className="po-set-grid">
          <BulkSelect label="Shipping class" hint="Default carrier-API class for all products"
            include={shipping.include} value={shipping.value}
            onIncludeChange={(b) => setShipping(s => ({ ...s, include: b }))}
            onValueChange={(v) => setShipping(s => ({ ...s, value: v }))}
            options={SHIPPING_CLASS_OPTIONS} />
          <BulkToggle label="Requires shipping" hint="Off blocks the shipping step at checkout"
            include={reqShip.include} value={reqShip.value}
            onIncludeChange={(b) => setReqShip(s => ({ ...s, include: b }))}
            onValueChange={(v) => setReqShip(s => ({ ...s, value: v }))} />
          <BulkToggle label="Ships internationally" hint="Off blocks foreign-address checkout"
            include={intl.include} value={intl.value}
            onIncludeChange={(b) => setIntl(s => ({ ...s, include: b }))}
            onValueChange={(v) => setIntl(s => ({ ...s, value: v }))} />
          <BulkNumber label="Lead time (days)" hint="Days from order to ship-out"
            include={leadTime.include} value={leadTime.value} min={0} max={365}
            onIncludeChange={(b) => setLeadTime(s => ({ ...s, include: b }))}
            onValueChange={(v) => setLeadTime(s => ({ ...s, value: v }))} />
        </div>
      </section>

      <section className="po-block">
        <h2 className="po-block-title">Inventory behaviour</h2>
        <div className="po-set-grid">
          <BulkToggle label="Continue selling when out of stock" hint="Backorder mode for the whole catalog"
            include={contOos.include} value={contOos.value}
            onIncludeChange={(b) => setContOos(s => ({ ...s, include: b }))}
            onValueChange={(v) => setContOos(s => ({ ...s, value: v }))} />
          <BulkNumber label="Low-stock threshold" hint="Alert level for every product (0 = off)"
            include={lowStock.include} value={lowStock.value} min={0} max={100000}
            onIncludeChange={(b) => setLowStock(s => ({ ...s, include: b }))}
            onValueChange={(v) => setLowStock(s => ({ ...s, value: v }))} />
        </div>
      </section>

      <section className="po-block">
        <h2 className="po-block-title">B2B / Wholesale</h2>
        <div className="po-set-grid">
          <BulkNumber label="Net terms (days)" hint="0 = pay immediately; 30 = invoice with 30-day terms"
            include={netTerms.include} value={netTerms.value} min={0} max={365}
            onIncludeChange={(b) => setNetTerms(s => ({ ...s, include: b }))}
            onValueChange={(v) => setNetTerms(s => ({ ...s, value: v }))} />
          <BulkToggle label="Allow Purchase Orders" hint="Customers can pay via PO# instead of card"
            include={allowPo.include} value={allowPo.value}
            onIncludeChange={(b) => setAllowPo(s => ({ ...s, include: b }))}
            onValueChange={(v) => setAllowPo(s => ({ ...s, value: v }))} />
        </div>
      </section>

      <section className="po-block">
        <h2 className="po-block-title">Apply</h2>
        <p className="po-block-hint">
          {hasAny
            ? `${Object.keys(fields).length} field${Object.keys(fields).length === 1 ? '' : 's'} ticked. Apply will overwrite these on every product in the project.`
            : 'Tick at least one field above, then click Apply.'}
        </p>
        <div className="auth-actions po-bulk-apply-actions">
          <button type="button" className="crm-submit-btn"
            disabled={!hasAny || busy} onClick={() => setConfirm(true)}>
            Apply to all products
          </button>
        </div>
      </section>

      {confirm && (
        <ConfirmModal fields={fields} busy={busy}
          onConfirm={apply} onClose={() => setConfirm(false)} />
      )}

      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
    </div>
  );
}

// ── Field cells ─────────────────────────────────────────────────────

function IncludeCheckbox({ checked, onChange }) {
  return (
    <input type="checkbox" className="cat-prod-checkbox po-include-cb"
      checked={checked} onChange={e => onChange(e.target.checked)} />
  );
}

function BulkToggle({ label, hint, include, value, onIncludeChange, onValueChange }) {
  return (
    <label className={`po-set-field${include ? '' : ' po-bulk-field--off'}`}>
      <span className="po-set-label po-bulk-label-row">
        <IncludeCheckbox checked={include} onChange={onIncludeChange} />
        {label}
      </span>
      <label className="po-set-field po-set-field--toggle po-bulk-toggle-row">
        <input type="checkbox" className="cat-prod-checkbox po-include-cb"
          checked={!!value} disabled={!include}
          onChange={e => onValueChange(e.target.checked)} />
        <span className="po-set-toggle-text">{value ? 'Yes' : 'No'}</span>
      </label>
      {hint && <span className="po-set-hint">{hint}</span>}
    </label>
  );
}

function BulkNumber({ label, hint, include, value, min, max, onIncludeChange, onValueChange }) {
  return (
    <label className={`po-set-field${include ? '' : ' po-bulk-field--off'}`}>
      <span className="po-set-label po-bulk-label-row">
        <IncludeCheckbox checked={include} onChange={onIncludeChange} />
        {label}
      </span>
      <input className="crm-input po-set-input" type="number"
        min={min} max={max} disabled={!include}
        value={value} onChange={e => onValueChange(e.target.value)} />
      {hint && <span className="po-set-hint">{hint}</span>}
    </label>
  );
}

function BulkSelect({ label, hint, include, value, options, onIncludeChange, onValueChange }) {
  return (
    <label className={`po-set-field${include ? '' : ' po-bulk-field--off'}`}>
      <span className="po-set-label po-bulk-label-row">
        <IncludeCheckbox checked={include} onChange={onIncludeChange} />
        {label}
      </span>
      <div className={`po-cb-wrap${include ? '' : ' po-bulk-cb-disabled'}`}>
        <Combobox value={value} options={options} onChange={onValueChange} />
      </div>
      {hint && <span className="po-set-hint">{hint}</span>}
    </label>
  );
}

// ── Confirm modal ────────────────────────────────────────────────────

function ConfirmModal({ fields, busy, onConfirm, onClose }) {
  const labelByKey = {
    shipping_class: 'Shipping class',
    requires_shipping: 'Requires shipping',
    ships_internationally: 'Ships internationally',
    lead_time_days: 'Lead time (days)',
    continue_selling_oos: 'Continue selling when OOS',
    low_stock_threshold: 'Low-stock threshold',
    net_terms_days: 'Net terms (days)',
    allow_po: 'Allow Purchase Orders',
  };
  const fmt = (v) => typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);

  return createPortal(
    <div className="auth-modal-overlay" onClick={onClose}>
      <div className="auth-modal po-bulk-confirm-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-body">
          <h2 className="po-block-title">Apply to all products?</h2>
          <p className="po-block-hint">
            The following fields will overwrite the current value on every
            product in this project. Per-SKU stock and SKU-specific fields
            (sku_code, barcode, brand, OG image) are not affected.
          </p>
          <div className="po-set-table po-bulk-confirm-table">
            <div className="po-set-row po-set-row--head po-set-row--3">
              <span>Field</span><span>New value</span><span></span><span></span>
            </div>
            {Object.entries(fields).map(([k, v]) => (
              <div key={k} className="po-set-row po-set-row--3">
                <span className="po-set-strong">{labelByKey[k] || k}</span>
                <span>{fmt(v)}</span>
                <span></span>
                <span></span>
              </div>
            ))}
          </div>
          <div className="auth-actions po-bulk-confirm-actions">
            <button type="button" className="crm-submit-btn"
              disabled={busy} onClick={onConfirm}>
              {busy ? 'Applying…' : 'Apply'}
            </button>
            <button type="button" className="auth-btn-danger"
              disabled={busy} onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
