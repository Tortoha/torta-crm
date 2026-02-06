import { useEffect } from "react";

function CartSummary({ items, shippingSettings, promoCode, setPromoCode, appliedPromo, promoError, onApplyPromo }) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const shippingCost = subtotal >= (shippingSettings.free_shipping_threshold || 2000) 
    ? 0 
    : (shippingSettings.shipping_cost || 10);
  const discount = appliedPromo ? appliedPromo.discount : 0;
  const total = subtotal + shippingCost - discount;

  const freeShippingProgress = Math.min(
    (subtotal / (shippingSettings.free_shipping_threshold || 2000)) * 100, 
    100
  );
  const amountToFreeShipping = Math.max(
    (shippingSettings.free_shipping_threshold || 2000) - subtotal, 
    0
  );

  useEffect(() => {
    if (promoCode.length >= 3) {
      const timer = setTimeout(() => {
        onApplyPromo();
      }, 500);
      
      return () => clearTimeout(timer);
    }
  }, [promoCode]);

  const discountPercent = appliedPromo 
    ? Math.round((appliedPromo.discount / subtotal) * 100)
    : 0;

  return (
    <div className="cart-summary">
      <div className="summary-card">
        <div className="summary-row summary-subtotal">
          <span>Subtotal</span>
          <span>{Math.round(subtotal)}$</span>
        </div>
        {items.map((item) => (
          <div key={item.cart_item_id} className="summary-item">
            <span>{item.title}</span>
            <span>{Math.round(item.price * item.quantity)}$</span>
          </div>
        ))}

        <div className="summary-row summary-shipping">
          <span>Estimated Shipping</span>
          <span>{shippingCost === 0 ? "Free" : `${shippingCost}$`}</span>
        </div>
        
        <div className="shipping-progress">
          <div className="progress-header">
            <span className="progress-text">To free shipping</span>
            <span className="progress-amount">{Math.round(amountToFreeShipping)}$</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${freeShippingProgress}%` }} />
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