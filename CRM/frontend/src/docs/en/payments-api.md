# Payments

How checkout works over the API — and how it's secured.

A store can have **several payment methods enabled at once** (Stripe, Manual, Other). The customer picks one at checkout and sends it as `payment_method`. Online methods (card) need a server-verified payment before the order can be created; offline methods are recorded and confirmed by the merchant later.

## The flow

Always start with `initPayment`, passing the **same payload** you'd give `orders.place` (including the chosen `payment_method`):

```js
const init = await client.payments.initPayment(payload);
// init.data → { provider, needs_payment_intent, client_secret,
//               publishable_key, amount, currency, is_test_mode }
```

Then branch on `needs_payment_intent`.

### Card (Stripe) — `needs_payment_intent: true`

The backend created a real Stripe PaymentIntent. Collect the card with Stripe.js, then place the order with the confirmed intent id:

```js
import { loadStripe } from "@stripe/stripe-js";

const stripe   = await loadStripe(init.data.publishable_key);
const elements = stripe.elements({ clientSecret: init.data.client_secret });
// mount a <PaymentElement> … then, on submit:
const { paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });

if (paymentIntent?.status === "succeeded") {
  await client.orders.place({ ...payload, payment_intent_id: paymentIntent.id });
}
```

The card data goes **browser → Stripe directly** — it never touches our backend. The order is created as **`paid`**.

### Offline (Manual / Other) — `needs_payment_intent: false`

No online payment. Just place the order:

```js
await client.orders.place(payload);   // payload.payment_method = "manual" | "other"
```

It's recorded immediately, with a status that reflects the method:

- **`manual`** (cash / pay-on-delivery) → recorded as settled.
- **`other`** (external gateway) → recorded as **`pending`**: present in the CRM but **not** counted as paid revenue until the merchant confirms it ("Mark as paid" on the Orders page).

## Reading the storefront config

`client.config.get()` returns the methods a store has enabled, so your checkout can render the right picker:

```js
const cfg = await client.config.get();
// cfg.data.payment_methods → [{ method, label, instructions, online }]
```

Render one option per entry. For `online: true` (Stripe) run the `initPayment` → card flow; otherwise place the order directly and show `instructions` (e.g. the Kaspi details) to the buyer.

## How it's secured

For an online method, `POST /orders` re-fetches the PaymentIntent **server-to-server** and refuses the order unless the provider reports it paid (Stripe → `succeeded`). It also rejects a re-used intent id (one intent → one order). And the chosen `payment_method` is validated against the store's **enabled** methods. So:

- You **cannot** create a *paid* order without a real, provider-confirmed payment.
- You **cannot** skip a required card by sending `payment_method: "manual"` — if the store only enabled card, the server forces the card path; an invalid choice is rejected.
- `other` orders are always created **pending**, for the merchant to confirm.

## The three keys

Torta uses a three-key model. Use the right key for the right context:

| Key | Where | Header | Used for |
|---|---|---|---|
| **Public key** | URL path | — | Identifies the store. Safe to expose. |
| **Publishable key** | Browser | `X-Publishable-Key` | Storefront calls (cart, checkout, orders). Validated on every request. |
| **Secret key** | **Server only** | `X-Secret-Key` | Trusted server-to-server writes (e.g. [pushing customers](/docs/customers)). **Never ship it to the browser.** |

Checkout runs in the browser, so it uses the **publishable** key — requiring a secret there would mean leaking it to every visitor, which is exactly what the publishable key exists to prevent. The publishable key only *identifies* the store: it can't move money (only a server-verified PaymentIntent can), and any offline order it creates is non-paid and merchant-confirmed.

See also: [Cart & Orders](/docs/cart-orders) · [Pushing Customers](/docs/customers).
