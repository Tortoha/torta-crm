// Real card payment step (strict-mode checkout). Opened by Checkout.jsx after
// client.payments.initPayment() returns a Stripe client_secret. Mounts Stripe's
// Payment Element with the merchant's OWN publishable key, confirms the
// PaymentIntent inline (redirect: 'if_required' keeps cards on-page), and hands
// the confirmed intent id back so Checkout can POST /orders with it.
//
// Non-custodial: the card never touches our backend — Stripe.js talks straight
// to Stripe, money lands in the merchant's connected account.

import { useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";

const overlayStyle = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 2000, padding: 16,
};
const boxStyle = {
  background: "#fff", borderRadius: 18, padding: 24,
  width: "100%", maxWidth: 460, boxShadow: "0 24px 70px rgba(0,0,0,0.35)",
};

function PayInner({ amountLabel, testMode, onPaid, onClose }) {
  const stripe   = useStripe();
  const elements = useElements();
  const [busy,  setBusy]  = useState(false);
  const [ready, setReady] = useState(false);
  const [err,   setErr]   = useState("");

  const pay = async () => {
    if (!stripe || !elements) return;
    setBusy(true); setErr("");
    // clientSecret is already in Elements options, so confirmPayment alone
    // validates + confirms. redirect:'if_required' keeps card payments inline;
    // only methods that mandate a redirect (rare) would navigate away.
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });
    if (error) { setErr(error.message || "Payment failed. Check your card details."); setBusy(false); return; }
    if (paymentIntent && paymentIntent.status === "succeeded") {
      onPaid(paymentIntent.id);            // parent places the order
    } else {
      setErr("Payment could not be completed. Please try another card.");
      setBusy(false);
    }
  };

  return (
    <>
      {testMode && (
        <div style={{
          background: "#eef4ff", color: "#0b5cff", borderRadius: 10,
          padding: "8px 12px", fontSize: 13, marginBottom: 14,
        }}>
          Test mode — card <b>4242&nbsp;4242&nbsp;4242&nbsp;4242</b>, any future date, any CVC.
        </div>
      )}
      <PaymentElement onReady={() => setReady(true)} />
      {err && <p className="checkout-error" style={{ marginTop: 12 }}>{err}</p>}
      <button type="button" className="checkout-submit-btn"
        style={{ width: "100%", marginTop: 16 }}
        onClick={pay} disabled={busy || !ready}>
        {busy ? "Processing…" : `Pay ${amountLabel}`}
      </button>
      <button type="button" onClick={onClose} disabled={busy}
        style={{ width: "100%", marginTop: 8, background: "none", border: "none",
                 color: "#666", fontSize: 13, cursor: "pointer", padding: 8 }}>
        Cancel
      </button>
    </>
  );
}

export default function StripePaymentModal({ publishableKey, clientSecret, amountLabel, testMode, onPaid, onClose }) {
  // loadStripe memoizes globally per key; useMemo gives one stable promise.
  const stripePromise = useMemo(() => loadStripe(publishableKey), [publishableKey]);

  return (
    <div style={overlayStyle} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={boxStyle} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: "0 0 16px", fontSize: 20, fontWeight: 700 }}>Card payment</h2>
        {clientSecret && publishableKey ? (
          <Elements stripe={stripePromise}
            options={{ clientSecret, appearance: { theme: "stripe" } }}>
            <PayInner amountLabel={amountLabel} testMode={testMode}
              onPaid={onPaid} onClose={onClose} />
          </Elements>
        ) : (
          <>
            <p className="checkout-error">Payment could not be initialized.</p>
            <button type="button" className="checkout-submit-btn"
              style={{ width: "100%", marginTop: 12 }} onClick={onClose}>Close</button>
          </>
        )}
      </div>
    </div>
  );
}
