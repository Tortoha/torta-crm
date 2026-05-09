// Org-level settings: Product SKU generation (mode + length), shared across all projects in the org.

import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import { API_BASE } from '../../api.js';
import { Combobox } from '../Project/Booking/BookingCreateModal.jsx';
import '../../Style/Authentication.css';
import '../../Style/Products.css';

const MODE_OPTIONS = [
  { value: 'numeric',      label: 'Only digits (Wildberries-style)' },
  { value: 'letters',      label: 'Only letters (uppercase)' },
  { value: 'alphanumeric', label: 'Letters + digits' },
  { value: 'manual',       label: 'Manual (no auto-generation)' },
];

export default function OrgSettings() {
  const { org } = useOutletContext();
  const orgId = org?.id;

  const [mode,   setMode]   = useState('numeric');
  const [length, setLength] = useState(8);
  const [loaded, setLoaded] = useState(false);
  const [regen,  setRegen]  = useState(false);
  const [toast,  setToast]  = useState('');

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2400);
  }, []);

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

  const save = useCallback(async (next) => {
    const body = { mode: next.mode ?? mode, length: next.length ?? length };
    const r = await fetch(`${API_BASE}/api/orgs/${orgId}/sku-settings`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) showToast('Saved');
    else      showToast('Save failed');
  }, [orgId, mode, length, showToast]);

  const onModeChange = (next) => {
    setMode(next);
    save({ mode: next });
  };

  const onLengthChange = (rawValue) => {
    const n = Math.max(4, Math.min(64, parseInt(rawValue, 10) || 8));
    setLength(n);
    save({ length: n });
  };

  const regenerate = async () => {
    if (regen) return;
    if (!confirm('Regenerate SKU codes for every product and configuration in this organization? Existing values will be replaced.')) return;
    setRegen(true);
    try {
      const r = await fetch(`${API_BASE}/api/orgs/${orgId}/sku-regenerate`, {
        method: 'POST', credentials: 'include',
      });
      if (r.ok) {
        const j = await r.json();
        showToast(`Updated ${j.products_updated} products + ${j.skus_updated} SKUs`);
      } else {
        showToast('Regenerate failed');
      }
    } finally { setRegen(false); }
  };

  return (
    <>
      <h1 className="crm-page-title">Organization Settings</h1>

      <section className="po-block">
        <h2 className="po-block-title">Product SKU generation</h2>
        <p className="po-block-hint">
          Applies to every project in this organization. New products and
          configurations get a random unique code on creation. Manual mode
          leaves the field empty so the merchant types it themselves.
          Default — 8 random digits, like Wildberries.
        </p>

        <div className="po-set-grid">
          <label className="po-set-field">
            <span className="po-set-label">Generation mode</span>
            <div className="po-cb-wrap">
              <Combobox value={mode} options={MODE_OPTIONS}
                onChange={(v) => onModeChange(v)} />
            </div>
            <span className="po-set-hint">
              {mode === 'numeric' && 'Random digits 0–9'}
              {mode === 'letters' && 'Random uppercase A–Z'}
              {mode === 'alphanumeric' && 'Random A–Z + 0–9 mix'}
              {mode === 'manual' && 'Fields stay empty until you type a value yourself'}
            </span>
          </label>

          {mode !== 'manual' && (
            <label className="po-set-field">
              <span className="po-set-label">Length</span>
              <input className="crm-input po-set-input" type="number"
                min={4} max={64}
                value={length}
                disabled={!loaded}
                onChange={e => setLength(parseInt(e.target.value, 10) || 0)}
                onBlur={e => onLengthChange(e.target.value)} />
              <span className="po-set-hint">Number of characters per code (4–64)</span>
            </label>
          )}
        </div>

        <div className="auth-actions" style={{ marginTop: 16 }}>
          <button type="button" className="crm-submit-btn auth-btn-secondary"
            disabled={regen} onClick={regenerate}>
            {regen ? 'Regenerating…' : 'Regenerate all existing SKUs'}
          </button>
        </div>
      </section>

      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
    </>
  );
}
