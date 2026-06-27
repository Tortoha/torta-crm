// Kaspi (via AiPay) payment step — an async push-payment, NOT a card form.
// Opened by Checkout.jsx after client.payments.initPayment() returns
// { kaspi_poll: true, intent_id }. AiPay has already pushed a payment request
// into the customer's Kaspi app (via the merchant's POS terminal); here we just
// wait and poll the authoritative status server-side until it flips to paid,
// then hand the invoice id back so Checkout can POST /orders with it.
//
// Non-custodial: money lands in the merchant's own Kaspi account. We only
// OBSERVE the status (server-to-server) — never trust the client for "paid".

import { useEffect, useRef, useState } from "react";
import { client } from "./api.js";

const overlayStyle = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 2000, padding: 16,
};
const boxStyle = {
  background: "#fff", borderRadius: 18, padding: 24,
  width: "100%", maxWidth: 460, boxShadow: "0 24px 70px rgba(0,0,0,0.35)",
  textAlign: "center",
};

const POLL_MS = 3000;
const TIMEOUT_MS = 3 * 60 * 1000;   // invoice lifetime is short; give up after ~3 min

// Terminal failure statuses → stop polling and explain why.
const FAIL = {
  expired:    "The payment request expired. Please try again.",
  canceled:   "The payment was canceled.",
  rejected:   "The payment was rejected.",
  no_account: "No Kaspi account was found for this phone number.",
};

export default function KaspiPaymentModal({ intentId, amountLabel, phone, onPaid, onClose }) {
  const [status, setStatus]     = useState("pending");
  const [err, setErr]           = useState("");
  const [checking, setChecking] = useState(false);
  const doneRef  = useRef(false);
  const startRef = useRef(Date.now());

  const checkOnce = async () => {
    if (doneRef.current) return;
    setChecking(true);
    const res = await client.payments.status(intentId);
    setChecking(false);
    if (doneRef.current) return;
    if (!res.ok) return;            // transient error — keep polling
    const d = res.data || {};
    if (d.paid) {
      doneRef.current = true;
      onPaid(intentId);            // parent places the order with this id
      return;
    }
    const st = (d.status || "").toLowerCase();
    setStatus(st || "pending");
    if (FAIL[st]) {
      doneRef.current = true;
      setErr(FAIL[st]);
    }
  };

  useEffect(() => {
    let active = true;
    const tick = async () => {
      if (!active || doneRef.current) return;
      if (Date.now() - startRef.current > TIMEOUT_MS) {
        doneRef.current = true;
        setErr("Timed out waiting for payment. If you already paid, contact support.");
        return;
      }
      await checkOnce();
    };
    const id = setInterval(tick, POLL_MS);
    tick();                          // immediate first check
    return () => { active = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intentId]);

  const failed = !!err;

  return (
    <div style={overlayStyle} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={boxStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 38, marginBottom: 8 }}>{failed ? "⚠️" : "📲"}</div>
        <h2 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 700 }}>
          {failed ? "Payment not completed" : "Confirm in your Kaspi app"}
        </h2>
        {!failed ? (
          <>
            <p style={{ color: "#444", fontSize: 14, margin: "0 0 6px" }}>
              We sent a payment request for <b>{amountLabel}</b>
              {phone ? <> to <b>{phone}</b></> : null}. Open <b>Kaspi.kz</b> and approve it.
            </p>
            <p style={{ color: "#888", fontSize: 13, margin: "10px 0 0" }}>
              {checking ? "Checking…" : "Waiting for confirmation…"}
            </p>
            <button type="button" className="checkout-submit-btn"
              style={{ width: "100%", marginTop: 18 }}
              onClick={checkOnce} disabled={checking}>
              I&apos;ve paid — check now
            </button>
          </>
        ) : (
          <p className="checkout-error" style={{ marginTop: 4 }}>{err}</p>
        )}
        <button type="button" onClick={onClose}
          style={{ width: "100%", marginTop: 8, background: "none", border: "none",
                   color: "#666", fontSize: 13, cursor: "pointer", padding: 8 }}>
          {failed ? "Close" : "Cancel"}
        </button>
      </div>
    </div>
  );
}
