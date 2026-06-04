import { useLocation, Link } from "react-router-dom";
import Header from "./Header";
import "./Style/OrderSuccess.css";

function OrderSuccess() {
  const location = useLocation();
  const orderId         = location.state?.orderId;
  const payInstructions = location.state?.paymentInstructions || "";
  const payLabel        = location.state?.paymentLabel || "";

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
