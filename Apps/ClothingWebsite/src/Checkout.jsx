import { useState, useEffect } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { Truck, EnvelopeSimple, CreditCard, Money, ChatCircle, Storefront, MapPin } from "@phosphor-icons/react";
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
    // Fulfillment — "courier" (default; courier delivers to address) or
    // "pickup" (customer picks up from a specific warehouse → no shipping fee).
    fulfillment_type:    "courier",
    pickup_warehouse_id: null,
  });

  // Pickup locations loaded once on mount — if the merchant opted at least
  // one warehouse into pickup, the toggle becomes visible.
  const [pickupLocations, setPickupLocations] = useState([]);
  const [deliveryEta, setDeliveryEta] = useState(null);

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

        // Pull pickup locations + delivery ETA in parallel. Both endpoints
        // are public — work for both logged-in and guest checkouts.
        // Defensive: if the storefront's torta-js bundle is older than the
        // page (e.g. Vite cache mismatch right after an SDK upgrade), the
        // `shipping` namespace may be undefined. Crashing the whole page
        // for an optional "delivery ETA" hint would be silly — just skip.
        client.shipping?.pickupLocations?.()
          .then(r => mounted && r.ok && Array.isArray(r.data) && setPickupLocations(r.data))
          .catch(() => {});
        client.shipping?.deliveryEta?.()
          .then(r => mounted && r.ok && setDeliveryEta(r.data))
          .catch(() => {});
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
    const { ok, data, error } = await client.promos.apply(form.promo_code);
    if (ok) {
      setPromoApplied(data);
      setPromoError("");
    } else {
      setPromoApplied(null);
      setPromoError(error || "Invalid promo code");
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
    if (cart.requires_shipping && form.fulfillment_type === "courier" && !form.address.trim()) {
      setError("Delivery address is required for courier");
      return;
    }
    if (cart.requires_shipping && form.fulfillment_type === "pickup" && !form.pickup_warehouse_id) {
      setError("Please pick a store to collect your order from");
      return;
    }
    setError("");
    setSubmitting(true);

    const payload = {
      recipient_name:  form.recipient_name.trim(),
      delivery_method: cart.requires_shipping ? form.delivery_method : "digital",
      payment_method:  form.payment_method,
      fulfillment_type: cart.requires_shipping ? form.fulfillment_type : "courier",
    };
    if (form.fulfillment_type === "pickup" && form.pickup_warehouse_id) {
      payload.pickup_warehouse_id = form.pickup_warehouse_id;
    }
    if (form.phone.trim())   payload.phone       = form.phone.trim();
    if (form.address.trim()) payload.address     = form.address.trim();
    if (form.comment.trim()) payload.comment     = form.comment.trim();
    if (form.promo_code.trim()) payload.promo_code = form.promo_code.trim();

    const { ok, data, error } = await client.orders.place(payload);
    if (ok) {
      navigate("/order-success", { state: { orderId: data.order_id } });
    } else {
      setError(error || "Failed to place order. Please try again.");
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

            {/* Delivery — hidden for digital-only carts (no physical shipping).
                Layout: top-level toggle is fulfillment (Courier vs Pickup).
                Courier reveals address + carrier sub-toggle; Pickup reveals
                a location list with structured address + opening hours. */}
            {cart.requires_shipping ? (
              <div className="checkout-section">
                <h2 className="checkout-section-title">Delivery</h2>

                <div className="checkout-toggle">
                  <button
                    type="button"
                    className={`checkout-toggle-btn${form.fulfillment_type === "courier" ? " checkout-toggle-btn--active" : ""}`}
                    onClick={() => set("fulfillment_type", "courier")}
                  >
                    <Truck weight="bold" /> Courier
                  </button>
                  {pickupLocations.length > 0 && (
                    <button
                      type="button"
                      className={`checkout-toggle-btn${form.fulfillment_type === "pickup" ? " checkout-toggle-btn--active" : ""}`}
                      onClick={() => set("fulfillment_type", "pickup")}
                    >
                      <Storefront weight="bold" /> Pickup at store
                    </button>
                  )}
                </div>

                {form.fulfillment_type === "courier" && (
                  <>
                    {/* "Delivery in 2–4 days" ETA hint — pulled from any
                        warehouse the merchant configured an ETA on. */}
                    {deliveryEta?.min_days != null && deliveryEta?.max_days != null && (
                      <div className="checkout-eta-hint">
                        <Truck weight="bold" size={14} />
                        {deliveryEta.min_days === deliveryEta.max_days
                          ? `Delivery in ${deliveryEta.min_days} day${deliveryEta.min_days === 1 ? "" : "s"}`
                          : `Delivery in ${deliveryEta.min_days}–${deliveryEta.max_days} days`}
                      </div>
                    )}
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
                  </>
                )}

                {form.fulfillment_type === "pickup" && (
                  <div className="checkout-pickup-list">
                    {pickupLocations.map(loc => {
                      const selected = form.pickup_warehouse_id === loc.id;
                      const addrLine = [loc.street, loc.city, loc.region, loc.postal_code, loc.country]
                        .filter(Boolean).join(", ");
                      return (
                        <button key={loc.id} type="button"
                          className={`checkout-pickup-card${selected ? " checkout-pickup-card--selected" : ""}`}
                          onClick={() => set("pickup_warehouse_id", loc.id)}>
                          <MapPin weight={selected ? "fill" : "regular"} size={20}
                            className="checkout-pickup-icon" />
                          <div className="checkout-pickup-info">
                            <span className="checkout-pickup-name">{loc.name}</span>
                            {addrLine && <span className="checkout-pickup-addr">{addrLine}</span>}
                            {loc.pickup_hours && (
                              <span className="checkout-pickup-hours">{loc.pickup_hours}</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="checkout-section">
                <h2 className="checkout-section-title">Delivery</h2>
                <div className="checkout-digital-note">
                  <EnvelopeSimple weight="bold" /> Digital delivery — files and links arrive in your email after checkout.
                </div>
              </div>
            )}

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
