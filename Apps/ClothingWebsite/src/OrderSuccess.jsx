import { useEffect, useState } from "react";
import { useLocation, Link } from "react-router-dom";
import Header from "./Header";
import { client } from "./api.js";
import "./Style/OrderSuccess.css";
import "./Style/Digital.css";

// Human filename from a download URL (the bundle lands as "_bundle.zip").
function fileLabel(url) {
  try {
    const name = decodeURIComponent(new URL(url).pathname).split("/").pop() || "download";
    return name === "_bundle.zip" ? "Download ZIP" : name;
  } catch {
    return "download";
  }
}

function OrderSuccess() {
  const location = useLocation();
  const orderId         = location.state?.orderId;
  const payInstructions = location.state?.paymentInstructions || "";
  const payLabel        = location.state?.paymentLabel || "";

  const [downloads, setDownloads] = useState([]);

  // After a digital purchase, surface the download link(s) right here so the buyer
  // immediately knows where the files are (they're also emailed + kept in My Orders).
  useEffect(() => {
    if (!orderId) return;
    let alive = true;
    client.orders.list()
      .then(({ ok, data }) => {
        if (!alive || !ok) return;
        const order = (data || []).find(o => String(o.id) === String(orderId));
        if (order && Array.isArray(order.downloads)) setDownloads(order.downloads);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [orderId]);

  return (
    <>
      <Header />
      <div className="success-page">
        <div className="success-card">

          <div className="success-icon">✓</div>

          <h1 className="success-title">Order Placed!</h1>

          {orderId && (
            <p className="success-order-num">Order #{orderId}</p>
          )}

          <p className="success-desc">
            Thank you for your purchase.<br />
            We'll send you a confirmation email shortly.
          </p>

          {/* Digital downloads — the files live in your store's cloud; show the link(s)
              right here so the buyer can grab them now (also emailed + in My Orders). */}
          {downloads.length > 0 && (
            <div style={{
              marginTop: 4, marginBottom: 20, padding: 16,
              borderRadius: 16, background: "rgba(0,113,227,0.06)", textAlign: "left",
            }}>
              <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>
                Your download{downloads.length > 1 ? "s are" : " is"} ready
              </div>
              <div className="dg-links">
                {downloads.map((f, i) => (
                  <a key={i} className="dg-dl-link" href={f.url}
                    target="_blank" rel="noopener noreferrer" download>
                    ⬇ {fileLabel(f.url)}
                  </a>
                ))}
              </div>
              <p style={{ margin: "10px 0 0", fontSize: 12, color: "#666" }}>
                We've also emailed these links — re-download anytime from My Orders.
              </p>
            </div>
          )}

          {/* Offline payment methods (Kaspi, bank transfer, …) show the
              merchant's "how to pay" instructions right here. */}
          {payInstructions && (
            <div style={{
              marginTop: 4, marginBottom: 20, padding: 16,
              borderRadius: 16, background: "rgba(0,113,227,0.06)",
              textAlign: "left", whiteSpace: "pre-line",
            }}>
              <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>
                How to pay{payLabel ? ` · ${payLabel}` : ""}
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.5, color: "#444" }}>
                {payInstructions}
              </div>
            </div>
          )}

          <div className="success-actions">
            <Link to="/orders" className="success-btn success-btn--secondary">
              My Orders
            </Link>
            <Link to="/" className="success-btn success-btn--primary">
              Continue Shopping
            </Link>
          </div>

        </div>
      </div>
    </>
  );
}

export default OrderSuccess;
