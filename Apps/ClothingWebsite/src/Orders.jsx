import { useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Truck, EnvelopeSimple, CreditCard, Money, ChatCircle, CaretDown, CaretUp,
         ArrowUUpLeft, XCircle } from "@phosphor-icons/react";
import Header from "./Header";
import ReturnRequestModal from "./ReturnRequestModal";
import { client } from "./api.js";
import { fmtMoney } from "./currency.js";
import "./Style/Orders.css";
import "./Style/Load.css";

const RETURN_WINDOW_DAYS = 14;
// Customer can cancel only while the order hasn't been delivered yet. After
// 'delivered' they must use the Return flow (14-day window). Cancelled and
// refunded are terminal.
const CANCELLABLE_STATUSES = new Set(["new", "confirmed", "shipped"]);

const RETURN_STATUS_LABEL = {
  requested: "Awaiting approval",
  approved:  "Approved · ship items back",
  rejected:  "Rejected",
  received:  "Goods received · being inspected",
  inspected: "Inspected · refund pending",
  refunded:  "Refunded",
  cancelled: "Cancelled",
};

function daysSince(ts) {
  if (!ts) return null;
  const d = (Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60 * 24);
  return Math.floor(d);
}

function isWithinReturnWindow(order) {
  if (order.status !== "delivered") return false;
  // delivered_at exists on order_history; fall back to created_at
  const anchor = order.delivered_at || order.created_at;
  const days = daysSince(anchor);
  return days != null && days <= RETURN_WINDOW_DAYS;
}

// ── Status metadata ────────────────────────────────────────────

const STATUS_META = {
  new:       { label: "New",       cls: "os-badge--new"       },
  confirmed: { label: "Confirmed", cls: "os-badge--confirmed"  },
  shipped:   { label: "Shipped",   cls: "os-badge--shipped"    },
  delivered: { label: "Delivered", cls: "os-badge--delivered"  },
  cancelled: { label: "Cancelled", cls: "os-badge--cancelled"  },
  refunded:  { label: "Refunded",  cls: "os-badge--refunded"   },
};

function StatusBadge({ status }) {
  const m = STATUS_META[status] ?? { label: status, cls: "" };
  return <span className={`os-badge ${m.cls}`}>{m.label}</span>;
}

// ── Helpers ────────────────────────────────────────────────────

// Shop-currency-aware money formatter — pulls symbol + position from
// the global set at App.jsx bootstrap. Drops decimals when whole.
const fmt = (n) => fmtMoney(n, (+n % 1 === 0) ? { decimals: 0 } : undefined);

const fmtDate = (ts) => ts
  ? new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
  : "";

// ── Orders page ────────────────────────────────────────────────

function Orders() {
  const navigate = useNavigate();
  const [orders,    setOrders]    = useState([]);
  const [returns,   setReturns]   = useState({});   // {order_id: [return,…]}
  const [loading,   setLoading]   = useState(true);
  const [expanded,  setExpanded]  = useState(null);
  const [returnFor, setReturnFor] = useState(null); // currently-open order in return modal

  const loadReturnsFor = useCallback(async (order_id) => {
    const res = await client.orders.listReturns(order_id);
    if (res.ok && Array.isArray(res.data)) {
      setReturns(prev => ({ ...prev, [order_id]: res.data }));
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const user = await client.auth.getUser();
        if (!mounted) return;
        if (!user) { navigate("/login"); return; }

        const result = await client.orders.list();
        if (!mounted) return;
        if (result.status === 401) { navigate("/login"); return; }
        if (result.ok && Array.isArray(result.data)) {
          setOrders(result.data);
          // Fan out fetching returns for delivered orders (in parallel)
          for (const o of result.data) {
            if (o.status === "delivered" || o.status === "refunded") {
              loadReturnsFor(o.id);
            }
          }
        }
      } catch (e) {
        console.error("Orders load error:", e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [loadReturnsFor]);

  const toggle = (id) => setExpanded(prev => prev === id ? null : id);

  const onReturnSubmitted = (order_id) => {
    loadReturnsFor(order_id);
  };

  // ── Cancel order (customer-initiated) ────────────────────────────
  // Allowed while status ∈ {new, confirmed, shipped}. Backend re-validates
  // and reverses stock side-effects (releases reservation if not yet
  // shipped, restocks if shipped). After delivered → use Return flow.
  const onCancelOrder = async (order) => {
    if (!CANCELLABLE_STATUSES.has(order.status)) return;
    if (!confirm(`Cancel order #${order.id}? This cannot be undone.`)) return;
    const res = await client.orders.cancel(order.id);
    if (!res.ok) {
      alert(res.error || "Couldn't cancel this order.");
      return;
    }
    // Reflect cancelled status locally without a full reload.
    setOrders(prev => prev.map(o =>
      o.id === order.id ? { ...o, status: "cancelled" } : o
    ));
  };

  // ── Loading ──────────────────────────────────────────────────
  if (loading) return (
    <div id="mask" className="mask">
      <svg><circle cx="50" cy="50" r="40" /></svg>
    </div>
  );

  return (
    <>
      <Header />
      <div className="os-page">
        <h1 className="os-title">My Orders</h1>

        {orders.length === 0 ? (
          <div className="os-empty">
            <p>You haven't placed any orders yet.</p>
            <Link to="/" className="os-empty-btn">Start Shopping</Link>
          </div>
        ) : (
          <div className="os-list">
            {orders.map(order => (
              <div key={order.id} className="os-order">

                {/* ── Header row ── */}
                <div className="os-order-header" onClick={() => toggle(order.id)}>
                  <div className="os-order-left">
                    <span className="os-order-num">Order #{order.id}</span>
                    <span className="os-order-date">{fmtDate(order.created_at)}</span>
                  </div>
                  <div className="os-order-right">
                    <StatusBadge status={order.status} />
                    <span className="os-order-total">{fmt(order.total_amount)}</span>
                    {expanded === order.id
                      ? <CaretUp className="os-chevron" weight="bold" />
                      : <CaretDown className="os-chevron" weight="bold" />}
                  </div>
                </div>

                {/* ── Expanded detail ── */}
                {expanded === order.id && (
                  <div className="os-order-body">
                    <div className="os-order-info">
                      <span className="os-info-row">
                        {order.delivery_method === "courier"
                          ? <><Truck weight="bold" /> Courier{order.address ? ` — ${order.address}` : ""}</>
                          : <><EnvelopeSimple weight="bold" /> Postal</>}
                      </span>
                      <span className="os-info-row">
                        {order.payment_method === "card"
                          ? <><CreditCard weight="bold" /> Card</>
                          : <><Money weight="bold" /> Pay on Delivery</>}
                      </span>
                      {order.comment && (
                        <span className="os-info-row"><ChatCircle weight="bold" /> {order.comment}</span>
                      )}
                    </div>

                    <div className="os-items">
                      {order.items.map((item, i) => (
                        <div key={i} className="os-item">
                          <img
                            src={item.image_url}
                            alt={item.title}
                            className="os-item-img"
                          />
                          <div className="os-item-info">
                            <span className="os-item-name">{item.title}</span>
                            <span className="os-item-meta">
                              {item.variation_name} · {item.configuration_name}
                            </span>
                            {/* Modifier snapshot — names visible even if items
                                are later renamed/deleted in CRM (resolved
                                server-side via JOIN at read time). */}
                            {Array.isArray(item.modifiers) && item.modifiers.length > 0 && (
                              <span className="os-item-mods">
                                {item.modifiers.map(m =>
                                  m.group_name ? `${m.group_name}: ${m.name}` : m.name
                                ).join(' · ')}
                              </span>
                            )}
                          </div>
                          <span className="os-item-qty">×{item.quantity}</span>
                          <span className="os-item-price">{fmt(item.price)}</span>
                        </div>
                      ))}
                    </div>

                    {/* ── Existing return requests ── */}
                    {(returns[order.id] || []).length > 0 && (
                      <div className="os-returns">
                        <h4 className="os-returns-title">Returns</h4>
                        {(returns[order.id] || []).map(r => (
                          <div key={r.id} className="os-return">
                            <span className="os-return-id">Return #{r.id}</span>
                            <span className={`os-return-status os-return-status--${r.status}`}>
                              {RETURN_STATUS_LABEL[r.status] || r.status}
                            </span>
                            {r.status === "refunded" && r.refund_amount > 0 && (
                              <span className="os-return-refund">
                                Refunded {fmt(r.refund_amount)}
                              </span>
                            )}
                            {r.status === "rejected" && r.rejected_reason && (
                              <span className="os-return-reason">{r.rejected_reason}</span>
                            )}
                            {/* Cancel button — only while still 'requested'. After
                                merchant has acted, customer must contact the store. */}
                            {r.status === "requested" && (
                              <button className="os-return-cancel"
                                type="button"
                                onClick={async () => {
                                  if (!confirm("Cancel this return request?")) return;
                                  const res = await client.orders.cancelReturn(order.id, r.id);
                                  if (res.ok) loadReturnsFor(order.id);
                                }}>
                                Cancel
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* ── Action buttons row — cancel (pre-delivery) or return (post-delivery) ── */}
                    {(CANCELLABLE_STATUSES.has(order.status) || isWithinReturnWindow(order)) && (
                      <div className="os-actions">
                        {CANCELLABLE_STATUSES.has(order.status) && (
                          <button className="os-action-btn os-action-btn--cancel"
                            onClick={() => onCancelOrder(order)}
                            type="button">
                            <XCircle weight="bold" /> Cancel order
                          </button>
                        )}
                        {isWithinReturnWindow(order) && (
                          <button className="os-action-btn os-action-btn--return"
                            onClick={() => setReturnFor(order)}
                            type="button">
                            <ArrowUUpLeft weight="bold" /> Request a return
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

              </div>
            ))}
          </div>
        )}
      </div>

      {/* Return-request modal */}
      {returnFor && (
        <ReturnRequestModal
          order={returnFor}
          existingReturns={returns[returnFor.id] || []}
          onClose={() => setReturnFor(null)}
          onSubmitted={() => onReturnSubmitted(returnFor.id)}
        />
      )}
    </>
  );
}

export default Orders;
