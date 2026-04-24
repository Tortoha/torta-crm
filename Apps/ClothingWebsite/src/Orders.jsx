import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Truck, EnvelopeSimple, CreditCard, Money, ChatCircle, CaretDown, CaretUp } from "@phosphor-icons/react";
import Header from "./Header";
import { client } from "./api.js";
import "./Style/Orders.css";
import "./Style/Load.css";

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

const fmt = (n) => (+n % 1 === 0) ? +n : (+n).toFixed(2);

const fmtDate = (ts) => ts
  ? new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
  : "";

// ── Orders page ────────────────────────────────────────────────

function Orders() {
  const navigate = useNavigate();
  const [orders,   setOrders]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [expanded, setExpanded] = useState(null);

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
        if (result.ok && Array.isArray(result.data)) setOrders(result.data);
      } catch (e) {
        console.error("Orders load error:", e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const toggle = (id) => setExpanded(prev => prev === id ? null : id);

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
                    <span className="os-order-total">${fmt(order.total_amount)}</span>
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
                              {item.variation_name} · {item.size_name}
                            </span>
                          </div>
                          <span className="os-item-qty">×{item.quantity}</span>
                          <span className="os-item-price">${fmt(item.price)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export default Orders;
