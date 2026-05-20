// Shipping-label print modal — used from both the CRM Orders page (row
// context menu + bulk-toolbar) and the Products page (after the user
// picks which orders containing a product they want to ship).
//
// Layout follows the same split-pair as PrintBarcodesModal: settings on
// the LEFT, live PDF preview on the RIGHT inside an <iframe>. The
// merchant fills in carrier + tracking number for each order, picks a
// format, and clicks Print. We POST to /api/orders/shipping-label/bulk
// which returns a multi-page PDF that gets piped straight to the
// browser print dialog via iframe.contentWindow.print().
//
// Persistence: any per-row edit (carrier, tracking, package_count) is
// PATCHed back to /api/orders/{id}/shipping immediately on blur. That
// way the customer can later see their tracking link in the Magaz
// storefront even if the merchant never opens this modal again.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { X, DownloadSimple } from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { Combobox } from '../Booking/BookingCreateModal.jsx';
import { SearchCombo } from '../../../Utils/SearchCombo.jsx';
import '../../../Style/Authentication.css';
import '../../../Style/Products.css';

const FORMAT_OPTIONS = [
  { value: 'thermal_100x150', label: 'Thermal · 100 × 150 mm' },
  { value: 'a4_1',            label: 'A4 · 1 label per page' },
  { value: 'a4_2',            label: 'A4 · 2 labels per page' },
  { value: 'a4_4',            label: 'A4 · 4 labels per page' },
];

// Default to the most-used real-world format for courier integrations
// in CIS region — every CDEK/Pochta/Kazpost branch has thermal printers
// loaded with 100×150 rolls.
const DEFAULT_FORMAT = 'thermal_100x150';

export default function PrintShippingLabelModal({ open, orderIds, onClose }) {
  const { projectId } = useOutletContext();
  const pq = `?project_id=${projectId}`;
  const [carriers, setCarriers] = useState([]);
  const [rows,     setRows]     = useState([]);     // one per order
  const [format,   setFormat]   = useState(DEFAULT_FORMAT);
  const [loading,  setLoading]  = useState(true);
  const [busy,     setBusy]     = useState(false);
  const [err,      setErr]      = useState('');
  const [previewUrl, setPreviewUrl] = useState(null);
  const iframeRef = useRef(null);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Revoke any blob URL when the preview is replaced or modal closes —
  // browser otherwise leaks the buffer until the tab is closed.
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  // Load carrier preset list + per-order data when the modal opens.
  useEffect(() => {
    if (!open || !orderIds?.length) return;
    setLoading(true); setErr('');
    (async () => {
      try {
        const [carrRes, ...orderRes] = await Promise.all([
          fetch(`${API_BASE}/api/shipping-carriers`, { credentials: 'include' }),
          ...orderIds.map(id =>
            fetch(`${API_BASE}/api/orders/${id}${pq}`, { credentials: 'include' })
              .then(r => r.ok ? r.json() : null)
              .catch(() => null)
          ),
        ]);
        const carrJson = carrRes.ok ? await carrRes.json() : { items: [] };
        setCarriers(carrJson.items || []);
        const fetched = orderRes.filter(Boolean);
        setRows(fetched.map(o => ({
          id:              o.id,
          recipient_name:  o.recipient_name || '',
          address:         o.address || '',
          carrier_id:      o.carrier_id ?? null,
          tracking_number: o.tracking_number || '',
          package_count:   o.package_count || 1,
          ship_weight_grams: o.ship_weight_grams ?? null,
        })));
      } finally {
        setLoading(false);
      }
    })();
  }, [open, orderIds, pq]);

  // Trigger an automatic preview refresh after every meaningful edit.
  // 350 ms debounce mirrors PrintBarcodesModal — long enough to coalesce
  // a burst of typing into one request, short enough that the merchant
  // sees the change before they expect a delay.
  //
  // Critical: the preview endpoint reads order rows from the DB, so
  // we MUST persist every local edit (carrier / tracking / packages)
  // before fetching the PDF. Otherwise the preview shows stale values
  // — exactly the bug we hit when typing a new tracking number didn't
  // refresh the preview until the input lost focus.
  useEffect(() => {
    if (!open || loading || rows.length === 0) return;
    const ready = rows.every(r => r.carrier_id && r.tracking_number);
    if (!ready) { setPreviewUrl(null); return; }
    const t = setTimeout(async () => {
      // PATCH every row's current local state, then generate preview.
      // Sequencing matters: the bulk PDF endpoint reads from DB right
      // after these complete.
      await persistAll();
      await generatePreview();
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading, rows, format]);

  const updateRow = (id, patch) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  };

  // Persist a single field for one order — fires on blur as a backup
  // (the debounced effect above does the heavy lifting now, but blur
  // is still useful for "user filled it and tabbed away" cases).
  const persistRow = async (id, patch) => {
    try {
      const res = await fetch(`${API_BASE}/api/orders/${id}/shipping${pq}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) setErr('Failed to save tracking — preview may be stale');
    } catch {
      setErr('Network error while saving — try again');
    }
  };

  // Persist all row local-state to the backend in parallel. Called
  // right before each preview regeneration so the DB matches what
  // the user sees in the inputs.
  const persistAll = async () => {
    try {
      await Promise.all(rows.map(r =>
        fetch(`${API_BASE}/api/orders/${r.id}/shipping${pq}`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            carrier_id:        r.carrier_id,
            tracking_number:   r.tracking_number,
            package_count:     r.package_count,
            ship_weight_grams: r.ship_weight_grams ?? null,
          }),
        })
      ));
    } catch {
      setErr('Failed to save changes — preview may be stale');
    }
  };

  const generatePreview = async () => {
    setBusy(true); setErr('');
    try {
      const res = await fetch(`${API_BASE}/api/orders/shipping-label/bulk${pq}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_ids: rows.map(r => r.id), format }),
      });
      if (!res.ok) { setErr('Server error generating PDF'); return; }
      const blob = await res.blob();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch {
      setErr('Network error generating PDF');
    } finally {
      setBusy(false);
    }
  };

  // Send to printer via iframe. Browsers without iframe-print support
  // (rare; some old Safari) fall back to the download button.
  const triggerPrint = () => {
    const f = iframeRef.current;
    if (!f) return;
    try { f.contentWindow.focus(); f.contentWindow.print(); }
    catch { setErr('Print failed — try downloading instead'); }
  };

  const downloadPdf = () => {
    if (!previewUrl) return;
    const a = document.createElement('a');
    a.href = previewUrl;
    a.download = `shipping-labels-${Date.now()}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
  };

  // Estimated total label count = Σ package_count over all rows. Used
  // in the "Print N labels" button so the merchant knows what's coming
  // off the printer before they hit go.
  const totalLabels = useMemo(
    () => rows.reduce((s, r) => s + Math.max(1, r.package_count || 1), 0),
    [rows]
  );

  // Order-row level check: all carriers picked AND all tracking nums
  // entered. We show this near the button so it's obvious why Print
  // might be disabled.
  const missingFields = useMemo(() => {
    const missing = [];
    for (const r of rows) {
      if (!r.carrier_id)             missing.push(`Order #${r.id}: pick carrier`);
      if (!r.tracking_number?.trim()) missing.push(`Order #${r.id}: enter tracking number`);
    }
    return missing;
  }, [rows]);

  if (!open) return null;

  return createPortal(
    <div className="auth-modal-overlay print-bc-split-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="print-bc-split-pair psl-pair"
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>

        {/* LEFT — order table + format picker + print actions */}
        <div className="auth-modal cpm-modal print-bc-modal-left psl-modal"
          onClick={(e) => e.stopPropagation()}>
          <div className="auth-modal-head">
            <div className="auth-modal-title-row">
              <div>
                <div className="auth-modal-title">Print shipping labels</div>
                <div className="auth-modal-subtitle-row">
                  <span className="auth-modal-subtitle">
                    <b>{rows.length}</b> order{rows.length === 1 ? '' : 's'}
                    {' · '}
                    <b>{totalLabels}</b> label{totalLabels === 1 ? '' : 's'} total
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="auth-modal-body print-bc-body">
            <form className="cpm-form" onSubmit={(e) => e.preventDefault()}>

              <div className="cpm-section">
                <label className="po-field-label">Format</label>
                <Combobox value={format} options={FORMAT_OPTIONS} onChange={setFormat} />
                <span className="cpm-section-hint">
                  Thermal 100×150 mm is the standard CDEK / Kazpost / Pochta roll. Use A4
                  variants if you only have an office laser/inkjet printer.
                </span>
              </div>

              <div className="cpm-section">
                <label className="po-field-label">Orders</label>
                {loading ? (
                  <div className="crm-placeholder">Loading orders…</div>
                ) : (
                  <div className="psl-rows">
                    {rows.map(r => (
                      <div key={r.id} className="psl-row">
                        <div className="psl-row-head">
                          <span className="po-set-strong">Order #{r.id}</span>
                          <span className="po-set-note">{r.recipient_name || '—'}</span>
                        </div>
                        <div className="psl-row-addr">{r.address || ''}</div>
                        {/* Stack the three editable fields vertically.
                            Earlier we tried a 3-column grid but the
                            tallest cell (Combobox button) forced the
                            row to grow and `align-items: end` left a
                            huge gap above the Packages input. Vertical
                            stacking is predictable + plays nicely with
                            the responsive modal width. */}
                        <div className="psl-field">
                          <label className="po-field-label">Carrier</label>
                          {/* Same searchable combobox style as New
                              Warehouse → Country picker. Keeps the
                              UI consistent across the CRM. */}
                          <SearchCombo
                            value={r.carrier_id ? String(r.carrier_id) : ''}
                            placeholder="Select carrier"
                            options={carriers.map(c => ({
                              value: String(c.id),
                              label: c.country_code
                                ? `${c.name} · ${c.country_code}`
                                : c.name,
                            }))}
                            onChange={(v) => {
                              const cid = v ? parseInt(v, 10) : null;
                              updateRow(r.id, { carrier_id: cid });
                              persistRow(r.id, { carrier_id: cid });
                            }} />
                        </div>
                        <div className="psl-field">
                          <label className="po-field-label">Tracking number</label>
                          <input type="text" className="crm-input"
                            value={r.tracking_number}
                            onChange={(e) => updateRow(r.id, { tracking_number: e.target.value })}
                            onBlur={(e) => persistRow(r.id, { tracking_number: e.target.value })}
                            placeholder="Tracking ID from carrier"
                            maxLength={100} />
                        </div>
                        <div className="psl-field psl-field--packages">
                          <label className="po-field-label">Packages</label>
                          <input type="number" className="crm-input"
                            min="1" max="999"
                            value={r.package_count}
                            onChange={(e) => {
                              const pc = Math.max(1, Math.min(999,
                                parseInt(e.target.value || '1', 10)));
                              updateRow(r.id, { package_count: pc });
                            }}
                            onBlur={(e) => persistRow(r.id, {
                              package_count: parseInt(e.target.value || '1', 10),
                            })} />
                        </div>
                        {/* Weight (kg) override. Leave blank → label auto-sums the
                            per-SKU weights (the merchant sees that figure in the
                            preview); type a value to override (e.g. + packaging). */}
                        <div className="psl-field psl-field--packages">
                          <label className="po-field-label">Weight (kg)</label>
                          <input type="number" className="crm-input"
                            min="0" step="0.01"
                            value={r.ship_weight_grams != null ? (r.ship_weight_grams / 1000) : ''}
                            onChange={(e) => {
                              const v = e.target.value;
                              const kg = parseFloat(v);
                              const g = (v === '' || isNaN(kg)) ? null : Math.max(0, Math.round(kg * 1000));
                              updateRow(r.id, { ship_weight_grams: g });
                            }}
                            onBlur={(e) => {
                              const v = e.target.value;
                              const kg = parseFloat(v);
                              const g = (v === '' || isNaN(kg)) ? null : Math.max(0, Math.round(kg * 1000));
                              persistRow(r.id, { ship_weight_grams: g });
                            }}
                            placeholder="Auto from product weights" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {missingFields.length > 0 && (
                  <span className="cpm-section-hint" style={{ color: 'var(--accent)' }}>
                    Fill carrier + tracking for every order to enable Print.
                  </span>
                )}
              </div>
            </form>
          </div>

          {/* Sticky action footer — identical structure to
              PrintBarcodesModal so the existing .print-bc-footer +
              .print-bc-actions + .print-bc-download-btn CSS rules
              kick in automatically. */}
          <div className="print-bc-footer">
            {err && <p className="auth-msg auth-msg--err print-bc-footer-err">{err}</p>}
            <div className="auth-actions print-bc-actions">
              <button type="button" className="crm-submit-btn"
                disabled={busy || !previewUrl || missingFields.length > 0}
                onClick={triggerPrint}>
                Print {totalLabels} label{totalLabels === 1 ? '' : 's'}
              </button>
              <button type="button" className="auth-btn-check print-bc-download-btn"
                disabled={!previewUrl}
                onClick={downloadPdf} title="Download PDF">
                <DownloadSimple weight="bold" />
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT — live PDF preview inside iframe */}
        <div className="auth-modal print-bc-modal-right" onClick={(e) => e.stopPropagation()}>
          <div className="auth-modal-head">
            <div className="auth-modal-title-row">
              <div>
                <div className="auth-modal-title">Preview</div>
                <div className="auth-modal-subtitle-row">
                  <span className="auth-modal-subtitle">
                    Exactly what comes off the printer
                  </span>
                </div>
              </div>
            </div>
            <button className="auth-modal-close" onClick={onClose} type="button">
              <X className="auth-modal-close-icon" />
            </button>
          </div>
          <div className="auth-modal-body print-bc-preview-body">
            <div className="print-bc-preview">
              {busy && <div className="print-bc-busy">Generating preview…</div>}
              {!busy && !previewUrl && (
                <div className="print-bc-empty">
                  {missingFields.length > 0
                    ? 'Fill in carrier + tracking number above to see the label'
                    : 'Adjust settings to see a live preview'}
                </div>
              )}
              {previewUrl && (
                <iframe ref={iframeRef} title="Shipping label preview"
                  src={previewUrl} className="print-bc-iframe" />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
