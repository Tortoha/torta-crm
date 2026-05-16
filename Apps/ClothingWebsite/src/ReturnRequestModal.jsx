// Customer-side: request a return for items from a delivered order.
// 14-day window (enforced server-side; we hide the button when expired).
// Submits via torta-js SDK client.orders.requestReturn().

import { useState } from "react";
import { createPortal } from "react-dom";
import { X, CheckCircle, Warning, Check } from "@phosphor-icons/react";
import { client } from "./api.js";
import "./Style/ReturnRequest.css";

const REASONS = [
  { value: "damaged",          label: "Arrived damaged" },
  { value: "wrong_item",       label: "Wrong item received" },
  { value: "not_as_described", label: "Not as described" },
  { value: "changed_mind",     label: "Changed my mind" },
  { value: "arrived_late",     label: "Arrived too late" },
  { value: "quality_issue",    label: "Quality issue" },
  { value: "other",            label: "Other" },
];

export default function ReturnRequestModal({ order, onClose, onSubmitted, existingReturns = [] }) {
  // Compute already-returning quantity per order_item_id from active returns
  const activeQty = {};
  for (const r of existingReturns) {
    if (["requested", "approved", "received", "inspected"].includes(r.status)) {
      for (const it of r.items || []) {
        activeQty[it.order_item_id] = (activeQty[it.order_item_id] || 0) + it.quantity;
      }
    }
  }

  // Build selection state — { order_item_id: quantity_being_requested }
  const [selection, setSelection] = useState({});
  const [reason,    setReason]    = useState("damaged");
  const [message,   setMessage]   = useState("");
  const [busy,      setBusy]      = useState(false);
  const [error,     setError]     = useState("");

  // The /orders endpoint doesn't return order_item ids. Real impl: storefront
  // would need to be enhanced to expose them. For now we synthesise from index.
  const items = (order.items || []).map((it, i) => ({
    ...it,
    order_item_id: it.order_item_id ?? it.id ?? i,
    quantity:      it.quantity ?? 1,
  }));

  const toggleItem = (it) => {
    const id = it.order_item_id;
    const ordered = it.quantity;
    const alreadyReturning = activeQty[id] || 0;
    const remaining = ordered - alreadyReturning;
    if (remaining <= 0) return;
    setSelection(prev => {
      if (prev[id]) {
        const { [id]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [id]: remaining };
    });
  };

  const setQty = (id, max, qty) => {
    const n = Math.max(1, Math.min(max, parseInt(qty, 10) || 1));
    setSelection(prev => ({ ...prev, [id]: n }));
  };

  const submit = async () => {
    setError("");
    const chosen = Object.entries(selection)
      .filter(([, q]) => q > 0)
      .map(([id, q]) => ({ order_item_id: parseInt(id, 10), quantity: q }));
    if (!chosen.length) {
      setError("Pick at least one item to return");
      return;
    }
    if (!message.trim() && reason === "other") {
      setError("Please describe the issue");
      return;
    }
    setBusy(true);
    try {
      const res = await client.orders.requestReturn(order.id, {
        reason,
        customer_message: message.trim(),
        items: chosen,
        customer_photos: [],
      });
      if (!res.ok) {
        setError(res.error || "Failed to submit");
        return;
      }
      onSubmitted?.(res.data);
      onClose();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="rr-overlay" onClick={onClose}>
      <div className="rr-modal" onClick={e => e.stopPropagation()}>
        {/* Header: title/sub + close. Sticky-ish via column flex (modal scrolls
            the body only, header + footer stay anchored). */}
        <div className="rr-head">
          <div className="rr-head-text">
            <h2 className="rr-title">Request a return</h2>
            <p className="rr-sub">Order #{order.id} · within 14 days of delivery</p>
          </div>
          <button className="rr-close" onClick={onClose} aria-label="Close">
            <X weight="bold" size={16} />
          </button>
        </div>

        <div className="rr-body">
          {/* Items selector */}
          <div className="rr-section">
            <h3 className="rr-section-title">Which items?</h3>
            <div className="rr-items">
              {items.map(it => {
                const id = it.order_item_id;
                const ordered = it.quantity;
                const alreadyReturning = activeQty[id] || 0;
                const remaining = ordered - alreadyReturning;
                const isPicked = selection[id] != null;
                const noneLeft = remaining <= 0;
                const metaParts = [it.variation_name, it.configuration_name]
                  .filter(Boolean).join(' · ');
                return (
                  <div key={id}
                    className={`rr-item${isPicked ? ' rr-item--picked' : ''}${noneLeft ? ' rr-item--disabled' : ''}`}
                    onClick={() => toggleItem(it)}>
                    <span className="rr-checkbox" aria-hidden>
                      <Check weight="bold" />
                    </span>
                    {it.image_url
                      ? <img src={it.image_url} alt="" className="rr-item-img" />
                      : <span className="rr-item-img rr-item-img--empty" />}
                    <div className="rr-item-info">
                      <span className="rr-item-name">{it.title}</span>
                      <span className="rr-item-meta">
                        {metaParts}
                        {metaParts && ' · '}
                        purchased {ordered}
                        {alreadyReturning > 0 && ` · in return ${alreadyReturning}`}
                      </span>
                    </div>
                    {isPicked && !noneLeft ? (
                      <input type="number" min={1} max={remaining}
                        value={selection[id]}
                        onChange={e => setQty(id, remaining, e.target.value)}
                        onClick={e => e.stopPropagation()}
                        className="rr-qty" />
                    ) : <span />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Reason */}
          <div className="rr-section">
            <h3 className="rr-section-title">Reason</h3>
            <div className="rr-reasons">
              {REASONS.map(r => (
                <label key={r.value}
                  className={`rr-reason${reason === r.value ? ' rr-reason--active' : ''}`}>
                  <input type="radio" name="reason" value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)} />
                  <span className="rr-radio" aria-hidden />
                  <span className="rr-reason-label">{r.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Message */}
          <div className="rr-section">
            <h3 className="rr-section-title">Tell us more (optional)</h3>
            <textarea className="rr-textarea"
              placeholder="Describe the issue, what you'd like to happen, etc."
              value={message} maxLength={2000}
              onChange={e => setMessage(e.target.value)} />
          </div>

          {error && (
            <div className="rr-error">
              <Warning weight="duotone" size={16} /> {error}
            </div>
          )}
        </div>

        <div className="rr-actions">
          <button className="rr-btn rr-btn--cancel" onClick={onClose}>Cancel</button>
          <button className="rr-btn rr-btn--submit" disabled={busy} onClick={submit}>
            {busy ? "Submitting…" : (<><CheckCircle weight="fill" size={14} /> Submit return</>)}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
