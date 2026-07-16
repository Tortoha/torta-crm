// Static mock of the storefront checkout with the Kaspi push-payment flow
// (light theme only). Approximates Apps/ClothingWebsite Checkout + KaspiPaymentModal.

import { DeviceMobile, CreditCard, Money } from '@phosphor-icons/react';

const ITEMS = [
  { name: 'Linen Shirt',  meta: 'Beige · M', qty: '×1', price: '₸8,900' },
  { name: 'Canvas Tote',  meta: 'Black',     qty: '×1', price: '₸4,000' },
];

export default function MockKaspi() {
  return (
    <div className="mk-ks">
      <div className="mk-ks-left">
        <h3 className="mk-ks-title">Checkout</h3>
        <div className="mk-ks-card">
          <span className="mk-ks-label">Payment method</span>
          <div className="mk-ks-methods">
            <span className="mk-ks-method mk-ks-method--on"><DeviceMobile weight="bold" /> Kaspi</span>
            <span className="mk-ks-method"><CreditCard weight="bold" /> Card</span>
            <span className="mk-ks-method"><Money weight="bold" /> Cash</span>
          </div>

          <div className="mk-ks-confirm">
            <span className="mk-ks-confirm-ic"><DeviceMobile weight="bold" /></span>
            <span className="mk-ks-confirm-title">Confirm in your Kaspi app</span>
            <span className="mk-ks-confirm-sub">We sent a request for <b>₸12,900</b> to <b>+7 777 123 4567</b>. Open Kaspi.kz and approve it.</span>
            <span className="mk-ks-confirm-wait"><i className="mk-ks-spin" /> Waiting for confirmation…</span>
          </div>
        </div>
      </div>

      <div className="mk-ks-right">
        <div className="mk-ks-summary">
          <h4 className="mk-ks-sumtitle">Order summary</h4>
          {ITEMS.map((it) => (
            <div key={it.name} className="mk-ks-item">
              <span className="mk-ks-item-img" />
              <span className="mk-ks-item-info">
                <span className="mk-ks-item-name">{it.name}</span>
                <span className="mk-ks-item-meta">{it.meta} · {it.qty}</span>
              </span>
              <span className="mk-ks-item-price">{it.price}</span>
            </div>
          ))}
          <div className="mk-ks-totals">
            <div className="mk-ks-trow"><span>Subtotal</span><span>₸12,900</span></div>
            <div className="mk-ks-trow"><span>Shipping</span><span>Free</span></div>
            <div className="mk-ks-trow mk-ks-trow--total"><span>Total</span><span>₸12,900</span></div>
          </div>
          <span className="mk-ks-pay">Place order</span>
        </div>
      </div>
    </div>
  );
}
