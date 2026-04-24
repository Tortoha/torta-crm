import { useLocation, Link } from "react-router-dom";
import Header from "./Header";
import "./Style/OrderSuccess.css";

function OrderSuccess() {
  const location = useLocation();
  const orderId  = location.state?.orderId;

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
