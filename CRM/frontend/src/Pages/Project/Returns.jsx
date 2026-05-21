// Returns / Refunds workflow — customer-initiated within 14 days.
// 5-stage lifecycle: requested → approved → received → inspected → refunded
// Terminal: rejected | cancelled
// List groups returns by what merchant must do now: Action / In progress / Completed / Closed.
// Detail modal walks through the 5-stage stepper.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import {
  X, MagnifyingGlass, ArrowUUpLeft, CheckCircle, ArrowRight, Warning,
} from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { formatMoney } from '../../Utils/currency.js';
import { safeHttpUrl } from '../../Utils/safeUrl.js';
import { InteractiveSection } from '../../Utils/InteractiveSection.js';
import { Combobox } from './Booking/BookingCreateModal.jsx';
import '../../Style/Authentication.css';
import '../../Style/Products.css';
import '../../Style/Returns.css';

// ── Constants ──────────────────────────────────────────────────

const STATUS_CLS = {
  requested:  'ret-badge--requested',
  approved:   'ret-badge--approved',
  received:   'ret-badge--received',
  inspected:  'ret-badge--inspected',
  refunded:   'ret-badge--refunded',
  rejected:   'ret-badge--rejected',
  cancelled:  'ret-badge--cancelled',
};

const statusLabel = (t, s) => STATUS_CLS[s] ? t(`orders.returns.status.${s}`) : s;
const reasonLabel = (t, r) => t(`orders.returns.reason.${r}`, { defaultValue: r });
const providerLabel = (t, p) => t(`orders.returns.provider.${p}`, { defaultValue: p });

const STEPS = ['requested', 'approved', 'received', 'inspected', 'refunded'];
const STEP_DESC_KEY = {
  requested: 'requestedDesc', approved: 'approvedDesc', received: 'receivedDesc',
  inspected: 'inspectedDesc', refunded: 'refundedDesc',
};

const GROUPS = [
  { key: 'action',   statuses: ['requested', 'received'] },
  { key: 'progress', statuses: ['approved', 'inspected'] },
  { key: 'done',     statuses: ['refunded'] },
  { key: 'closed',   statuses: ['rejected', 'cancelled'] },
];

// Tilt config for ReturnRow (matches ProdListRow's gentle 3D tilt).
const ROW_TILT = {
  maxAngleX: 6, maxAngleY: 2.5, lerp: 0.06, lerpOut: 0.08,
  scale: 1.012, perspective: 1000,
  gloss: { opacity: 0.10, spread: 60 },
};

// ── Helpers ────────────────────────────────────────────────────

const fmt = (n) => (+n).toFixed(2);
const fmtDate = (ts) => ts
  ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  : '';
const fmtDateLong = (ts) => ts
  ? new Date(ts).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  : '';

function groupOf(status) {
  for (const g of GROUPS) if (g.statuses.includes(status)) return g.key;
  return 'closed';
}

// ── Return row (list-table cell) ──────────────────────────────
// Same visual language as ProdListRow on Products page — single-row grid
// with 3D tilt + gloss. Columns: # · Customer · Order · Items · Reason · Status · Date.

function ReturnRow({ ret, onOpen, currency }) {
  const { t } = useTranslation();
  const { ref, glossRef, handlers } = InteractiveSection(ROW_TILT, false);
  const cls = STATUS_CLS[ret.status] ?? '';
  // Per-order snapshot wins (the order was placed in that currency);
  // only when an old row has no snapshot do we fall back to the
  // project's current currency.
  const cur = ret.payment_currency || currency;

  return (
    <div ref={ref}
      className="prow ret-prow"
      onClick={() => onOpen(ret)} {...handlers}>
      <div ref={glossRef} className="org-list-gloss" />
      <span className="prow-cell ret-prow-id">#{ret.id}</span>
      <span className="prow-cell ret-prow-customer">
        <span className="ret-prow-name">{ret.customer_name || ret.recipient_name || t('orders.returns.anonymous')}</span>
        {ret.customer_email && (
          <span className="ret-prow-email">{ret.customer_email}</span>
        )}
      </span>
      <span className="prow-cell">
        #{ret.order_id} · {formatMoney(ret.order_total, cur)}
      </span>
      <span className="prow-cell">
        {t('orders.returns.unitsCount', { count: ret.units_count })}
      </span>
      <span className="prow-cell">{reasonLabel(t, ret.reason)}</span>
      <span className="prow-cell">
        <span className={`ret-badge ${cls}`}>{statusLabel(t, ret.status)}</span>
      </span>
      <span className="prow-cell ret-prow-date">{fmtDate(ret.created_at)}</span>
    </div>
  );
}

// ── Group section ─────────────────────────────────────────────
// Same shape as ProductsList groups (Physical / Digital / Services):
// flat heading + count badge, then a `.prod-list` table with column heads.

function GroupSection({ group, items, onOpen, currency }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <section className="prod-group">
      <h2 className="prod-group-title">
        {t(`orders.returns.groups.${group.key}`)}
        <span className="prod-group-count">{items.length}</span>
      </h2>
      <div className="prod-list">
        <div className="prod-list-head ret-list-head">
          <span className="org-list-th">{t('orders.returns.colNumber')}</span>
          <span className="org-list-th">{t('orders.returns.colCustomer')}</span>
          <span className="org-list-th">{t('orders.returns.colOrder')}</span>
          <span className="org-list-th">{t('orders.returns.colItems')}</span>
          <span className="org-list-th">{t('orders.returns.colReason')}</span>
          <span className="org-list-th">{t('orders.returns.colStatus')}</span>
          <span className="org-list-th">{t('orders.returns.colDate')}</span>
        </div>
        <div className="prod-list-block">
          {items.map(ret => (
            <ReturnRow key={ret.id} ret={ret} onOpen={onOpen} currency={currency} />
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Stepper ───────────────────────────────────────────────────

function Stepper({ status }) {
  const { t } = useTranslation();
  const isTerminalReject = (status === 'rejected' || status === 'cancelled');
  // For a rejected return, the active step is whatever it was before — we'll just mark all done up to current.
  // Active = the next step waiting on action.
  let activeIdx;
  if (isTerminalReject) {
    activeIdx = -1;
  } else {
    const idx = STEPS.findIndex(s => s === status);
    activeIdx = idx === -1 ? 0 : idx;
  }

  return (
    <div className={`ret-stepper${isTerminalReject ? ' ret-stepper--rejected' : ''}`}>
      {STEPS.map((s, i) => {
        const done    = !isTerminalReject && i < activeIdx;
        const current = !isTerminalReject && i === activeIdx;
        const future  = isTerminalReject || (i > activeIdx);
        const cls = ['ret-step',
          done    && 'ret-step--done',
          current && 'ret-step--current',
          future  && 'ret-step--future',
        ].filter(Boolean).join(' ');
        return (
          <div key={s} className={cls}>
            <div className="ret-step-dot">{done ? '✓' : i + 1}</div>
            <div className="ret-step-info">
              <span className="ret-step-label">{statusLabel(t, s)}</span>
              <span className="ret-step-desc">{t(`orders.returns.steps.${STEP_DESC_KEY[s]}`)}</span>
            </div>
            {i < STEPS.length - 1 && <div className="ret-step-bar" />}
          </div>
        );
      })}
    </div>
  );
}

// ── Inspect item editor ───────────────────────────────────────

// Condition / Warehouse / Batch — all pickers use our custom Combobox
// (pill button + portal dropdown + DynamicBlock sliding indicator) so the
// modal stops mixing styled inputs with the OS-native <select> chrome.
const CONDITION_KEYS = ['pending', 'resellable', 'damaged', 'unrecoverable'];

function InspectItem({ item, value, onChange, warehouses, batchesBySku }) {
  const { t } = useTranslation();
  const CONDITION_OPTIONS = CONDITION_KEYS.map(k => ({
    value: k,
    label: t(`orders.returns.condition.${k === 'pending' ? 'pickOne' : k}`),
  }));
  const skuBatches = batchesBySku[item.configuration_id] || [];
  const filtered = value.restock_warehouse_id
    ? skuBatches.filter(b => b.warehouse_id === value.restock_warehouse_id)
    : skuBatches;

  // Combobox needs `value` to match an option exactly — '' for the "auto"
  // batch fallback, otherwise the numeric id stringified.
  const warehouseOptions = [
    { value: '', label: t('orders.returns.selectWarehouse') },
    ...warehouses.map(w => ({ value: w.id, label: w.name })),
  ];
  const batchOptions = [
    { value: '', label: t('orders.returns.autoBatch') },
    ...filtered.map(b => ({
      value: b.id,
      label: t('orders.returns.batchLabel', { name: b.batch_name, count: b.quantity_remaining }),
    })),
  ];

  return (
    <div className="ret-inspect-item">
      {item.image_url && (
        <img src={item.image_url} alt={item.title} className="ret-inspect-img" />
      )}
      <div className="ret-inspect-info">
        <div className="ret-inspect-title">{item.title}</div>
        <div className="ret-inspect-meta">
          {item.variation_name} · {item.configuration_name} · ×{item.quantity}
        </div>

        <div className="ret-inspect-row">
          <span className="ret-inspect-label">{t('orders.returns.inspectCondition')}</span>
          <Combobox value={value.condition} options={CONDITION_OPTIONS}
            onChange={(v) => onChange({
              ...value,
              condition: v,
              ...(v !== 'resellable'
                ? { restock_warehouse_id: null, restock_batch_id: null }
                : {}),
            })} />
        </div>

        {value.condition === 'resellable' && (
          <>
            <div className="ret-inspect-row">
              <span className="ret-inspect-label">{t('orders.returns.inspectWarehouse')}</span>
              <Combobox value={value.restock_warehouse_id || ''}
                options={warehouseOptions}
                placeholder={t('orders.returns.selectWarehouse')}
                onChange={(v) => onChange({
                  ...value,
                  restock_warehouse_id: v ? parseInt(v, 10) : null,
                  restock_batch_id: null,
                })} />
            </div>
            <div className="ret-inspect-row">
              <span className="ret-inspect-label">{t('orders.returns.inspectBatch')}</span>
              <Combobox value={value.restock_batch_id || ''}
                options={batchOptions}
                placeholder={t('orders.returns.autoBatch')}
                onChange={(v) => onChange({
                  ...value,
                  restock_batch_id: v ? parseInt(v, 10) : null,
                })} />
            </div>
          </>
        )}

        <textarea className="crm-input ret-inspect-notes"
          placeholder={t('orders.returns.itemNotes')}
          value={value.item_notes || ''}
          onChange={e => onChange({ ...value, item_notes: e.target.value })} />
      </div>
    </div>
  );
}

// ── Detail modal ──────────────────────────────────────────────

function ReturnDetailModal({ returnId, projectId, currency, onClose, onChanged }) {
  const { t } = useTranslation();
  // Detail modal uses the order's snapshot currency once `detail` is
  // loaded (`detail.payment_currency`). While loading, fall back to
  // the project's house currency from props.
  const cur = (s) => (s?.payment_currency) || currency;
  const [detail,  setDetail]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(false);
  const [toast,   setToast]   = useState('');

  // Workspace state for inspect step
  const [warehouses, setWarehouses] = useState([]);
  const [batches, setBatches]       = useState([]);
  const [inspectItems, setInspectItems] = useState({});
  const [inspectNotes, setInspectNotes] = useState('');

  // State for refund + reject
  const [refundAmount,    setRefundAmount]    = useState('');
  const [refundMethod,    setRefundMethod]    = useState('');
  const [refundReference, setRefundReference] = useState('');
  const [restockingFee,   setRestockingFee]   = useState('');
  const [rejectReason,    setRejectReason]    = useState('');
  const [showRejectForm,  setShowRejectForm]  = useState(false);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2800);
  };

  const loadDetail = useCallback(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/projects/${projectId}/returns/${returnId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (j) {
          setDetail(j);
          // Default refund amount = items × qty, BUT capped by what the
          // customer actually paid (order_total). Promo codes / discounts /
          // shipping fees mean items.sum can exceed order_total, which the
          // backend (correctly) refuses with 409. Cap upfront so the seed
          // value is always submittable.
          const itemsTotal = (j.items || []).reduce(
            (s, it) => s + (it.unit_price * it.quantity), 0
          );
          const cap = Number(j.order_total) || itemsTotal;
          const total = Math.min(itemsTotal, cap);
          setRefundAmount(total.toFixed(2));
          // Seed inspectItems map
          const seed = {};
          for (const it of (j.items || [])) {
            seed[it.id] = {
              condition: it.condition || 'pending',
              restock_warehouse_id: it.restock_warehouse_id,
              restock_batch_id: it.restock_batch_id,
              item_notes: it.item_notes || '',
            };
          }
          setInspectItems(seed);
        }
      })
      .finally(() => setLoading(false));
  }, [projectId, returnId]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  // Load warehouses + batches once the modal mounts (used in inspect step)
  useEffect(() => {
    fetch(`${API_BASE}/api/warehouses?project_id=${projectId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setWarehouses(Array.isArray(d) ? d : (d?.items || [])))
      .catch(() => {});
    fetch(`${API_BASE}/api/projects/${projectId}/batches?limit=500`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setBatches(Array.isArray(d) ? d : (d?.items || [])))
      .catch(() => {});
  }, [projectId]);

  const batchesBySku = useMemo(() => {
    const m = {};
    for (const b of (batches || [])) {
      if (!m[b.sku_id]) m[b.sku_id] = [];
      m[b.sku_id].push(b);
    }
    return m;
  }, [batches]);

  const refresh = () => { loadDetail(); onChanged?.(); };

  const callAction = async (path, body) => {
    setBusy(true);
    try {
      const r = await fetch(
        `${API_BASE}/api/projects/${projectId}/returns/${returnId}/${path}`,
        {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        }
      );
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        showToast(j?.detail || t('orders.returns.toast.actionFailed'));
        return false;
      }
      return true;
    } finally { setBusy(false); }
  };

  const onApprove = async () => {
    if (await callAction('approve')) { showToast(t('orders.returns.toast.approved')); refresh(); }
  };
  const onReceive = async () => {
    if (await callAction('receive')) { showToast(t('orders.returns.toast.markedReceived')); refresh(); }
  };
  const onInspect = async () => {
    const items = Object.entries(inspectItems).map(([id, v]) => ({
      return_item_id: parseInt(id, 10),
      condition: v.condition,
      restock_warehouse_id: v.restock_warehouse_id || null,
      restock_batch_id: v.restock_batch_id || null,
      item_notes: v.item_notes || '',
    }));
    if (items.some(it => it.condition === 'pending')) {
      showToast(t('orders.returns.toast.pickCondition'));
      return;
    }
    if (items.some(it => it.condition === 'resellable' && !it.restock_warehouse_id)) {
      showToast(t('orders.returns.toast.resellableNeedsWarehouse'));
      return;
    }
    if (await callAction('inspect', { items, internal_notes: inspectNotes })) {
      showToast(t('orders.returns.toast.inspectionSaved'));
      refresh();
    }
  };
  const onRefund = async () => {
    const amount = parseFloat(refundAmount);
    if (Number.isNaN(amount) || amount < 0) { showToast(t('orders.returns.toast.invalidRefund')); return; }
    // Pre-flight cap check — backend enforces this with a 409, but we'd
    // rather show the user a friendly toast than a raw "Refund cannot
    // exceed what was paid" from the API.
    const cap = Number(detail?.order_total);
    if (cap && amount > cap + 0.001) {
      showToast(t('orders.returns.toast.refundExceedsTotal', { max: formatMoney(cap, cur(detail)) }));
      return;
    }
    if (await callAction('refund', {
      refund_amount: amount,
      refund_method: refundMethod,
      refund_reference: refundReference,
      restocking_fee: parseFloat(restockingFee) || 0,
    })) {
      showToast(t('orders.returns.toast.refundRecorded'));
      refresh();
    }
  };
  const onReject = async () => {
    if (!rejectReason.trim()) { showToast(t('orders.returns.toast.reasonRequired')); return; }
    if (await callAction('reject', { reason: rejectReason.trim() })) {
      showToast(t('orders.returns.toast.returnRejected'));
      setShowRejectForm(false);
      refresh();
    }
  };

  // Auth-modal / cpm-modal layout — flat sections (no grey background
   // boxes around each field group) and 560px width, identical to the
   // New-promo-code modal so the visual language stays consistent.
  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal ret-modal"
        onClick={(e) => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">{t('orders.returns.modalTitle', { id: returnId })}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {detail ? fmtDateLong(detail.created_at) : ''}
                </span>
              </div>
            </div>
          </div>
          {detail && (
            <span className={`ret-badge ${STATUS_CLS[detail.status] || ''}`}
              style={{ marginRight: 8 }}>
              {statusLabel(t, detail.status)}
            </span>
          )}
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body">
          {loading && <div className="crm-placeholder">{t('orders.modal.loading')}</div>}
          {!loading && !detail && <div className="crm-placeholder">{t('orders.returns.loadFailed')}</div>}

          {!loading && detail && (
            <form className="cpm-form" onSubmit={(e) => e.preventDefault()}>
              <Stepper status={detail.status} />

              {/* ── 1. Customer + reason ── */}
              <div className="cpm-section">
                <label className="po-field-label">{t('orders.returns.customerAndReason')}</label>
                <div className="ret-block">
                  <div className="ret-flat-value">
                    {detail.customer_name || detail.recipient_name || t('orders.returns.anonymous')}
                  </div>
                  {detail.customer_email && (
                    <span className="cpm-section-hint" style={{ padding: 0 }}>
                      {detail.customer_email}
                    </span>
                  )}
                  <div className="ret-detail-reason">
                    <strong>{reasonLabel(t, detail.reason)}</strong>
                    {detail.customer_message && (
                      <p className="ret-detail-msg">"{detail.customer_message}"</p>
                    )}
                  </div>
                  {detail.customer_photos?.length > 0 && (
                    <div className="ret-detail-photos">
                      {/* `customer_photos` are URLs uploaded by the customer
                          on the storefront. Without `safeHttpUrl`, a
                          malicious customer could submit `javascript:...`
                          and the CRM admin clicking the thumbnail would
                          execute script in the admin's session. */}
                      {detail.customer_photos
                        .map((url, i) => ({ src: safeHttpUrl(url), i }))
                        .filter(({ src }) => !!src)
                        .map(({ src, i }) => (
                          <a key={i} href={src} target="_blank" rel="noopener noreferrer">
                            <img src={src} alt={`photo ${i + 1}`} />
                          </a>
                        ))}
                    </div>
                  )}
                </div>
              </div>

              {/* ── 2. Order context ── */}
              <div className="cpm-section">
                <label className="po-field-label">{t('orders.returns.orderSection')}</label>
                <div className="ret-block">
                  <div className="ret-flat-value">
                    {t('orders.returns.orderLine', {
                      id: detail.order_id,
                      total: formatMoney(detail.order_total, cur(detail)),
                      recipient: detail.recipient_name,
                    })}
                  </div>
                  <span className="cpm-section-hint" style={{ padding: 0 }}>
                    {t('orders.returns.placed', { date: fmtDate(detail.order_created_at) })}
                    {detail.delivered_at && t('orders.returns.deliveredSuffix', { date: fmtDate(detail.delivered_at) })}
                  </span>
                </div>
              </div>

              {/* ── 3. Items / inspect ── */}
              {detail.status === 'received' ? (
                <div className="cpm-section">
                  <label className="po-field-label">{t('orders.returns.inspectItems')}</label>
                  <div className="ret-block">
                    <div className="ret-inspect-list">
                      {detail.items.map(item => (
                        <InspectItem key={item.id} item={item}
                          value={inspectItems[item.id] || { condition: 'pending' }}
                          onChange={v => setInspectItems(prev => ({ ...prev, [item.id]: v }))}
                          warehouses={warehouses}
                          batchesBySku={batchesBySku} />
                      ))}
                    </div>
                    <textarea className="crm-input ret-inspect-notes"
                      style={{ marginTop: 12 }}
                      placeholder={t('orders.returns.internalNotes')}
                      value={inspectNotes}
                      onChange={e => setInspectNotes(e.target.value)} />
                  </div>
                </div>
              ) : (
                <div className="cpm-section">
                  <label className="po-field-label">{t('orders.returns.itemsSection')}</label>
                  <div className="ret-block">
                    <div className="ret-items-flat">
                      {detail.items.map(item => (
                        <div key={item.id} className="ret-item-row">
                          {item.image_url && (
                            <img src={item.image_url} alt={item.title} className="ret-item-img" />
                          )}
                          <div className="ret-item-info">
                            <span className="ret-item-name">{item.title}</span>
                            <span className="ret-item-meta">
                              {item.variation_name} · {item.configuration_name} · ×{item.quantity}
                              {item.condition && item.condition !== 'pending' && (
                                <> · <em>{item.condition}</em></>
                              )}
                              {item.restock_batch_name && (
                                <> · → {item.restock_batch_name}</>
                              )}
                            </span>
                          </div>
                          <span className="ret-item-price">{formatMoney(item.unit_price, cur(detail))}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── 4. Refund form when inspected ── */}
              {detail.status === 'inspected' && (
                <div className="cpm-section">
                  <label className="po-field-label">{t('orders.returns.recordRefund')}</label>
                  <div className="ret-block">
                    <div className="ret-detail-provider">
                      <Warning weight="duotone" />
                      <div>
                        <strong>{t('orders.returns.paymentProvider', { provider: providerLabel(t, detail.payment_provider) })}</strong>
                        <p>{t('orders.returns.providerHint')}</p>
                        {detail.payment_dashboard_url && (
                          <a href={detail.payment_dashboard_url} target="_blank" rel="noreferrer"
                             className="auth-btn-check" style={{ marginTop: 8, display: 'inline-block' }}>
                            {t('orders.returns.openDashboard')}
                          </a>
                        )}
                      </div>
                    </div>

                    <div className="ret-refund-grid">
                      <label className="ret-refund-field">
                        <span>{t('orders.returns.refundAmountMax', { max: formatMoney(detail.order_total, cur(detail)) })}</span>
                        <input className="crm-input" type="number" step="0.01"
                          min="0" max={detail.order_total}
                          value={refundAmount} onChange={e => setRefundAmount(e.target.value)} />
                      </label>
                      <label className="ret-refund-field">
                        <span>{t('orders.returns.restockingFee')}</span>
                        <input className="crm-input" type="number" step="0.01"
                          value={restockingFee} onChange={e => setRestockingFee(e.target.value)} />
                      </label>
                      <label className="ret-refund-field">
                        <span>{t('orders.returns.method')}</span>
                        <input className="crm-input" placeholder={t('orders.returns.methodPlaceholder')}
                          value={refundMethod} onChange={e => setRefundMethod(e.target.value)} />
                      </label>
                      <label className="ret-refund-field">
                        <span>{t('orders.returns.providerReference')}</span>
                        <input className="crm-input" placeholder={t('orders.returns.providerReferencePlaceholder')}
                          value={refundReference} onChange={e => setRefundReference(e.target.value)} />
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* ── 5. Already-refunded summary ── */}
              {detail.status === 'refunded' && (
                <div className="cpm-section">
                  <label className="po-field-label">{t('orders.returns.refundRecorded')}</label>
                  <div className="ret-block">
                    <div className="ret-flat-value">
                      {formatMoney(detail.refund_amount, cur(detail))}
                      {detail.refund_method && ` · ${detail.refund_method}`}
                    </div>
                    <span className="cpm-section-hint" style={{ padding: 0 }}>
                      {detail.refund_reference && t('orders.returns.refundRefPrefix', { ref: detail.refund_reference })}
                      {fmtDateLong(detail.refund_processed_at)}
                    </span>
                    {detail.restocking_fee > 0 && (
                      <span className="cpm-section-hint" style={{ padding: 0 }}>
                        {t('orders.returns.restockingFeeWithheld', { fee: formatMoney(detail.restocking_fee, cur(detail)) })}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* ── Rejected reason ── */}
              {detail.status === 'rejected' && detail.rejected_reason && (
                <div className="cpm-section">
                  <label className="po-field-label">{t('orders.returns.rejectionReason')}</label>
                  <div className="ret-block">
                    <div className="ret-flat-value">{detail.rejected_reason}</div>
                  </div>
                </div>
              )}

              {/* ── Action footer ── */}
              <div className="ret-modal-actions">
                {detail.status === 'requested' && (
                  <>
                    <button className="crm-submit-btn" disabled={busy} onClick={onApprove}
                      type="button">
                      {t('orders.returns.approveReturn')} <ArrowRight />
                    </button>
                    {!showRejectForm
                      ? <button className="auth-btn-danger" type="button"
                          onClick={() => setShowRejectForm(true)}>
                          {t('orders.returns.reject')}
                        </button>
                      : (
                        <div className="ret-reject-row">
                          <input className="crm-input" placeholder={t('orders.returns.rejectReasonPlaceholder')}
                            value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
                          <button className="auth-btn-danger" disabled={busy} onClick={onReject}
                            type="button">
                            {t('orders.returns.confirmReject')}
                          </button>
                          <button className="auth-btn-secondary" type="button"
                            onClick={() => setShowRejectForm(false)}>{t('common.cancel')}</button>
                        </div>
                      )}
                  </>
                )}

                {detail.status === 'approved' && (
                  <button className="crm-submit-btn" disabled={busy} onClick={onReceive}
                    type="button">
                    {t('orders.returns.markReceived')} <ArrowRight />
                  </button>
                )}

                {detail.status === 'received' && (
                  <button className="crm-submit-btn" disabled={busy} onClick={onInspect}
                    type="button">
                    {t('orders.returns.saveInspection')} <ArrowRight />
                  </button>
                )}

                {detail.status === 'inspected' && (
                  <button className="crm-submit-btn" disabled={busy} onClick={onRefund}
                    type="button">
                    {t('orders.returns.recordRefund')} <CheckCircle weight="fill" />
                  </button>
                )}
              </div>
            </form>
          )}

          {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Returns page (list view) ─────────────────────────────────

export default function Returns({ onActionCountChange }) {
  const { t } = useTranslation();
  const { projectId, project } = useOutletContext();
  // Project's "house" currency — used as fallback when an individual
  // return/order row doesn't have its own payment_currency snapshot
  // (e.g. legacy rows from before payment_currency was added).
  const currency = project?.currency || 'USD';
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [items,  setItems]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [openReturnId, setOpenReturnId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/projects/${projectId}/returns?limit=500`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        const arr = Array.isArray(j) ? j : (j?.items || []);
        setItems(arr);
        // Compute action count locally so parent badge stays in sync.
        const ac = arr.filter(r => groupOf(r.status) === 'action').length;
        onActionCountChange?.(ac);
      })
      .finally(() => setLoading(false));
  }, [projectId, onActionCountChange]);

  useEffect(() => { load(); }, [load]);

  // Deep-link: ?open=<return_id> auto-opens that return when present.
  useEffect(() => {
    const openId = params.get('open');
    if (openId) {
      const id = parseInt(openId, 10);
      if (!Number.isNaN(id)) setOpenReturnId(id);
    }
  }, [params]);

  const q = search.toLowerCase();
  const filtered = items.filter(r => {
    if (!q) return true;
    const hay = [
      r.customer_name, r.customer_email, r.recipient_name,
      String(r.id), String(r.order_id), reasonLabel(t, r.reason),
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });

  const grouped = useMemo(() => {
    const m = { action: [], progress: [], done: [], closed: [] };
    for (const r of filtered) m[groupOf(r.status)].push(r);
    return m;
  }, [filtered]);

  const isEmpty = !loading && filtered.length === 0;

  return (
    <>
      <h1 className="crm-page-title">{t('orders.returns.title')}</h1>

      <div className="org-toolbar">
        <div className="org-search-wrap">
          <MagnifyingGlass className="org-search-icon" />
          <input
            className="org-search-input"
            placeholder={t('orders.returns.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading && <p className="crm-placeholder">{t('orders.returns.loading')}</p>}

      {isEmpty && (
        <div className="ord-empty">
          <ArrowUUpLeft className="ord-empty-icon" weight="duotone" />
          <p>{search ? t('orders.returns.emptySearch') : t('orders.returns.empty')}</p>
        </div>
      )}

      {!loading && !isEmpty && (
        <div className="ret-groups">
          {GROUPS.map(g => (
            <GroupSection key={g.key} group={g}
              items={grouped[g.key]}
              currency={currency}
              onOpen={(r) => {
                setOpenReturnId(r.id);
                const next = new URLSearchParams(params);
                next.set('tab', 'returns');
                next.set('open', String(r.id));
                setParams(next, { replace: true });
              }} />
          ))}
        </div>
      )}

      {openReturnId && (
        <ReturnDetailModal
          returnId={openReturnId}
          projectId={projectId}
          currency={currency}
          onClose={() => {
            setOpenReturnId(null);
            const next = new URLSearchParams(params);
            next.delete('open');
            setParams(next, { replace: true });
          }}
          onChanged={load}
        />
      )}
    </>
  );
}
