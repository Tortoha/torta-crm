import { useState, useEffect } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { Truck, EnvelopeSimple, CreditCard, Money, ChatCircle, Storefront, MapPin } from "@phosphor-icons/react";
import Header from "./Header";
import { client } from "./api.js";
import { fmtMoney } from "./currency.js";
import CountryCombobox from "./CountryCombobox.jsx";
import StripePaymentModal from "./StripePaymentModal.jsx";
import KaspiPaymentModal from "./KaspiPaymentModal.jsx";
import "./Style/Checkout.css";
import "./Style/Load.css";

// Drop decimals when amount is whole — "$30" reads better than "$30.00"
// on checkout. fmtMoney handles the currency symbol and position.
const fmt = (n) => fmtMoney(n, (+n % 1 === 0) ? { decimals: 0 } : undefined);

// Loads Halyk's payment-api.js (once) then calls halyk.pay(cfg), which redirects
// the buyer to Halyk's hosted page. They return to /checkout/return, which places
// the order (place_order re-verifies via check-status). The card is entered on
// Halyk's side — it never touches us (PCI-light).
function payHalyk(cfg) {
  return new Promise((resolve, reject) => {
    const launch = () => {
      try {
        window.halyk.pay({
          invoiceId:       cfg.invoiceId,
          backLink:        cfg.backLink,
          failureBackLink: cfg.failureBackLink,
          postLink:        cfg.postLink,
          failurePostLink: cfg.postLink,
          language:        cfg.language || "rus",
          description:     cfg.description,
          accountId:       cfg.invoiceId,
          terminal:        cfg.terminal,
          amount:          cfg.amount,
          currency:        cfg.currency || "KZT",
          auth:            cfg.auth,
        });
        resolve();
      } catch (e) { reject(e); }
    };
    if (window.halyk?.pay) return launch();
    const existing = document.querySelector(`script[src="${cfg.paymentApiJs}"]`);
    if (existing) { existing.addEventListener("load", launch); return; }
    const s = document.createElement("script");
    s.src = cfg.paymentApiJs;
    s.onload = launch;
    s.onerror = () => reject(new Error("Failed to load Halyk payment library"));
    document.head.appendChild(s);
  });
}

// Loads TipTop Pay's widget (once, ex-CloudPayments) then opens the popup via
// widget.start(). The card is entered in TipTop Pay's own popup (PCI-light — never
// touches us); unlike Halyk there is NO redirect — `oncomplete` fires on the same
// page. We resolve with the gateway TransactionId, then place the order, which
// re-verifies that transaction server-side via /payments/get (Status=Completed +
// amount) before marking it paid (a forged success can't fake a paid order).
function payTipTopPay(cfg) {
  return new Promise((resolve, reject) => {
    const launch = () => {
      try {
        const widget = new window.tiptop.Widget();
        widget.oncomplete = (result) => {
          // result = { type: 'payment'|'cancel'|'error', status: 'success'|'fail'|…,
          //            data: { transactionId }, message }
          if (result && result.type === "payment" && result.status === "success") {
            resolve(String(result?.data?.transactionId || ""));
          } else {
            reject(new Error(result?.message || "Payment was declined"));
          }
        };
        // start() returns a thenable in the docs; wrap defensively so a launch
        // error rejects even if a build returns undefined. The paid decision is
        // driven by oncomplete above, never by this resolve.
        Promise.resolve(
          widget.start({
            publicTerminalId: cfg.public_terminal_id,
            amount:           cfg.amount,
            currency:         cfg.currency || "KZT",
            paymentSchema:    cfg.payment_schema || "Single",
            description:      cfg.description,
            externalId:       cfg.external_id,
            // account_id is the email when given, else our numeric externalId — only
            // forward it as receiptEmail when it's actually an email.
            receiptEmail:     (cfg.account_id && cfg.account_id.includes("@")) ? cfg.account_id : undefined,
          })
        ).catch((e) => reject(e instanceof Error ? e : new Error(String(e || "Payment failed"))));
      } catch (e) { reject(e); }
    };
    if (window.tiptop?.Widget) return launch();
    const existing = document.querySelector(`script[src="${cfg.widget_js}"]`);
    if (existing) { existing.addEventListener("load", launch); return; }
    const s = document.createElement("script");
    s.src = cfg.widget_js;
    s.onload = launch;
    s.onerror = () => reject(new Error("Failed to load TipTop Pay widget"));
    document.head.appendChild(s);
  });
}

function Checkout() {
  const navigate  = useNavigate();
  const location  = useLocation();

  const [loading,    setLoading]    = useState(true);
  const [cart,       setCart]       = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState("");
  // Storefront payment config (GET /config → online_payment / test mode).
  const [storeConfig, setStoreConfig] = useState(null);
  // When the merchant requires online payment, holds the Stripe card step:
  // { publishableKey, clientSecret, amountLabel, testMode, payload }.
  const [stripeStep, setStripeStep] = useState(null);
  const [kaspiStep, setKaspiStep] = useState(null);

  // Pre-fill promo from Cart page navigation state
  const initPromo = location.state?.promoCode || "";

  const [form, setForm] = useState({
    // Structured recipient name — first + last required at checkout,
    // middle (patronymic) optional. Backend composes the legacy
    // recipient_name as "{last} {first} {middle}" for back-compat
    // with invoices that print the single-string version.
    recipient_first_name:  "",
    recipient_last_name:   "",
    recipient_middle_name: "",
    // Contact info for guest checkout — at least one is required
    // (which one depends on /auth/methods returned by the merchant).
    customer_email: "",
    phone:          "",
    delivery_method: "courier",
    // ── Structured shipping address ────────────────────────────────
    // The merchant's CRM stores the address as a single freeform
    // string (`order_history.address`), so on submit we compose these
    // fields into "City, Street, Apartment, ZIP, Country" — that
    // ordering puts city first, which makes the shipping-label
    // renderer happy (it extracts city as the first comma-separated
    // segment for the highlighted block).
    addr_country:   "Kazakhstan",   // sensible default for our user base
    addr_city:      "",
    addr_street:    "",             // street + building number
    // Apartment is split into 4 structured fields — the courier sees
    // exactly which unit / floor / entrance / intercom to use, no
    // freeform-parsing required.
    addr_apartment: "",
    addr_floor:     "",
    addr_entrance:  "",
    addr_intercom:  "",
    addr_postal:    "",
    comment:        "",
    payment_method: "cash",
    promo_code:     initPromo,
    // Fulfillment — "courier" (default; courier delivers to address) or
    // "pickup" (customer picks up from a specific warehouse → no shipping fee).
    fulfillment_type:    "courier",
    pickup_warehouse_id: null,
  });

  // Compose the structured fields into a single string for backend
  // storage. City first so label rendering can split-by-comma and
  // pick city for the highlighted block. Apartment + floor + entrance
  // + intercom collapse into one street-line tail (matches how real
  // shipping labels print one address line below the recipient name).
  const composeAddress = () => {
    const aptBits = [];
    if (form.addr_apartment.trim()) aptBits.push(`кв ${form.addr_apartment.trim()}`);
    if (form.addr_floor.trim())     aptBits.push(`эт ${form.addr_floor.trim()}`);
    if (form.addr_entrance.trim())  aptBits.push(`под ${form.addr_entrance.trim()}`);
    if (form.addr_intercom.trim())  aptBits.push(`домофон ${form.addr_intercom.trim()}`);
    const aptLine = aptBits.join(", ");
    const street = [form.addr_street.trim(), aptLine].filter(Boolean).join(", ");
    return [
      form.addr_city.trim(),
      street,
      form.addr_postal.trim(),
      form.addr_country.trim(),
    ].filter(Boolean).join(", ");
  };

  // Pickup locations loaded once on mount — if the merchant opted at least
  // one warehouse into pickup, the toggle becomes visible.
  const [pickupLocations, setPickupLocations] = useState([]);
  const [deliveryEta, setDeliveryEta] = useState(null);

  // ── Saved addresses (per-user, persisted on the backend) ──────────
  // Logged-in customer can pick from previously-saved ones via the
  // dropdown OR enter a new address and tick "Save this address" to
  // store it for next time. selectedAddrId === 'new' means the form
  // is editable; any numeric id means we hydrated the form from a
  // saved entry (still editable so the customer can tweak per-order
  // differences like floor / intercom).
  // Saved-addresses dropdown — populated from /me/addresses on mount.
  // No explicit "save this address" checkbox anymore: the backend now
  // auto-saves the address on the user's first courier order (silent
  // default). UX matches Wildberries/Amazon — typing once is enough.
  const [savedAddresses,  setSavedAddresses]  = useState([]);
  const [selectedAddrId,  setSelectedAddrId]  = useState('new');

  // What contact methods does this merchant accept at checkout?
  // Driven by GET /auth/methods which reads crm_auth_providers. Email
  // is always true; phone toggles based on whether the merchant has
  // enabled SMS/phone-OTP login. We use this to pick the right UI:
  //   • both → toggle "Email / Phone"
  //   • email-only → just the email input
  //   • (phone-only is theoretically possible but rare in v1)
  const [authMethods, setAuthMethods] = useState({ email: true, phone: false });
  const [contactMode, setContactMode] = useState("email"); // "email" | "phone"

  const [promoApplied,  setPromoApplied]  = useState(null);
  const [promoError,    setPromoError]    = useState("");
  const [promoChecking, setPromoChecking] = useState(false);

  // ── Load user + cart ────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Guest visitors are perfectly fine on Checkout — the cart
        // they built (via auto-guest user) lives in the backend
        // already. We no longer redirect to /login when not "fully"
        // signed in: the user_id is whatever lazy-guest creation
        // assigned on the first Add-to-cart click.
        const user = await client.auth.getUser();
        if (!mounted) return;

        // Pre-fill from existing user account (real users will have
        // these, guests won't — fields stay empty for them).
        if (user) {
          setForm(f => ({
            ...f,
            recipient_first_name: user.first_name || f.recipient_first_name,
            recipient_last_name:  user.last_name  || f.recipient_last_name,
            customer_email:       user.email      || f.customer_email,
            phone:                user.phone      || f.phone,
          }));
        }

        const result = await client.cart.get();
        if (!mounted) return;
        // 401 here means even the guest cookie expired or got cleared.
        // Redirect to cart so the user can re-add items (which will
        // re-issue a fresh guest cookie).
        if (result.status === 401) { navigate("/cart"); return; }
        if (!result.ok || !result.data?.items?.length) { navigate("/cart"); return; }
        setCart(result.data);

        // Does the merchant require online card payment? Drives the Payment
        // section UI + whether checkout runs the strict init-payment flow.
        client.config?.get?.()
          .then(r => {
            if (!mounted || !r?.ok) return;
            setStoreConfig(r.data);
            // Default the selected payment method to the first ENABLED one
            // (multi-method model — methods coexist, buyer picks one).
            const pms = r.data?.payment_methods;
            if (Array.isArray(pms) && pms.length) {
              setForm(f => ({ ...f, payment_method: pms[0].method }));
            }
          })
          .catch(() => {});

        // What contact methods can this merchant accept? Drives the
        // "Email / Phone" choice in the Contact section. Optional —
        // fallback "email-only" if endpoint or SDK is missing.
        client.auth?.methods?.()
          .then(r => {
            if (!mounted || !r?.ok) return;
            setAuthMethods({ email: !!r.data?.email, phone: !!r.data?.phone });
          })
          .catch(() => {});

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
        // Saved addresses — also optional. If the SDK is old (no
        // `addresses` namespace), skip without crashing.
        client.addresses?.list?.()
          .then(r => {
            if (!mounted) return;
            const list = Array.isArray(r?.data) ? r.data : [];
            setSavedAddresses(list);
            // Auto-select the default (if any) and hydrate the form
            // fields from it. Falls back to "new" mode otherwise.
            const def = list.find(a => a.is_default) || list[0];
            if (def) {
              setSelectedAddrId(def.id);
              setForm(f => ({
                ...f,
                addr_country:   def.country     || f.addr_country,
                addr_city:      def.city        || "",
                addr_postal:    def.postal_code || "",
                addr_street:    def.street      || "",
                addr_apartment: def.apartment   || "",
                addr_floor:     def.floor       || "",
                addr_entrance:  def.entrance    || "",
                addr_intercom:  def.intercom    || "",
              }));
            }
          })
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

  // Pick an address from the saved list (or "new" to clear the form).
  // Sets the dropdown choice + hydrates the structured form fields so
  // the customer sees what they're about to submit.
  const pickSavedAddress = (id) => {
    setSelectedAddrId(id);
    if (id === 'new') {
      // Wipe the address fields so the customer types fresh data
      // rather than accidentally editing a previously-saved address.
      setForm(f => ({
        ...f,
        addr_city: "", addr_postal: "",
        addr_street: "", addr_apartment: "",
        addr_floor: "", addr_entrance: "", addr_intercom: "",
      }));
      return;
    }
    const a = savedAddresses.find(x => x.id === Number(id));
    if (!a) return;
    setForm(f => ({
      ...f,
      addr_country:   a.country     || f.addr_country,
      addr_city:      a.city        || "",
      addr_postal:    a.postal_code || "",
      addr_street:    a.street      || "",
      addr_apartment: a.apartment   || "",
      addr_floor:     a.floor       || "",
      addr_entrance:  a.entrance    || "",
      addr_intercom:  a.intercom    || "",
    }));
  };

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
    // Name validation — first + last required.
    if (!form.recipient_first_name.trim()) {
      setError("First name is required"); return;
    }
    if (!form.recipient_last_name.trim()) {
      setError("Last name is required"); return;
    }
    // Contact info — at least the active mode's field must be set.
    if (contactMode === "email" || !authMethods.phone) {
      if (!form.customer_email.trim()) {
        setError("Email is required"); return;
      }
      if (!/^[^@]+@[^@]+\.[^@]+$/.test(form.customer_email.trim())) {
        setError("Enter a valid email"); return;
      }
    } else if (contactMode === "phone") {
      if (!form.phone.trim()) {
        setError("Phone is required"); return;
      }
    }
    if (cart.requires_shipping && form.fulfillment_type === "courier") {
      // Require city + postal + street. Apartment and country
      // remain optional (rural areas, dorms etc. — but a postal
      // code matters for couriers to route correctly, so we don't
      // make it skippable like before).
      if (!form.addr_city.trim())   { setError("City is required"); return; }
      if (!form.addr_postal.trim()) { setError("Postal code is required"); return; }
      if (!form.addr_street.trim()) { setError("Street address is required"); return; }
    }
    if (cart.requires_shipping && form.fulfillment_type === "pickup" && !form.pickup_warehouse_id) {
      setError("Please pick a store to collect your order from");
      return;
    }
    setError("");
    setSubmitting(true);

    const payload = {
      // Structured recipient name fields — backend composes the
      // legacy `recipient_name` from these for back-compat.
      recipient_first_name:  form.recipient_first_name.trim(),
      recipient_last_name:   form.recipient_last_name.trim(),
      delivery_method: cart.requires_shipping ? form.delivery_method : "digital",
      payment_method:  form.payment_method,   // chosen method key (stripe|manual|other)
      fulfillment_type: cart.requires_shipping ? form.fulfillment_type : "courier",
    };
    if (form.recipient_middle_name.trim())
      payload.recipient_middle_name = form.recipient_middle_name.trim();
    // Contact info — backend persists this onto the (guest) users
    // record so the next email/phone-OTP login can find this account.
    if (form.customer_email.trim())
      payload.customer_email = form.customer_email.trim().toLowerCase();
    if (form.fulfillment_type === "pickup" && form.pickup_warehouse_id) {
      payload.pickup_warehouse_id = form.pickup_warehouse_id;
    }
    if (form.phone.trim())   payload.phone       = form.phone.trim();
    // Ship the structured address fields as separate keys — the
    // External backend reconstructs the legacy `address` string from
    // these for back-compat (invoice PDF + older clients), and the
    // shipping-label renderer uses the structured fields directly so
    // the highlighted City block on the label is always accurate.
    // Skip for pickup (warehouse handles itself) and digital orders.
    if (cart.requires_shipping && form.fulfillment_type === "courier") {
      if (form.addr_country.trim())   payload.address_country     = form.addr_country.trim();
      if (form.addr_city.trim())      payload.address_city        = form.addr_city.trim();
      if (form.addr_postal.trim())    payload.address_postal_code = form.addr_postal.trim();
      if (form.addr_street.trim())    payload.address_street      = form.addr_street.trim();
      if (form.addr_apartment.trim()) payload.address_apartment   = form.addr_apartment.trim();
      if (form.addr_floor.trim())     payload.address_floor       = form.addr_floor.trim();
      if (form.addr_entrance.trim())  payload.address_entrance    = form.addr_entrance.trim();
      if (form.addr_intercom.trim())  payload.address_intercom    = form.addr_intercom.trim();
      // Compose a legacy `address` string too — useful as a defensive
      // fallback if anything downstream still reads the freeform
      // column instead of the new structured ones.
      const composed = composeAddress();
      if (composed) payload.address = composed;
    }
    if (form.comment.trim()) payload.comment     = form.comment.trim();
    if (form.promo_code.trim()) payload.promo_code = form.promo_code.trim();

    // ── Strict-mode online payment ───────────────────────────────────────
    // Online (card) methods need a verified PaymentIntent before the order can
    // be created — collect the card via Stripe Elements. Offline methods
    // (manual / other) are placed directly (record-only).
    const _methods  = storeConfig?.payment_methods || [];
    const _selected = _methods.find(m => m.method === form.payment_method);
    const _isOnline = _selected ? !!_selected.online : !!storeConfig?.online_payment;
    if (_isOnline) {
      const idem = (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
      const init = await client.payments.initPayment(payload, { idempotencyKey: idem });
      if (!init.ok) {
        setError(init.error || "Could not start payment. Please try again.");
        setSubmitting(false);
        return;
      }
      const d = init.data || {};
      if (d.needs_payment_intent && d.client_secret) {
        // Open the card modal — the order is placed only after the customer's
        // card is confirmed (handleStripePaid).
        setStripeStep({
          publishableKey: d.publishable_key,
          clientSecret:   d.client_secret,
          amountLabel:    fmt(d.amount),
          testMode:       !!d.is_test_mode,
          payload,
        });
        setSubmitting(false);
        return;
      }
      if (d.kaspi_poll && d.intent_id) {
        // Async Kaspi push-payment: the invoice is already sent to the customer's
        // Kaspi app. Wait + poll status; place the order only once it flips to
        // paid (KaspiPaymentModal → handleKaspiPaid).
        setKaspiStep({
          intentId:    d.intent_id,
          amountLabel: fmt(d.amount),
          phone:       form.phone || "",
          payload,
        });
        setSubmitting(false);
        return;
      }
      if (d.halyk_pay) {
        // Halyk ePay — load Halyk's payment-api.js and call halyk.pay(); it
        // redirects to Halyk's hosted page. On return, /checkout/return places
        // the order (re-verified server-side before it's marked paid).
        try {
          sessionStorage.setItem("checkout_pending", JSON.stringify({
            payload, intentId: d.intent_id,
          }));
        } catch { /* ignore */ }
        try {
          await payHalyk(d.halyk_pay);
        } catch (e) {
          setError(e?.message || "Could not start Halyk payment. Please try again.");
          setSubmitting(false);
        }
        return;
      }
      if (d.cloudpayments_widget) {
        // TipTop Pay (ex-CloudPayments) — open the popup widget (no redirect). On
        // success it returns the gateway TransactionId; we place the order with it,
        // and place_order re-verifies that transaction server-side via /payments/get
        // (Status=Completed + amount) before it's marked paid.
        try {
          const txnId = await payTipTopPay(d.cloudpayments_widget);
          const placed = await client.orders.place({ ...payload, payment_intent_id: txnId });
          if (placed.ok) {
            navigate("/order-success", { state: { orderId: placed.data.order_id } });
          } else {
            setError(placed.error || "Payment went through but the order could not be saved. Please contact support.");
            setSubmitting(false);
          }
        } catch (e) {
          setError(e?.message || "Payment was not completed. Please try again.");
          setSubmitting(false);
        }
        return;
      }
      if (d.robokassa_redirect && d.redirect_url) {
        // Robokassa — redirect to the hosted payment page (like Halyk). Stash the
        // order payload + InvId; on return (/checkout/return) we place the order,
        // which re-verifies via OpStateExt server-side before marking it paid.
        try {
          sessionStorage.setItem("checkout_pending", JSON.stringify({
            payload, intentId: d.intent_id,
          }));
        } catch { /* sessionStorage unavailable — return flow degrades gracefully */ }
        window.location.href = d.redirect_url;
        return;
      }
      if (d.paypal_redirect && d.redirect_url) {
        // PayPal — redirect to the approve page. Stash the order payload + order id;
        // on return (/checkout/return) place_order CAPTURES + verifies COMPLETED
        // server-side before the order is marked paid.
        try {
          sessionStorage.setItem("checkout_pending", JSON.stringify({
            payload, intentId: d.intent_id,
          }));
        } catch { /* sessionStorage unavailable — return flow degrades gracefully */ }
        window.location.href = d.redirect_url;
        return;
      }
      // Provider fell back to manual (e.g. creds removed) → place directly.
    }

    const { ok, data, error } = await client.orders.place(payload);
    if (ok) {
      navigate("/order-success", { state: {
        orderId: data.order_id,
        // Offline methods carry "how to pay" instructions to the success screen.
        paymentLabel:        _selected && !_selected.online ? (_selected.label || "") : "",
        paymentInstructions: _selected && !_selected.online ? (_selected.instructions || "") : "",
      }});
    } else {
      setError(error || "Failed to place order. Please try again.");
      setSubmitting(false);
    }
  };

  // After Stripe confirms the card, place the order WITH the verified intent id.
  const handleStripePaid = async (paymentIntentId) => {
    const payload = { ...stripeStep.payload, payment_intent_id: paymentIntentId };
    const { ok, data, error } = await client.orders.place(payload);
    if (ok) {
      setStripeStep(null);
      navigate("/order-success", { state: { orderId: data.order_id } });
    } else {
      // Payment succeeded but order save failed — surface clearly. The intent
      // is idempotency-guarded server-side, so a retry won't double-charge.
      setStripeStep(null);
      setError(error || "Payment went through but the order could not be saved. Please contact support.");
      setSubmitting(false);
    }
  };

  // After Kaspi confirms (status flips to paid), place the order WITH the
  // verified invoice id — place_order re-verifies it server-side before paid.
  const handleKaspiPaid = async (intentId) => {
    const payload = { ...kaspiStep.payload, payment_intent_id: intentId };
    const { ok, data, error } = await client.orders.place(payload);
    if (ok) {
      setKaspiStep(null);
      navigate("/order-success", { state: { orderId: data.order_id } });
    } else {
      setKaspiStep(null);
      setError(error || "Payment confirmed but the order could not be saved. Please contact support.");
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
                <div className="checkout-addr-row">
                  <div className="checkout-field">
                    <label>First Name <span className="req">*</span></label>
                    <input
                      type="text"
                      className="checkout-input"
                      value={form.recipient_first_name}
                      onChange={e => set("recipient_first_name", e.target.value)}
                      placeholder="First name"
                      autoComplete="given-name" />
                  </div>
                  <div className="checkout-field">
                    <label>Last Name <span className="req">*</span></label>
                    <input
                      type="text"
                      className="checkout-input"
                      value={form.recipient_last_name}
                      onChange={e => set("recipient_last_name", e.target.value)}
                      placeholder="Last name"
                      autoComplete="family-name" />
                  </div>
                </div>
                <div className="checkout-field">
                  <label>Middle Name / Patronymic <span className="optional">optional</span></label>
                  <input
                    type="text"
                    className="checkout-input"
                    value={form.recipient_middle_name}
                    onChange={e => set("recipient_middle_name", e.target.value)}
                    placeholder="Middle name / Отчество"
                    autoComplete="additional-name" />
                </div>

                {/* Contact channel — depends on what merchant allows.
                    Both enabled → toggle; one enabled → that input
                    alone. Fallback: email (always available). */}
                {authMethods.email && authMethods.phone && (
                  <div className="checkout-toggle checkout-contact-toggle">
                    <button type="button"
                      className={`checkout-toggle-btn${contactMode === "email" ? " checkout-toggle-btn--active" : ""}`}
                      onClick={() => setContactMode("email")}>
                      Email
                    </button>
                    <button type="button"
                      className={`checkout-toggle-btn${contactMode === "phone" ? " checkout-toggle-btn--active" : ""}`}
                      onClick={() => setContactMode("phone")}>
                      Phone
                    </button>
                  </div>
                )}
                {(contactMode === "email" || !authMethods.phone) && (
                  <div className="checkout-field">
                    <label>Email <span className="req">*</span></label>
                    <input
                      type="email"
                      className="checkout-input"
                      value={form.customer_email}
                      onChange={e => set("customer_email", e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email" />
                    <span className="optional">
                      We'll send order confirmation here. Sign up later with
                      this email to keep your order history.
                    </span>
                  </div>
                )}
                {(contactMode === "phone" || (authMethods.phone && !authMethods.email)) && (
                  <div className="checkout-field">
                    <label>Phone <span className="req">*</span></label>
                    <input
                      type="tel"
                      className="checkout-input"
                      value={form.phone}
                      onChange={e => set("phone", e.target.value)}
                      placeholder="+7 777 123 4567"
                      autoComplete="tel" />
                  </div>
                )}
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

                    {/* Saved-addresses picker — only shown when the
                        customer actually has saved addresses. The
                        select pre-fills the form below; choosing
                        "Use a new address" clears it. */}
                    {savedAddresses.length > 0 && (
                      <div className="checkout-field checkout-field--mt">
                        <label htmlFor="saved-addr">Saved addresses</label>
                        <select
                          id="saved-addr" className="checkout-input"
                          value={selectedAddrId}
                          onChange={e => pickSavedAddress(e.target.value)}>
                          {savedAddresses.map(a => (
                            <option key={a.id} value={a.id}>
                              {a.label ? `${a.label} · ` : ""}
                              {[a.city, a.street, a.apartment].filter(Boolean).join(", ")}
                              {a.is_default ? " (default)" : ""}
                            </option>
                          ))}
                          <option value="new">+ Use a new address</option>
                        </select>
                      </div>
                    )}

                    {/* Structured address form — mirrors what real
                        carriers ask for (city + postal + street are
                        required; country / apartment are optional).
                        Layout follows the "City + Postal on one row,
                        Street + Apartment full-width" pattern that
                        most shipping forms (Stripe Checkout, Shopify,
                        Amazon) settled on. */}
                    {/* Country picker — custom button-based combobox
                        instead of native <input list> so the browser
                        doesn't paste in the customer's autofill data
                        (which made it look like we'd already saved
                        their personal info). */}
                    <div className="checkout-field checkout-field--mt">
                      <label>Country</label>
                      <CountryCombobox
                        value={form.addr_country}
                        onChange={(v) => set("addr_country", v)}
                        placeholder="Select country" />
                    </div>

                    <div className="checkout-addr-row">
                      <div className="checkout-field">
                        <label htmlFor="addr-city">City <span className="req">*</span></label>
                        {/* Generic placeholders below — avoid baking
                            real personal addresses into the UI; the
                            customer was uncomfortable seeing what
                            looked like their own data pre-filled. */}
                        <input
                          id="addr-city" type="text"
                          className="checkout-input"
                          value={form.addr_city}
                          onChange={e => set("addr_city", e.target.value)}
                          placeholder="City name"
                          autoComplete="off" />
                      </div>
                      <div className="checkout-field">
                        <label htmlFor="addr-postal">Postal Code <span className="req">*</span></label>
                        <input
                          id="addr-postal" type="text"
                          className="checkout-input"
                          value={form.addr_postal}
                          onChange={e => set("addr_postal", e.target.value)}
                          placeholder="Postal / ZIP code"
                          autoComplete="off" />
                      </div>
                    </div>

                    <div className="checkout-field">
                      <label htmlFor="addr-street">Street + Building <span className="req">*</span></label>
                      <input
                        id="addr-street" type="text"
                        className="checkout-input"
                        value={form.addr_street}
                        onChange={e => set("addr_street", e.target.value)}
                        placeholder="Street name and building number"
                        autoComplete="off" />
                    </div>

                    {/* Apartment block — 4 structured fields in a
                        2×2 grid. Apartment is the most important so
                        it goes top-left; intercom (least common)
                        bottom-right. Couriers read the label one
                        row at a time and the columns line up with
                        the human reading order: "where do I go". */}
                    <div className="checkout-addr-row">
                      <div className="checkout-field">
                        <label htmlFor="addr-apartment">Apartment</label>
                        <input
                          id="addr-apartment" type="text"
                          className="checkout-input"
                          value={form.addr_apartment}
                          onChange={e => set("addr_apartment", e.target.value)}
                          placeholder="123"
                          autoComplete="off" />
                      </div>
                      <div className="checkout-field">
                        <label htmlFor="addr-floor">Floor</label>
                        <input
                          id="addr-floor" type="text"
                          className="checkout-input"
                          value={form.addr_floor}
                          onChange={e => set("addr_floor", e.target.value)}
                          placeholder="4"
                          autoComplete="off" />
                      </div>
                    </div>
                    <div className="checkout-addr-row">
                      <div className="checkout-field">
                        <label htmlFor="addr-entrance">Entrance</label>
                        <input
                          id="addr-entrance" type="text"
                          className="checkout-input"
                          value={form.addr_entrance}
                          onChange={e => set("addr_entrance", e.target.value)}
                          placeholder="2"
                          autoComplete="off" />
                      </div>
                      <div className="checkout-field">
                        <label htmlFor="addr-intercom">Intercom</label>
                        <input
                          id="addr-intercom" type="text"
                          className="checkout-input"
                          value={form.addr_intercom}
                          onChange={e => set("addr_intercom", e.target.value)}
                          placeholder="123#"
                          autoComplete="off" />
                      </div>
                    </div>

                    {/* Address auto-saves on first order — no checkbox
                        needed. Tiny hint so the customer knows the
                        info is being kept. */}
                    {savedAddresses.length === 0 && (
                      <span className="optional checkout-autosave-hint">
                        We'll remember this address for next time
                      </span>
                    )}
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

            {/* Payment — multi-method picker (methods coexist; buyer picks one) */}
            <div className="checkout-section">
              <h2 className="checkout-section-title">Payment</h2>

              {(() => {
                // Methods from /config. Fall back to a sensible single option for
                // older /config responses that predate `payment_methods`.
                const pms = storeConfig?.payment_methods;
                const methods = (Array.isArray(pms) && pms.length)
                  ? pms
                  : (storeConfig?.online_payment
                      ? [{ method: "stripe", label: "Card",            online: true,  instructions: "" }]
                      : [{ method: "manual", label: "Pay on Delivery", online: false, instructions: "" }]);
                const selected = methods.find(m => m.method === form.payment_method) || methods[0];

                return (
                  <>
                    <div className="checkout-toggle">
                      {methods.map(m => (
                        <button key={m.method} type="button"
                          className={`checkout-toggle-btn${selected?.method === m.method ? " checkout-toggle-btn--active" : ""}`}
                          onClick={() => set("payment_method", m.method)}>
                          {m.online ? <CreditCard weight="bold" /> : <Money weight="bold" />} {m.label}
                        </button>
                      ))}
                    </div>

                    {(selected?.method === "kaspi_aipay" || selected?.method === "apipay") ? (
                      <>
                        <p className="checkout-note">
                          Kaspi payment — enter your Kaspi phone number below. We'll push the
                          payment request to your Kaspi app; approve it there to finish.
                          {storeConfig?.payment_test_mode ? " (Test mode)" : ""}
                        </p>
                        <div className="checkout-field" style={{ marginTop: 10 }}>
                          <label>Kaspi phone number <span style={{ color: "#e11" }}>*</span></label>
                          <input
                            type="tel"
                            className="checkout-input"
                            value={form.phone}
                            onChange={e => set("phone", e.target.value)}
                            placeholder="+7 7XX XXX XX XX"
                            autoComplete="tel"
                          />
                        </div>
                      </>
                    ) : selected?.online ? (
                      <p className="checkout-note">
                        Secure card payment — you'll enter your card on the next step.
                        Your card is handled directly by the payment provider; we never see it.
                        {storeConfig?.payment_test_mode ? " (Test mode)" : ""}
                      </p>
                    ) : (
                      <p className="checkout-note" style={{ whiteSpace: "pre-line" }}>
                        {selected?.instructions
                          ? selected.instructions
                          : "Your order will be recorded and we'll confirm payment details with you."}
                      </p>
                    )}
                  </>
                );
              })()}
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
                  <span className="checkout-item-price">{fmt(item.item_total ?? item.price)}</span>
                </div>
              ))}
            </div>

            <div className="checkout-totals">
              <div className="checkout-total-row">
                <span>Subtotal</span>
                <span>{fmt(subtotal)}</span>
              </div>
              <div className="checkout-total-row">
                <span>Shipping</span>
                <span>{shipping === 0 ? "Free" : fmt(shipping)}</span>
              </div>
              {discount > 0 && (
                <div className="checkout-total-row checkout-total-row--discount">
                  <span>Discount</span>
                  <span>−{fmt(discount)}</span>
                </div>
              )}
              <div className="checkout-total-row checkout-total-row--total">
                <span>Total</span>
                <span>{fmt(total)}</span>
              </div>
            </div>

          </div>
        </div>

      </div>

      {stripeStep && (
        <StripePaymentModal
          publishableKey={stripeStep.publishableKey}
          clientSecret={stripeStep.clientSecret}
          amountLabel={stripeStep.amountLabel}
          testMode={stripeStep.testMode}
          onPaid={handleStripePaid}
          onClose={() => { setStripeStep(null); setSubmitting(false); }}
        />
      )}

      {kaspiStep && (
        <KaspiPaymentModal
          intentId={kaspiStep.intentId}
          amountLabel={kaspiStep.amountLabel}
          phone={kaspiStep.phone}
          onPaid={handleKaspiPaid}
          onClose={() => { setKaspiStep(null); setSubmitting(false); }}
        />
      )}
    </>
  );
}

export default Checkout;
