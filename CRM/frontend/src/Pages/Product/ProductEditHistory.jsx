// Product Edit history — audit trail for one product:
//   • Stock history — immutable log of every stock change (delta, reason, who, when).
//   • Restock waitlist — customers who clicked "Notify me" while OOS.
//
// The per-warehouse stock matrix used to live here too, but is already covered
// by the project-level Products → Inventory page (which shows every product at
// once). Keeping two parallel views of the same data was confusing — this page
// is now purely historical.

import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext, useParams } from 'react-router-dom';
import { API_BASE } from '../../api.js';
import { decodeHash } from '../../Utils/hashids.js';
import { PoListRow } from '../../Utils/PoListRow.jsx';
import '../../Style/Authentication.css';
import '../../Style/Products.css';

// Audit-log label map — needs every reason that's been used historically so the
// log still renders even for old rows. New reasons are listed first; legacy values
// (restock, return, transfer, reservation, batch_receive) kept at the bottom for
// back-compat.
const REASON_LABELS = {
  supplier_delivery: 'Supplier delivery',
  initial_inventory: 'Initial inventory',
  customer_return:   'Customer return',
  production:        'Production',
  recount_adjust:    'Recount adjust',
  transfer_in:       'Transfer in',
  transfer_out:      'Transfer out',
  damage:            'Damage',
  manual:            'Manual',
  other:             'Other',
  // Legacy values that may still appear in product_stock_log rows:
  sale: 'Sale', restock: 'Restock', return: 'Return',
  transfer: 'Transfer', reservation: 'Reservation', batch_receive: 'Batch receive',
};

export default function ProductEditHistory() {
  const { projectId, setProductContext } = useOutletContext();
  const { productHash } = useParams();
  const productId = decodeHash(productHash);
  const pq = `?project_id=${projectId}`;

  const [product,  setProduct]  = useState(null);
  const [log,      setLog]      = useState([]);
  const [waitlist, setWaitlist] = useState([]);
  const [toast,    setToast]    = useState('');

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2400);
  }, []);

  const load = useCallback(async () => {
    const [p, l, w] = await Promise.all([
      fetch(`${API_BASE}/api/products/${productId}${pq}`,                       { credentials: 'include' }).then(r => r.ok ? r.json() : null),
      fetch(`${API_BASE}/api/products/${productId}/stock/log${pq}`,             { credentials: 'include' }).then(r => r.ok ? r.json() : []),
      fetch(`${API_BASE}/api/products/${productId}/restock-subscriptions${pq}`, { credentials: 'include' }).then(r => r.ok ? r.json() : []),
    ]);
    setProduct(p);
    setLog(Array.isArray(l) ? l : []);
    setWaitlist(Array.isArray(w) ? w : []);
    if (p) setProductContext?.({ name: p.title, hash: productHash });
  }, [productId, pq, productHash, setProductContext]);

  useEffect(() => { load(); return () => setProductContext?.(null); }, [load]); // eslint-disable-line

  if (!product) return <p className="crm-placeholder">Loading…</p>;

  return (
    <div className="prod-page po-page">
      <h1 className="crm-page-title">Edit history · {product.title}</h1>

      <section className="po-block">
        <h2 className="po-block-title">Stock history</h2>
        <p className="po-block-hint">
          Immutable audit log of every change to per-SKU stock. Most recent first.
          {' '}Last 100 events. Stock itself is edited from <strong>Products → Inventory</strong>.
        </p>
        {log.length === 0 ? (
          <p className="crm-placeholder">No stock changes yet.</p>
        ) : (
          <div className="po-set-table">
            <div className="po-set-row po-set-row--head po-set-row--audit">
              <span>When</span><span>SKU</span><span>Warehouse</span>
              <span>Change</span><span>Reason</span><span>Batch</span>
              <span>By</span><span>Note</span>
            </div>
            {log.map(e => (
              <PoListRow key={e.id} className="po-set-row--audit">
                <span>{e.created_at?.slice(0, 16).replace('T', ' ')}</span>
                <span>{e.sku_name || `#${e.sku_id}`}</span>
                <span className="po-set-note">
                  {e.warehouse_name || (e.warehouse_id ? `#${e.warehouse_id}` : '—')}
                </span>
                <span className={`po-stock-delta po-stock-delta--${e.delta >= 0 ? 'up' : 'down'}`}>
                  {e.delta >= 0 ? '+' : ''}{e.delta}
                </span>
                <span>{REASON_LABELS[e.reason] || e.reason}</span>
                <span className="po-set-note">
                  {e.batch_name || <span className="po-set-note">—</span>}
                </span>
                <span>{e.user_name || (e.user_id ? `#${e.user_id}` : 'system')}</span>
                <span className="po-eh-note" title={e.note}>{e.note}</span>
              </PoListRow>
            ))}
          </div>
        )}
      </section>

      <section className="po-block">
        <h2 className="po-block-title">Restock waitlist</h2>
        <p className="po-block-hint">
          Customers who clicked "Notify me" while this product was out of stock.
          They get an email automatically once a restock is recorded.
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

      {toast && createPortal(
        <div className="auth-toast">{toast}</div>,
        document.body,
      )}
    </div>
  );
}
