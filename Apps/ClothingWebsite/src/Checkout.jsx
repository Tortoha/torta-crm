import { useState, useEffect } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { Truck, EnvelopeSimple, CreditCard, Money, ChatCircle } from "@phosphor-icons/react";
import Header from "./Header";
import { client } from "./api.js";
import "./Style/Checkout.css";
import "./Style/Load.css";

const fmt = (n) => (+n % 1 === 0) ? +n : (+n).toFixed(2);

function Checkout() {
  const navigate  = useNavigate();
  const location  = useLocation();

  const [loading,    setLoading]    = useState(true);
  const [cart,       setCart]       = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState("");

  // Pre-fill promo from Cart page navigation state
  const initPromo = location.state?.promoCode || "";

  const [form, setForm] = useState({
    recipient_name: "",
    phone:          "",
    delivery_method: "courier",
    address:        "",
    comment:        "",
    payment_method: "cash",
    promo_code:     initPromo,
  });

  const [promoApplied,  setPromoApplied]  = useState(null);
  const [promoError,    setPromoError]    = useState("");
  const [promoChecking, setPromoChecking] = useState(false);

  // ── Load user + cart ────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const user = await client.auth.getUser();
        if (!mounted) return;
        if (!user) { navigate("/login"); return; }

        // Pre-fill name from account
        if (user.name) setForm(f => ({ ...f, recipient_name: user.name }));

        const result = await client.cart.get();
        if (!mounted) return;
        if (result.status === 401) { navigate("/login"); return; }
        if (!result.ok || !result.data?.items?.length) { navigate("/cart"); return; }
        setCart(result.data);
      } catch (e) {
        console.error("Checkout load error:", e);
        navigate("/cart");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  // ── Apply promo ─────────────────────────────────────────────
  const handleApplyPromo = async () => {
    if (!form.promo_code.trim()) {
      setPromoApplied(null);
      setPromoError("");
      return;
    }
    setPromoChecking(true);
    const { ok, data } = await client.promos.apply(form.promo_code);
    if (ok) {
      setPromoApplied(data);
      setPromoError("");
    } else {
      setPromoApplied(null);
      setPromoError(data?.detail || "Invalid promo code");
    }
    setPromoChecking(false);
  };

  // ── Place order ─────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.recipient_name.trim()) {
      setError("Recipient name is required");
      return;
    }
    if (form.delivery_method === "courier" && !form.address.trim()) {
      setError("Delivery address is required for courier");
      return;
    }
    setError("");
    setSubmitting(true);

    const payload = {
      recipient_name:  form.recipient_name.trim(),
      delivery_method: form.delivery_method,
      payment_method:  form.payment_method,
    };
    if (form.phone.trim())   payload.phone       = form.phone.trim();
    if (form.address.trim()) payload.address     = form.address.trim();
    if (form.comment.trim()) payload.comment     = form.comment.trim();
    if (form.promo_code.trim()) payload.promo_code = form.promo_code.trim();

    const { ok, data } = await client.orders.place(payload);
    if (ok) {
      navigate("/order-success", { state: { orderId: data.order_id } });
    } else {
      setError(data?.detail || "Failed to place order. Please try again.");
      setSubmitting(false);
    }
  };

  // ── Loading ─────────────────────────────────────────────────
  if (loading) return (
    <div id="mask" className="mask">
      <svg><circle cx="50" cy="50" r="40" /></svg>
    </div>
  );

  const subtotal = promoApplied ? promoApplied.subtotal      : cart.subtotal;
  const shipping = promoApplied ? promoApplied.shipping_cost : cart.shipping_cost;
  const discount = promoApplied ? promoApplied.discount      : 0;
  const total    = promoApplied ? promoApplied.total         : cart.total;

  return (
    <>
      <Header />
      <div className="checkout-page">

        {/* ── Left: form ── */}
        <div className="checkout-left">
          <h1 className="checkout-title">Checkout</h1>

          <form className="checkout-form" onSubmit={handleSubmit}>

            {/* Contact */}
            <div className="checkout-section">
              <h2 className="checkout-section-title">Contact</h2>
              <div className="checkout-fields">
                <div className="checkout-field">
                  <label>Recipient Name <span className="req">*</span></label>
                  <input
                    type="text"
                    className="checkout-input"
                    value={form.recipient_name}
                    onChange={e => set("recipient_name", e.target.value)}
                    placeholder="Full name"
                  />
                </div>
                <div className="checkout-field">
                  <label>Phone <span className="optional">optional</span></label>
                  <input
                    type="tel"
                    className="checkout-input"
                    value={form.phone}
                    onChange={e => set("phone", e.target.value)}
                    placeholder="+1 (555) 000-0000"
                  />
                </div>
              </div>
            </div>

            {/* Delivery */}
            <div className="checkout-section">
              <h2 className="checkout-section-title">Delivery</h2>

              <div className="checkout-toggle">
                <button
                  type="button"
                  className={`checkout-toggle-btn${form.delivery_method === "courier" ? " checkout-toggle-btn--active" : ""}`}
                  onClick={() => set("delivery_method", "courier")}
                >
                  <Truck weight="bold" /> Courier
                </button>
                <button
                  type="button"
                  className={`checkout-toggle-btn${form.delivery_method === "postal" ? " checkout-toggle-btn--active" : ""}`}
                  onClick={() => set("delivery_method", "postal")}
                >
                  <EnvelopeSimple weight="bold" /> Postal
                </button>
              </div>

              {form.delivery_method === "courier" && (
                <div className="checkout-field checkout-field--mt">
                  <label>Delivery Address <span className="req">*</span></label>
                  <input
                    type="text"
                    className="checkout-input"
                    value={form.address}
                    onChange={e => set("address", e.target.value)}
                    placeholder="Street, City, ZIP"
                  />
                </div>
              )}
            </div>

            {/* Payment */}
            <div className="checkout-section">
              <h2 className="checkout-section-title">Payment</h2>

              <div className="checkout-toggle">
                <button
                  type="button"
                  className={`checkout-toggle-btn${form.payment_method === "card" ? " checkout-toggle-btn--active" : ""}`}
                  onClick={() => set("payment_method", "card")}
                >
                  <CreditCard weight="bold" /> Card
                </button>
                <button
                  type="button"
                  className={`checkout-toggle-btn${form.payment_method === "cash" ? " checkout-toggle-btn--active" : ""}`}
                  onClick={() => set("payment_method", "cash")}
                >
                  <Money weight="bold" /> Pay on Delivery
                </button>
              </div>

              {form.payment_method === "card" && (
                <p className="checkout-note">
                  Online card payment is coming soon. Your order will be confirmed and we'll reach out with payment details.
                </p>
              )}
            </div>

            {/* Additional */}
            <div className="checkout-section">
              <h2 className="checkout-section-title">Additional</h2>
              <div className="checkout-fields">
                <div className="checkout-field">
                  <label>Order Note <span className="optional">optional</span></label>
                  <textarea
                    className="checkout-input checkout-textarea"
                    value={form.comment}
                    onChange={e => set("comment", e.target.value)}
                    placeholder="Any special instructions…"
                    rows={3}
                  />
                </div>
                <div className="checkout-field">
                  <label>Promo Code <span className="optional">optional</span></label>
                  <div className="checkout-promo-row">
                    <input
                      type="text"
                      className={`checkout-input checkout-promo-input${promoError ? " checkout-input--error" : ""}`}
                      value={form.promo_code}
                      onChange={e => {
                        set("promo_code", e.target.value.toUpperCase());
                        setPromoApplied(null);
                        setPromoError("");
                      }}
                      placeholder="ENTER CODE"
                      onKeyDown={e => e.key === "Enter" && (e.preventDefault(), handleApplyPromo())}
                    />
                    <button
                      type="button"
                      className="checkout-promo-btn"
                      onClick={handleApplyPromo}
                      disabled={promoChecking}
                    >
                      {promoChecking ? "…" : "Apply"}
                    </button>
                  </div>
                  {promoError    && <p className="checkout-promo-error">{promoError}</p>}
                  {promoApplied  && <p className="checkout-promo-ok">−{promoApplied.discount_percent}% applied!</p>}
                </div>
              </div>
            </div>

            {/* Error */}
            {error && <p className="checkout-error">{error}</p>}

            {/* Actions */}
            <div className="checkout-actions">
              <Link to="/cart" className="checkout-back-btn">← Back to Cart</Link>
              <button type="submit" className="checkout-submit-btn" disabled={submitting}>
                {submitting ? "Placing order…" : "Place Order"}
              </button>
            </div>

          </form>
        </div>

        {/* ── Right: summary ── */}
        <div className="checkout-right">
          <div className="checkout-summary-card">
            <h2 className="checkout-summary-title">Order Summary</h2>

            <div className="checkout-items-list">
              {cart.items.map(item => (
                <div key={item.cart_item_id} className="checkout-item">
                  <img src={item.image_url} alt={item.title} className="checkout-item-img" />
                  <div className="checkout-item-info">
                    <span className="checkout-item-name">{item.title}</span>
                    <span className="checkout-item-meta">{item.variation_name} · {item.configuration_name}</span>
                    <span className="checkout-item-qty">×{item.quantity}</span>
                  </div>
                  <span className="checkout-item-price">${fmt(item.item_total ?? item.price)}</span>
                </div>
              ))}
            </div>

            <div className="checkout-totals">
              <div className="checkout-total-row">
                <span>Subtotal</span>
                <span>${fmt(subtotal)}</span>
              </div>
              <div className="checkout-total-row">
                <span>Shipping</span>
                <span>{shipping === 0 ? "Free" : `$${fmt(shipping)}`}</span>
              </div>
              {discount > 0 && (
                <div className="checkout-total-row checkout-total-row--discount">
                  <span>Discount</span>
                  <span>−${fmt(discount)}</span>
                </div>
              )}
              <div className="checkout-total-row checkout-total-row--total">
                <span>Total</span>
                <span>${fmt(total)}</span>
              </div>
            </div>

          </div>
        </div>

      </div>
    </>
  );
}

export default Checkout;
