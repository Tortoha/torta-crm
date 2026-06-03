# Payments

How checkout works over the API — and how it's secured.

Payments run in **strict mode**: when the store has a real provider connected, an order **cannot** be created without a payment the server has verified. The store's *provider* (set in the CRM) decides this — never a field in the request — so a client can't downgrade itself to "manual" to skip paying.

## The flow

Always start with `initPayment`, passing the **same payload** you'd give `orders.place`:

```js
const init = await client.payments.initPayment(payload);
// init.data → { provider, needs_payment_intent, client_secret,
//               publishable_key, amount, currency, is_test_mode }
```

Then branch on `needs_payment_intent`.

### Stripe — `needs_payment_intent: true`

The backend created a real Stripe PaymentIntent. Collect the card with Stripe.js, then place the order with the confirmed intent id:

```js
import { loadStripe } from "@stripe/stripe-js";

const stripe   = await loadStripe(init.data.publishable_key);
const elements = stripe.elements({ clientSecret: init.data.client_secret });
// mount a <PaymentElement> … then, on submit:
const { paymentIntent } = await stripe.confirmPayment({
  elements,
  redirect: "if_required",
});

if (paymentIntent?.status === "succeeded") {
  await client.orders.place({ ...payload, payment_intent_id: paymentIntent.id });
}
```

The card data goes **browser → Stripe directly** — it never touches our backend.

### Manual / Other — `needs_payment_intent: false`

No online payment. Just place the order; it is recorded with `payment_status: "manual"` (pending — *not* paid). The merchant confirms the money offline.

```js
await client.orders.place(payload);
```

## How payment is verified

For a connected provider, `POST /orders` re-fetches the PaymentIntent **server-to-server** and refuses the order unless the provider reports it as paid (Stripe → `succeeded`). It also rejects a re-used intent id (one intent → one order). So:

- You **cannot** create a *paid* order without a real, provider-confirmed payment.
- You **cannot** skip payment by sending `payment_method: "manual"` — the store's configured provider wins.
- Manual orders are always **pending**, for the merchant to confirm.

## The three keys

Torta uses a three-key model. Use the right key for the right context:

| Key | Where | Header | Used for |
|---|---|---|---|
| **Public key** | URL path | — | Identifies the store. Safe to expose. |
| **Publishable key** | Browser | `X-Publishable-Key` | Storefront calls (cart, checkout, orders). Validated on every request. |
| **Secret key** | **Server only** | `X-Secret-Key` | Trusted server-to-server writes (e.g. [pushing customers](/docs/customers)). **Never ship it to the browser.** |

Checkout runs in the browser, so it uses the **publishable** key — requiring a secret there would mean leaking it to every visitor, which is exactly what the publishable key exists to prevent. The publishable key only *identifies* the store: it can't move money (only a server-verified PaymentIntent can), and any Manual order it creates is non-paid and merchant-confirmed.

Anything sensitive that should **not** run from a browser — bulk customer imports, server-side order injection — lives behind the **secret** key (`X-Secret-Key`), so a leaked publishable key can never reach it.

See also: [Cart & Orders](/docs/cart-orders) · [Pushing Customers](/docs/customers).
