// Product Inventory — per-warehouse tree of THIS product's SKUs; Edit opens (sku,warehouse) cell modal posting delta.

import { Fragment, useEffect, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext, useParams } from 'react-router-dom';
import {
  X, CaretDown, CaretRight, Cube, PencilSimple,
} from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { decodeHash } from '../../Utils/hashids.js';
import { Combobox } from '../Project/Booking/BookingCreateModal.jsx';
import { PoListRow } from '../../Utils/PoListRow.jsx';
import '../../Style/Authentication.css';
import '../../Style/Products.css';

const REASON_OPTIONS = [
  { value: 'restock', label: 'Restock' },
  { value: 'manual',  label: 'Manual correction' },
  { value: 'damage',  label: 'Damage / write-off' },
  { value: 'transfer',label: 'Transfer' },
  { value: 'return',  label: 'Customer return' },
];

const REASON_LABELS = {
  sale: 'Sale', restock: 'Restock', manual: 'Manual', return: 'Return',
  damage: 'Damage', transfer: 'Transfer', reservation: 'Reservation',
};

// Same column set as Products → Inventory so the trees feel like the same widget.
const COLS = '2.6fr 1fr 1fr 1fr 110px';

export default function ProductInventory() {
  const { projectId, setProductContext } = useOutletContext();
  const { productHash } = useParams();
  const productId = decodeHash(productHash);
  const pq = `?project_id=${projectId}`;

  const [product,  setProduct]  = useState(null);
  const [matrix,   setMatrix]   = useState([]);   // per-SKU per-WH stock matrix
  const [log,      setLog]      = useState([]);
  const [waitlist, setWaitlist] = useState([]);
  const [editTarget, setEditTarget] = useState(null);
  const [toast, setToast] = useState('');

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2400);
  }, []);

  const load = useCallback(async () => {
    const [p, m, l, w] = await Promise.all([
      fetch(`${API_BASE}/api/products/${productId}${pq}`,                          { credentials: 'include' }).then(r => r.ok ? r.json() : null),
      fetch(`${API_BASE}/api/products/${productId}/stock/per-warehouse${pq}`,      { credentials: 'include' }).then(r => r.ok ? r.json() : []),
      fetch(`${API_BASE}/api/products/${productId}/stock/log${pq}`,                { credentials: 'include' }).then(r => r.ok ? r.json() : []),
      fetch(`${API_BASE}/api/products/${productId}/restock-subscriptions${pq}`,    { credentials: 'include' }).then(r => r.ok ? r.json() : []),
    ]);
    setProduct(p);
    setMatrix(Array.isArray(m) ? m : []);
    setLog(Array.isArray(l) ? l : []);
    setWaitlist(Array.isArray(w) ? w : []);
    if (p) setProductContext?.({ name: p.title, hash: productHash });
  }, [productId, pq, productHash, setProductContext]);

  useEffect(() => { load(); return () => setProductContext?.(null); }, [load]); // eslint-disable-line

  if (!product) return <p className="crm-placeholder">Loading…</p>;

  // Active WHs from the matrix — every SKU lists the same set, so first row is safe.
  const warehouses = matrix[0]?.warehouses?.map(w => ({
    id: w.warehouse_id, name: w.name, code: w.code, is_default: w.is_default,
  })) || [];

  // Variation image lookup — per-WH endpoint omits images, full product detail has them.
  const variationImageById = {};
  for (const v of (product.variations || [])) {
    variationImageById[v.id] = v.images?.[0] || null;
  }

  return (
    <div className="prod-page po-page">
      <h1 className="crm-page-title">Inventory · {product.title}</h1>

      <ProductWarehouseGroups
        warehouses={warehouses}
        matrix={matrix}
        variationImageById={variationImageById}
        onEdit={setEditTarget} />

      <section className="po-block">
        <h2 className="po-block-title">Stock history</h2>
        <p className="po-block-hint">
          Immutable audit log of every change to per-SKU stock. Most recent first.
          {' '}Last 100 events.
        </p>
        {log.length === 0 ? (
          <p className="crm-placeholder">No stock changes yet.</p>
        ) : (
          <div className="po-set-table">
            <div className="po-set-row po-set-row--head po-set-row--6">
              <span>When</span><span>SKU</span><span>Warehouse</span>
              <span>Change</span><span>Reason</span><span>By</span><span>Note</span>
            </div>
            {log.map(e => {
              const wh = warehouses.find(w => w.id === e.warehouse_id);
              return (
                <PoListRow key={e.id} className="po-set-row--6">
                  <span>{e.created_at?.slice(0, 16).replace('T', ' ')}</span>
                  <span>{e.sku_name || `#${e.sku_id}`}</span>
                  <span className="po-set-note">{wh?.name || (e.warehouse_id ? `#${e.warehouse_id}` : '—')}</span>
                  <span className={`po-stock-delta po-stock-delta--${e.delta >= 0 ? 'up' : 'down'}`}>
                    {e.delta >= 0 ? '+' : ''}{e.delta}
                  </span>
                  <span>{REASON_LABELS[e.reason] || e.reason}</span>
                  <span>{e.user_name || (e.user_id ? `#${e.user_id}` : 'system')}</span>
                  <span className="po-set-note">{e.note}</span>
                </PoListRow>
              );
            })}
          </div>
        )}
      </section>

      <section className="po-block">
        <h2 className="po-block-title">Restock waitlist</h2>
        <p className="po-block-hint">
          Customers who clicked "Notify me" while this product was out of stock.
          They get an email automatically when the next restock is recorded above.
        </p>
        {waitlist.length === 0 ? (
          <p className="crm-placeholder">No subscribers yet.</p>
        ) : (
          <div className="po-set-table">
            <div className="po-set-row po-set-row--head po-set-row--3">
              <span>Email</span><span>SKU</span><span>Subscribed</span><span>Notified</span>
            </div>
            {waitlist.map(w => (
              <PoListRow key={w.id} className="po-set-row--3">
                <span>{w.email}</span>
                <span>{w.sku_id ? `#${w.sku_id}` : 'any'}</span>
                <span>{w.created_at?.slice(0, 10)}</span>
                <span>{w.notified_at ? w.notified_at.slice(0, 10) : '—'}</span>
              </PoListRow>
            ))}
          </div>
        )}
      </section>

      {editTarget && (
        <CellEditModal target={editTarget} pq={pq} productId={productId}
          onClose={() => setEditTarget(null)}
          onSaved={() => { load(); showToast('Stock updated'); setEditTarget(null); }}
          showToast={showToast} />
      )}

      {toast && createPortal(
        <div className="auth-toast">{toast}</div>,
        document.body,
      )}
    </div>
  );
}

// ── Warehouse-grouped tree — variation→SKU per WH; clicking SKU opens (sku,WH) edit modal.
function ProductWarehouseGroups({ warehouses, matrix, variationImageById, onEdit }) {
  // Defaults to all WHs open; collapses remembered per-WH.
  const [openWh,  setOpenWh]  = useState(() => new Set());
  const [openVar, setOpenVar] = useState(() => new Set());

  useEffect(() => {
    setOpenWh(prev => prev.size === 0 && warehouses.length > 0
      ? new Set(warehouses.map(w => w.id))
      : prev);
  }, [warehouses]);

  const toggleWh  = (id)  => setOpenWh(p => { const n = new Set(p); n.has(id)  ? n.delete(id)  : n.add(id);  return n; });
  const toggleVar = (key) => setOpenVar(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // Flip per-SKU matrix into per-WH groups: { wh_id: Map<variation_id, {name, image, skus}> }.
  const tree = useMemo(() => {
    const byWh = {};
    for (const w of warehouses) byWh[w.id] = new Map();
    for (const s of matrix) {
      for (const wh of (s.warehouses || [])) {
        const wId = wh.warehouse_id;
        if (!byWh[wId]) continue;
        let entry = byWh[wId].get(s.variation_id);
        if (!entry) {
          entry = {
            variation_id:   s.variation_id,
            variation_name: s.variation_name,
            variation_image: variationImageById[s.variation_id] || null,
            skus:           [],
          };
          byWh[wId].set(s.variation_id, entry);
        }
        entry.skus.push({
          sku_id:    s.sku_id,
          sku_name:  s.sku_name,
          sku_code:  s.sku_code,
          quantity:  wh.quantity,
          sold:      wh.sold_quantity || 0,
        });
      }
    }
    return byWh;
  }, [warehouses, matrix, variationImageById]);

  if (warehouses.length === 0) {
    return <p className="crm-placeholder">No active warehouses.</p>;
  }
  if (matrix.length === 0) {
    return <p className="crm-placeholder">No SKUs yet — add variations / configurations first.</p>;
  }

  return (
    <>
      {warehouses.map(w => {
        const variations = Array.from(tree[w.id]?.values() || []);
        const totalQty  = variations.reduce((a, v) => a + v.skus.reduce((b, s) => b + s.quantity, 0), 0);
        const totalSold = variations.reduce((a, v) => a + v.skus.reduce((b, s) => b + s.sold,     0), 0);
        const isOpen    = openWh.has(w.id);

        return (
          <section key={w.id} className="prod-group po-wh-group">
            <h2 className="prod-group-title po-wh-group-title" onClick={() => toggleWh(w.id)}>
              <CaretDown weight="bold"
                className={`po-wh-group-caret${isOpen ? '' : ' po-wh-group-caret--closed'}`} />
              {w.name}
              {w.is_default && <span className="po-pwh-default-mark"> · default</span>}
              <span className="prod-group-count">{variations.length}</span>
              <span className="po-set-note po-tree-meta">· {totalQty} units · {totalSold} sold</span>
            </h2>

            {isOpen && (
              variations.length === 0 ? (
                <p className="crm-placeholder">No stock in this warehouse yet.</p>
              ) : (
                <div className="po-set-table">
                  <div className="po-set-row po-set-row--head"
                    style={{ gridTemplateColumns: COLS }}>
                    <span>Name</span><span>SKU code</span><span>Stock</span>
                    <span>Sold</span><span></span>
                  </div>

                  {variations.map(v => {
                    const vKey  = `${w.id}:${v.variation_id}`;
                    const vOpen = openVar.has(vKey);
                    const vQty  = v.skus.reduce((a, s) => a + s.quantity, 0);
                    const vSold = v.skus.reduce((a, s) => a + s.sold,     0);
                    return (
                      <Fragment key={vKey}>
                        <PoListRow className="po-tree-row"
                          style={{ gridTemplateColumns: COLS }}
                          onClick={() => toggleVar(vKey)}>
                          <NameCell depth={0}
                            chevron={vOpen ? 'open' : 'closed'}
                            onChevron={() => toggleVar(vKey)}
                            icon={v.variation_image
                              ? <img src={v.variation_image} alt="" className="po-tree-avatar" />
                              : <span className="po-tree-avatar-fallback" />}>
                            <span className="po-set-strong">{v.variation_name || '—'}</span>
                            <span className="po-set-note po-tree-meta">
                              · {v.skus.length} SKU{v.skus.length === 1 ? '' : 's'}
                            </span>
                          </NameCell>
                          <span></span>
                          <span className="po-stock-cell po-tree-stock--variation">{vQty}</span>
                          <span className="po-numeric-muted">{vSold}</span>
                          <span></span>
                        </PoListRow>

                        {vOpen && v.skus.map(s => {
                          const payload = {
                            sku_id:           s.sku_id,
                            sku_label:        `${v.variation_name} / ${s.sku_name}`,
                            warehouse_id:     w.id,
                            warehouse_name:   w.name,
                            current_quantity: s.quantity,
                          };
                          return (
                            <PoListRow key={`${vKey}-${s.sku_id}`}
                              className="po-tree-row"
                              style={{ gridTemplateColumns: COLS }}
                              onClick={() => onEdit(payload)}>
                              <NameCell depth={1} icon={<Cube className="po-disc-cell--muted" />}>
                                <span>{s.sku_name || '—'}</span>
                              </NameCell>
                              <span className="po-set-note">{s.sku_code || '—'}</span>
                              <span className="po-stock-cell">{s.quantity}</span>
                              <span className="po-numeric-muted">{s.sold || 0}</span>
                              <button type="button" className="po-edit-btn"
                                onClick={(e) => { e.stopPropagation(); onEdit(payload); }}>
                                <PencilSimple weight="bold" /> Edit
                              </button>
                            </PoListRow>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </div>
              )
            )}
          </section>
        );
      })}
    </>
  );
}

// ── Tree primitives (mirror Products → Inventory) ────────────────────

function NameCell({ depth = 0, chevron, onChevron, icon, children }) {
  const padLeft = 8 + depth * 24;
  return (
    <span className="po-tree-name-cell" style={{ paddingLeft: padLeft }}>
      {chevron ? (
        <button type="button" className="po-tree-chevron"
          onClick={(e) => { e.stopPropagation(); onChevron?.(); }}
          aria-label={chevron === 'open' ? 'Collapse' : 'Expand'}>
          {chevron === 'open' ? <CaretDown weight="bold" /> : <CaretRight weight="bold" />}
        </button>
      ) : (
        <span className="po-tree-chevron-spacer" />
      )}
      {icon && <span className="po-tree-icon">{icon}</span>}
      {children}
    </span>
  );
}

// ── Cell-edit modal — edits one (sku, warehouse) pair via diff-as-delta ──

function CellEditModal({ target, pq, productId, onClose, onSaved, showToast }) {
  const [newQty, setNewQty]   = useState(String(target.current_quantity));
  const [reason, setReason]   = useState('manual');
  const [note,   setNote]     = useState('');
  const [busy,   setBusy]     = useState(false);

  const parsed = parseInt(newQty, 10);
  const delta  = isNaN(parsed) ? null : parsed - target.current_quantity;
  const valid  = delta != null && delta !== 0 && parsed >= 0;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/products/${productId}/stock/adjust${pq}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku_id: target.sku_id, delta, reason, note,
          warehouse_id: target.warehouse_id,
        }),
      });
      if (r.ok) onSaved?.();
      else { const j = await r.json().catch(() => ({})); showToast(j.detail || 'Failed'); }
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal po-edit-stock-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">Edit stock</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {target.sku_label} · <strong>{target.warehouse_name}</strong>
                  {' · current '}<strong>{target.current_quantity}</strong>
                </span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body">
          <form className="cpm-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <div className="cpm-section">
              <label className="po-field-label">New quantity</label>
              <input className="crm-input" type="number" min="0" autoFocus
                value={newQty} onChange={e => setNewQty(e.target.value)} />
              <span className="cpm-section-hint">
                {delta == null
                  ? 'Type a non-negative integer.'
                  : delta === 0
                    ? 'Same as current value — nothing will change.'
                    : <>Will record a <strong>{delta > 0 ? '+' : ''}{delta}</strong> change in this warehouse.</>}
              </span>
            </div>
            <div className="cpm-section">
              <label className="po-field-label">Reason</label>
              <Combobox value={reason} options={REASON_OPTIONS}
                onChange={(v) => setReason(v)} />
            </div>
            <div className="cpm-section">
              <label className="po-field-label">Note (optional)</label>
              <input className="crm-input" type="text" maxLength={500}
                placeholder="Why this change? (e.g. supplier #4521)"
                value={note} onChange={e => setNote(e.target.value)} />
            </div>
            <div className="auth-actions po-disc-actions">
              <button className="crm-submit-btn" type="submit" disabled={!valid || busy}>
                {busy ? 'Saving…' : 'Apply'}
              </button>
              <button type="button" className="crm-submit-btn auth-btn-secondary po-disc-cancel-btn"
                onClick={onClose} disabled={busy}>Cancel</button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  );
}
