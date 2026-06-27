// Hosted-page return handler (Halyk ePay). After the buyer pays on the bank's
// hosted page they land here (success / failure return URL). We pull the stashed
// order payload + the intent id, then place the order — place_order re-verifies
// the payment server-side (Halyk status API) before marking it paid, so a forged
// return can't fake a paid order. On success → order-success; otherwise → back
// to checkout.

import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { client } from "./api.js";

export default function CheckoutReturn() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;        // place the order exactly once
    ran.current = true;

    let pending = null;
    try { pending = JSON.parse(sessionStorage.getItem("checkout_pending") || "null"); } catch { /* ignore */ }
    try { sessionStorage.removeItem("checkout_pending"); } catch { /* ignore */ }

    if (params.get("status") === "failure") {
      setError("Payment was not completed. Please try again.");
      return;
    }
    if (!pending?.payload || !pending?.intentId) {
      setError("We couldn't match your payment to an order. If you were charged, contact support.");
      return;
    }

    (async () => {
      const payload = { ...pending.payload, payment_intent_id: pending.intentId };
      const { ok, data, error: err } = await client.orders.place(payload);
      if (ok) {
        navigate("/order-success", { replace: true, state: { orderId: data.order_id } });
      } else {
        // place_order rejects unless the provider confirms 'paid' server-side.
        setError(err || "Payment could not be confirmed yet. If you were charged, contact support.");
      }
    })();
  }, [navigate, params]);

  return (
    <div style={{ minHeight: "60vh", display: "flex", alignItems: "center",
                  justifyContent: "center", textAlign: "center", padding: 24 }}>
      <div>
        {!error ? (
          <>
            <div style={{ fontSize: 38, marginBottom: 10 }}>⏳</div>
            <h2 style={{ margin: 0, fontWeight: 700 }}>Confirming your payment…</h2>
            <p style={{ color: "#888", marginTop: 8 }}>One moment — please don&apos;t close this page.</p>
          </>
        ) : (
          <>
            <div style={{ fontSize: 38, marginBottom: 10 }}>⚠️</div>
            <h2 style={{ margin: "0 0 8px", fontWeight: 700 }}>Payment not completed</h2>
            <p style={{ color: "#555", maxWidth: 420 }}>{error}</p>
            <button onClick={() => navigate("/checkout")}
              style={{ marginTop: 16, padding: "10px 20px", borderRadius: 999,
                       border: "none", background: "#111", color: "#fff", cursor: "pointer" }}>
              Back to checkout
            </button>
          </>
        )}
      </div>
    </div>
  );
}
