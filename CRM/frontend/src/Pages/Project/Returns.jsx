// Returns / Refunds workflow — customer-initiated within 14 days.
// 5-stage lifecycle: requested → approved → received → inspected → refunded
// Terminal: rejected | cancelled
// List groups returns by what merchant must do now: Action / In progress / Completed / Closed.
// Detail modal walks through the 5-stage stepper.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import {
  CaretDown, MagnifyingGlass, ArrowUUpLeft, Package, Bell, ClockCounterClockwise,
  CheckCircle, XCircle, ArrowRight, Warning,
} from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { InteractiveSection } from '../../Utils/InteractiveSection.js';
import Modal from '../../Elements/Modal.jsx';
import '../../Style/Returns.css';

// ── Constants ──────────────────────────────────────────────────

const STATUS_META = {
  requested:  { label: 'Requested',  cls: 'ret-badge--requested'  },
  approved:   { label: 'Approved',   cls: 'ret-badge--approved'   },
  received:   { label: 'Received',   cls: 'ret-badge--received'   },
  inspected:  { label: 'Inspected',  cls: 'ret-badge--inspected'  },
  refunded:   { label: 'Refunded',   cls: 'ret-badge--refunded'   },
  rejected:   { label: 'Rejected',   cls: 'ret-badge--rejected'   },
  cancelled:  { label: 'Cancelled',  cls: 'ret-badge--cancelled'  },
};

const REASON_LABEL = {
  damaged:           'Damaged',
  wrong_item:        'Wrong item',
  not_as_described:  'Not as described',
  changed_mind:      'Changed mind',
  arrived_late:      'Arrived late',
  quality_issue:     'Quality issue',
  other:             'Other',
};

const STEPS = [
  { key: 'requested',  label: 'Requested',  desc: 'Customer submitted return request' },
  { key: 'approved',   label: 'Approved',   desc: 'Awaiting customer to ship items back' },
  { key: 'received',   label: 'Received',   desc: 'Items physically arrived at warehouse' },
  { key: 'inspected',  label: 'Inspected',  desc: 'Per-item condition + restock decisions made' },
  { key: 'refunded',   label: 'Refunded',   desc: 'Money refund recorded in payment provider' },
];

const PROVIDER_LABEL = {
  stripe:        'Stripe',
  tinkoff:       'Tinkoff',
  cloudpayments: 'CloudPayments',
  yookassa:      'YooKassa',
  paypal:        'PayPal',
  manual:        'Manual',
  other:         'Other',
};

const GROUPS = [
  { key: 'action',   label: 'Action needed', sub: 'Awaiting your decision',  Icon: Bell, statuses: ['requested', 'received'] },
  { key: 'progress', label: 'In progress',   sub: 'Waiting on customer or refund', Icon: ClockCounterClockwise, statuses: ['approved', 'inspected'] },
  { key: 'done',     label: 'Completed',     sub: 'Refunded',                Icon: CheckCircle, statuses: ['refunded'] },
  { key: 'closed',   label: 'Closed',        sub: 'No refund',               Icon: XCircle, statuses: ['rejected', 'cancelled'] },
];

const CARD_TILT = {
  maxAngleX: 10, maxAngleY: 4, lerp: 0.05, lerpOut: 0.07,
  scale: 1.018, perspective: 900,
  gloss: { opacity: 0.12, spread: 50 },
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

// ── Return card ───────────────────────────────────────────────

function ReturnCard({ ret, onOpen }) {
  const { ref, glossRef, handlers } = InteractiveSection(CARD_TILT, false);
  const m = STATUS_META[ret.status] ?? { label: ret.status, cls: '' };

  return (
    <div ref={ref} className="ret-card" onClick={() => onOpen(ret)} {...handlers}>
      <div ref={glossRef} className="ret-card-gloss" />

      <div className="ret-card-head">
        <span className="ret-card-id">#{ret.id}</span>
        <span className={`ret-badge ${m.cls}`}>{m.label}</span>
      </div>

      <div className="ret-card-cust">
        <span className="ret-card-name">{ret.customer_name || ret.recipient_name || 'Anonymous'}</span>
        {ret.customer_email && (
          <span className="ret-card-email">{ret.customer_email}</span>
        )}
      </div>

      <div className="ret-card-meta">
        <span>Order #{ret.order_id} · ${fmt(ret.order_total)}</span>
        <span className="ret-card-dot">·</span>
        <span>{ret.units_count} unit{ret.units_count !== 1 ? 's' : ''}</span>
      </div>

      <div className="ret-card-foot">
        <span className="ret-card-reason">{REASON_LABEL[ret.reason] || ret.reason}</span>
        <span className="ret-card-date">{fmtDate(ret.created_at)}</span>
      </div>
    </div>
  );
}

// ── Group section ─────────────────────────────────────────────

function GroupSection({ group, items, defaultOpen, onOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const { Icon } = group;

  return (
    <section className="ret-group">
      <button className="ret-group-head" type="button" onClick={() => setOpen(o => !o)}>
        <Icon className="ret-group-icon" weight="duotone" />
        <div className="ret-group-title-wrap">
          <span className="ret-group-title">{group.label}</span>
          <span className="ret-group-sub">{group.sub}</span>
        </div>
        <span className="ret-group-count">{items.length}</span>
        <CaretDown className={`ret-group-caret${open ? ' ret-group-caret--open' : ''}`} />
      </button>

      {open && items.length > 0 && (
        <div className="ret-group-cards">
          {items.map(ret => (
            <ReturnCard key={ret.id} ret={ret} onOpen={onOpen} />
          ))}
        </div>
      )}

      {open && items.length === 0 && (
        <p className="ret-group-empty">Nothing here.</p>
      )}
    </section>
  );
}

// ── Stepper ───────────────────────────────────────────────────

function Stepper({ status }) {
  const isTerminalReject = (status === 'rejected' || status === 'cancelled');
  // For a rejected return, the active step is whatever it was before — we'll just mark all done up to current.
  // Active = the next step waiting on action.
  let activeIdx;
  if (isTerminalReject) {
    activeIdx = -1;
  } else {
    const idx = STEPS.findIndex(s => s.key === status);
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
          <div key={s.key} className={cls}>
            <div className="ret-step-dot">{done ? '✓' : i + 1}</div>
            <div className="ret-step-info">
              <span className="ret-step-label">{s.label}</span>
              <span className="ret-step-desc">{s.desc}</span>
            </div>
            {i < STEPS.length - 1 && <div className="ret-step-bar" />}
          </div>
        );
      })}
    </div>
  );
}

// ── Inspect item editor ───────────────────────────────────────

function InspectItem({ item, value, onChange, warehouses, batchesBySku }) {
  const skuBatches = batchesBySku[item.configuration_id] || [];
  const filtered = value.restock_warehouse_id
    ? skuBatches.filter(b => b.warehouse_id === value.restock_warehouse_id)
    : skuBatches;

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
          <span className="ret-inspect-label">Condition</span>
          <select className="crm-input crm-input--sm" value={value.condition}
            onChange={e => onChange({ ...value, condition: e.target.value,
              ...(e.target.value !== 'resellable' ? { restock_warehouse_id: null, restock_batch_id: null } : {})
            })}>
            <option value="pending">— pick one —</option>
            <option value="resellable">Resellable (return to stock)</option>
            <option value="damaged">Damaged (don't restock)</option>
            <option value="unrecoverable">Unrecoverable (write off)</option>
          </select>
        </div>

        {value.condition === 'resellable' && (
          <>
            <div className="ret-inspect-row">
              <span className="ret-inspect-label">Warehouse</span>
              <select className="crm-input crm-input--sm" value={value.restock_warehouse_id || ''}
                onChange={e => onChange({ ...value,
                  restock_warehouse_id: e.target.value ? parseInt(e.target.value, 10) : null,
                  restock_batch_id: null,
                })}>
                <option value="">— select warehouse —</option>
                {warehouses.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
            <div className="ret-inspect-row">
              <span className="ret-inspect-label">Batch</span>
              <select className="crm-input crm-input--sm" value={value.restock_batch_id || ''}
                onChange={e => onChange({ ...value,
                  restock_batch_id: e.target.value ? parseInt(e.target.value, 10) : null,
                })}
                disabled={!value.restock_warehouse_id}>
                <option value="">Auto-create "Returns" batch</option>
                {filtered.map(b => (
                  <option key={b.id} value={b.id}>{b.batch_name} ({b.quantity_remaining} left)</option>
                ))}
              </select>
            </div>
          </>
        )}

        <textarea className="crm-input ret-inspect-notes"
          placeholder="Item notes (optional)…"
          value={value.item_notes || ''}
          onChange={e => onChange({ ...value, item_notes: e.target.value })} />
      </div>
    </div>
  );
}

// ── Detail modal ──────────────────────────────────────────────

function ReturnDetailModal({ returnId, projectId, onClose, onChanged }) {
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
          // Default refund amount = sum of item prices * quantity
          const total = (j.items || []).reduce(
            (s, it) => s + (it.unit_price * it.quantity), 0
          );
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
        showToast(j?.detail || 'Action failed');
        return false;
      }
      return true;
    } finally { setBusy(false); }
  };

  const onApprove = async () => {
    if (await callAction('approve')) { showToast('Approved'); refresh(); }
  };
  const onReceive = async () => {
    if (await callAction('receive')) { showToast('Marked as received'); refresh(); }
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
      showToast('Pick a condition for every item');
      return;
    }
    if (items.some(it => it.condition === 'resellable' && !it.restock_warehouse_id)) {
      showToast('Resellable items need a warehouse');
      return;
    }
    if (await callAction('inspect', { items, internal_notes: inspectNotes })) {
      showToast('Inspection saved');
      refresh();
    }
  };
  const onRefund = async () => {
    const amount = parseFloat(refundAmount);
    if (Number.isNaN(amount) || amount < 0) { showToast('Invalid refund amount'); return; }
    if (await callAction('refund', {
      refund_amount: amount,
      refund_method: refundMethod,
      refund_reference: refundReference,
      restocking_fee: parseFloat(restockingFee) || 0,
    })) {
      showToast('Refund recorded');
      refresh();
    }
  };
  const onReject = async () => {
    if (!rejectReason.trim()) { showToast('Reason is required'); return; }
    if (await callAction('reject', { reason: rejectReason.trim() })) {
      showToast('Return rejected');
      setShowRejectForm(false);
      refresh();
    }
  };

  return (
    <Modal onClose={onClose} title={`Return #${returnId}`}
      subtitle={detail ? fmtDateLong(detail.created_at) : ''}
      extra={detail ? (
        <span className={`ret-badge ${STATUS_META[detail.status]?.cls || ''}`}>
          {STATUS_META[detail.status]?.label || detail.status}
        </span>
      ) : null}>
      {loading && <div className="modal-loading">Loading…</div>}
      {!loading && !detail && <div className="modal-loading">Failed to load.</div>}

      {!loading && detail && (
        <>
          <Stepper status={detail.status} />

          {/* ── 1. Customer + reason ── */}
          <div className="modal-section">
            <div className="modal-section-label">Customer & reason</div>
            <div className="modal-section-value">
              {detail.customer_name || detail.recipient_name || 'Anonymous'}
            </div>
            {detail.customer_email && (
              <div className="modal-section-sub">{detail.customer_email}</div>
            )}
            <div className="ret-detail-reason">
              <strong>{REASON_LABEL[detail.reason] || detail.reason}</strong>
              {detail.customer_message && (
                <p className="ret-detail-msg">"{detail.customer_message}"</p>
              )}
            </div>
            {detail.customer_photos?.length > 0 && (
              <div className="ret-detail-photos">
                {detail.customer_photos.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer">
                    <img src={url} alt={`photo ${i + 1}`} />
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* ── 2. Order context ── */}
          <div className="modal-section">
            <div className="modal-section-label">Order</div>
            <div className="modal-section-value">
              Order #{detail.order_id} · ${fmt(detail.order_total)} ·{' '}
              {detail.recipient_name}
            </div>
            <div className="modal-section-sub">
              Placed {fmtDate(detail.order_created_at)}
              {detail.delivered_at && ` · Delivered ${fmtDate(detail.delivered_at)}`}
            </div>
          </div>

          {/* ── 3. Items ── */}
          {detail.status === 'received' ? (
            <div className="modal-section">
              <div className="modal-section-label">Inspect items</div>
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
                placeholder="Internal notes (optional)…"
                value={inspectNotes}
                onChange={e => setInspectNotes(e.target.value)} />
            </div>
          ) : (
            <div className="modal-section">
              <div className="modal-section-label">Items</div>
              <div className="ord-modal-items">
                {detail.items.map(item => (
                  <div key={item.id} className="ord-modal-item">
                    {item.image_url && (
                      <img src={item.image_url} alt={item.title} className="ord-modal-img" />
                    )}
                    <div className="ord-modal-item-info">
                      <span className="ord-modal-item-name">{item.title}</span>
                      <span className="ord-modal-item-meta">
                        {item.variation_name} · {item.configuration_name} · ×{item.quantity}
                        {item.condition && item.condition !== 'pending' && (
                          <> · <em>{item.condition}</em></>
                        )}
                        {item.restock_batch_name && (
                          <> · → {item.restock_batch_name}</>
                        )}
                      </span>
                    </div>
                    <span className="ord-modal-item-price">${fmt(item.unit_price)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 4. Refund form when inspected ── */}
          {detail.status === 'inspected' && (
            <div className="modal-section">
              <div className="modal-section-label">Record refund</div>
              <div className="ret-detail-provider">
                <Warning weight="duotone" />
                <div>
                  <strong>Payment provider: {PROVIDER_LABEL[detail.payment_provider] || detail.payment_provider}</strong>
                  <p>Process the refund in your provider's dashboard, then record it here.</p>
                  {detail.payment_dashboard_url && (
                    <a href={detail.payment_dashboard_url} target="_blank" rel="noreferrer"
                       className="auth-btn-check" style={{ marginTop: 8, display: 'inline-block' }}>
                      Open dashboard
                    </a>
                  )}
                </div>
              </div>

              <div className="ret-refund-grid">
                <label className="ret-refund-field">
                  <span>Refund amount</span>
                  <input className="crm-input" type="number" step="0.01"
                    value={refundAmount} onChange={e => setRefundAmount(e.target.value)} />
                </label>
                <label className="ret-refund-field">
                  <span>Restocking fee</span>
                  <input className="crm-input" type="number" step="0.01"
                    value={restockingFee} onChange={e => setRestockingFee(e.target.value)} />
                </label>
                <label className="ret-refund-field">
                  <span>Method</span>
                  <input className="crm-input" placeholder="card / transfer / cash"
                    value={refundMethod} onChange={e => setRefundMethod(e.target.value)} />
                </label>
                <label className="ret-refund-field">
                  <span>Provider reference</span>
                  <input className="crm-input" placeholder="re_3N… / charge id"
                    value={refundReference} onChange={e => setRefundReference(e.target.value)} />
                </label>
              </div>
            </div>
          )}

          {/* ── 5. Already-refunded summary ── */}
          {detail.status === 'refunded' && (
            <div className="modal-section">
              <div className="modal-section-label">Refund recorded</div>
              <div className="modal-section-value">
                ${fmt(detail.refund_amount)}
                {detail.refund_method && ` · ${detail.refund_method}`}
              </div>
              <div className="modal-section-sub">
                {detail.refund_reference && `Ref: ${detail.refund_reference} · `}
                {fmtDateLong(detail.refund_processed_at)}
              </div>
              {detail.restocking_fee > 0 && (
                <div className="modal-section-sub">
                  Restocking fee withheld: ${fmt(detail.restocking_fee)}
                </div>
              )}
            </div>
          )}

          {/* ── Rejected reason ── */}
          {detail.status === 'rejected' && detail.rejected_reason && (
            <div className="modal-section">
              <div className="modal-section-label">Rejection reason</div>
              <div className="modal-section-value">{detail.rejected_reason}</div>
            </div>
          )}

          {/* ── Action footer ── */}
          <div className="ret-modal-actions">
            {detail.status === 'requested' && (
              <>
                <button className="crm-submit-btn" disabled={busy} onClick={onApprove}>
                  Approve return <ArrowRight />
                </button>
                {!showRejectForm
                  ? <button className="auth-btn-danger" onClick={() => setShowRejectForm(true)}>
                      Reject
                    </button>
                  : (
                    <div className="ret-reject-row">
                      <input className="crm-input" placeholder="Reason for rejection…"
                        value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
                      <button className="auth-btn-danger" disabled={busy} onClick={onReject}>
                        Confirm reject
                      </button>
                      <button className="auth-btn-secondary"
                        onClick={() => setShowRejectForm(false)}>Cancel</button>
                    </div>
                  )}
              </>
            )}

            {detail.status === 'approved' && (
              <button className="crm-submit-btn" disabled={busy} onClick={onReceive}>
                Mark as received <ArrowRight />
              </button>
            )}

            {detail.status === 'received' && (
              <button className="crm-submit-btn" disabled={busy} onClick={onInspect}>
                Save inspection <ArrowRight />
              </button>
            )}

            {detail.status === 'inspected' && (
              <button className="crm-submit-btn" disabled={busy} onClick={onRefund}>
                Record refund <CheckCircle weight="fill" />
              </button>
            )}
          </div>
        </>
      )}

      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
    </Modal>
  );
}

// ── Returns page (list view) ─────────────────────────────────

export default function Returns({ onActionCountChange }) {
  const { projectId } = useOutletContext();
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
      String(r.id), String(r.order_id), REASON_LABEL[r.reason],
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
      <h1 className="crm-page-title">Returns</h1>

      <div className="org-toolbar">
        <div className="org-search-wrap">
          <MagnifyingGlass className="org-search-icon" />
          <input
            className="org-search-input"
            placeholder="Search by customer, order, or reason…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading && <p className="crm-placeholder">Loading returns…</p>}

      {isEmpty && (
        <div className="ord-empty">
          <ArrowUUpLeft className="ord-empty-icon" weight="duotone" />
          <p>{search ? 'No returns match your search' : 'No returns yet — customers can request a return from their order history.'}</p>
        </div>
      )}

      {!loading && !isEmpty && (
        <div className="ret-groups">
          {GROUPS.map(g => (
            <GroupSection key={g.key} group={g}
              items={grouped[g.key]}
              defaultOpen={g.key === 'action' || g.key === 'progress'}
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
