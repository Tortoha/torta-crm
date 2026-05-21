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
import { useTranslation } from 'react-i18next';
import { API_BASE } from '../../api.js';
import { decodeHash } from '../../Utils/hashids.js';
import { PoListRow } from '../../Utils/PoListRow.jsx';
import '../../Style/Authentication.css';
import '../../Style/Products.css';

// Audit-log reason keys — needs every reason that's been used historically so the
// log still renders even for old rows. New reasons are listed first; legacy values
// (restock, return, transfer, reservation, batch_receive) kept at the bottom for
// back-compat. Translated via productDetail.history.reason.<key>.
const REASON_KEYS = new Set([
  'supplier_delivery', 'initial_inventory', 'customer_return', 'production',
  'recount_adjust', 'transfer_in', 'transfer_out', 'damage', 'manual', 'other',
  'sale', 'restock', 'return', 'transfer', 'reservation', 'batch_receive',
]);

export default function ProductEditHistory() {
  const { t } = useTranslation();
  const reasonLabel = (r) => REASON_KEYS.has(r) ? t(`productDetail.history.reason.${r}`) : r;
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

  if (!product) return <p className="crm-placeholder">{t('common.loading')}</p>;

  return (
    <div className="prod-page po-page">
      <h1 className="crm-page-title">{t('productDetail.history.title')} · {product.title}</h1>

      <section className="po-block">
        <h2 className="po-block-title">{t('productDetail.history.stockTitle')}</h2>
        <p className="po-block-hint">
          {t('productDetail.history.stockHintPre')}
          {' '}<strong>{t('productDetail.history.stockHintProducts')}</strong>.
        </p>
        {log.length === 0 ? (
          <p className="crm-placeholder">{t('productDetail.history.stockEmpty')}</p>
        ) : (
          <div className="po-set-table">
            <div className="po-set-row po-set-row--head po-set-row--audit">
              <span>{t('productDetail.history.colWhen')}</span><span>{t('productDetail.history.colSku')}</span><span>{t('productDetail.history.colWarehouse')}</span>
              <span>{t('productDetail.history.colChange')}</span><span>{t('productDetail.history.colReason')}</span><span>{t('productDetail.history.colBatch')}</span>
              <span>{t('productDetail.history.colBy')}</span><span>{t('productDetail.history.colNote')}</span>
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
                <span>{reasonLabel(e.reason)}</span>
                <span className="po-set-note">
                  {e.batch_name || <span className="po-set-note">—</span>}
                </span>
                <span>{e.user_name || (e.user_id ? `#${e.user_id}` : t('productDetail.history.system'))}</span>
                <span className="po-eh-note" title={e.note}>{e.note}</span>
              </PoListRow>
            ))}
          </div>
        )}
      </section>

      <section className="po-block">
        <h2 className="po-block-title">{t('productDetail.history.waitlistTitle')}</h2>
        <p className="po-block-hint">
          {t('productDetail.history.waitlistHint')}
        </p>
        {waitlist.length === 0 ? (
          <p className="crm-placeholder">{t('productDetail.history.waitlistEmpty')}</p>
        ) : (
          <div className="po-set-table">
            <div className="po-set-row po-set-row--head po-set-row--3">
              <span>{t('productDetail.history.colEmail')}</span><span>{t('productDetail.history.colSku')}</span><span>{t('productDetail.history.colSubscribed')}</span><span>{t('productDetail.history.colNotified')}</span>
            </div>
            {waitlist.map(w => (
              <PoListRow key={w.id} className="po-set-row--3">
                <span>{w.email}</span>
                <span>{w.sku_id ? `#${w.sku_id}` : t('productDetail.history.any')}</span>
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
