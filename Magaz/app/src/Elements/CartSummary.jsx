import { useEffect } from "react";

function CartSummary({ promoCode, setPromoCode, appliedPromo, promoError, onApplyPromo, cartData }) {
  useEffect(() => {
    if (promoCode.length >= 3) {
      const timer = setTimeout(() => {
        onApplyPromo();
      }, 500);
      
      return () => clearTimeout(timer);
    }
  }, [promoCode, onApplyPromo]);

  const subtotal = appliedPromo ? appliedPromo.subtotal : cartData.subtotal;
  const shippingCost = appliedPromo ? appliedPromo.shipping_cost : cartData.shipping_cost;
  const discount = appliedPromo ? appliedPromo.discount : 0;
  const total = appliedPromo ? appliedPromo.total : cartData.total;
  const discountPercent = appliedPromo ? appliedPromo.discount_percent : 0;

  return (
    <div className="cart-summary">
      <div className="summary-card">
        <div className="summary-row summary-subtotal">
          <span>Subtotal</span>
          <span>{Math.round(subtotal)}$</span>
        </div>

        <div className="summary-row summary-shipping">
          <span>Estimated Shipping</span>
          <span>{shippingCost === 0 ? "Free" : `${shippingCost}$`}</span>
        </div>
        
        <div className="shipping-progress">
          <div className="progress-header">
            <span className="progress-text">To free shipping</span>
            <span className="progress-amount">{Math.round(cartData.amount_to_free_shipping)}$</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${cartData.shipping_progress}%` }} />
          </div>
        </div>

        <div className="promo-section">
          <div className="promo-header">
            <span className="promo-code-label">Promo Code</span>
            {appliedPromo && (
              <span className="promo-discount">−{discountPercent}%</span>
            )}
          </div>
          <input
            type="text"
            className={`promo-code-input ${promoError ? "promo-code-input--error" : ""}`}
            placeholder="Enter code"
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
          />
          {promoError && (
            <div className="promo-error">{promoError}</div>
          )}
        </div>
      </div>

      <div className="summary-card">
        <div className="summary-row summary-total">
          <span>Total</span>
          <span>{Math.round(total)}$</span>
        </div>
        <button className="checkout-btn">Checkout</button>
      </div>
    </div>
  );
}

export default CartSummary