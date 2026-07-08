# Payments

How checkout works over the API — and how it's secured.

A store can have **several gateways connected at once**. The customer picks one at checkout and sends it as `payment_method`. There are six **online** gateways (`stripe`, `apipay`, `halyk_epay`, `cloudpayments`, `robokassa`, `paypal`) — all of them require a server-verified payment before the order can be created — and one **offline** method (`manual`), which is recorded straight away.

The flow is always the same three steps:

```
config.get()  →  payments.initPayment(payload)  →  complete the payment  →  orders.place(payload + intent id)
```

## 1. Read the store's enabled methods

```js
const cfg = await client.config.get();
// cfg.data → {
//   currency, project_name, timezone,
//   payment_methods: [{ method, label, instructions, online }],
//   payment_provider, online_payment, payment_test_mode
// }
```

Render one checkout option per `payment_methods` entry.

- `online: true` → run the `initPayment` flow below.
- `online: false` → place the order directly and show `instructions` to the buyer.

> An online gateway that the merchant enabled but never connected is **omitted entirely** from `payment_methods`. If it's in the list, its credentials are live.

## 2. Start the payment

Call `initPayment` with the **same payload** you'd give `orders.place`, including the chosen `payment_method`. It requires a logged-in or guest session and is rate-limited to 15 calls/min.

```js
const init = await client.payments.initPayment(payload);
// optional: client.payments.initPayment(payload, { idempotencyKey })
```

### Response — always present

| Field | Notes |
|---|---|
| `provider` | The gateway that will actually be used — **not necessarily what you asked for** (see fallbacks) |
| `intent_id` | The id you must later pass as `payment_intent_id`. Empty for `manual` |
| `amount`, `currency` | Server-computed cart total. Never trust a client-side total |
| `needs_payment_intent` | `true` **only for Stripe** |
| `client_secret`, `redirect_url`, `publishable_key` | Populated per gateway, `""` otherwise |
| `is_test_mode` | Present for every online gateway |

### Response — gateway-specific block

| `provider` | Extra field | What it carries |
|---|---|---|
| `stripe` | `client_secret`, `publishable_key`, `needs_payment_intent: true` | Stripe PaymentIntent |
| `apipay` | `kaspi_poll: true` | Poll `payments.status(intent_id)` until paid |
| `halyk_epay` | `halyk_pay { auth, invoiceId, amount, currency, terminal, postLink, backLink, failureBackLink, description, language, paymentApiJs }` | Config for Halyk's hosted page |
| `cloudpayments` | `cloudpayments_widget { public_terminal_id, external_id, account_id, amount, currency, description, payment_schema, widget_js }` | Config for the TipTop Pay popup |
| `robokassa` | `redirect_url` + `robokassa_redirect { url, invoice_id }` | Signed hosted-page URL |
| `paypal` | `redirect_url` + `paypal_redirect { url, order_id }` | PayPal approve URL |
| `manual` | — | Nothing extra |

> ⚠️ **Branch on `provider`, not on `needs_payment_intent`.** That flag is `true` for Stripe only — every other online gateway completes through a redirect, a widget, or a poll.

### Graceful fallbacks

`initPayment` never blocks a sale. It returns `provider: "manual"` plus a `warning` string when:

- the requested gateway **isn't connected** → `"Card payments not connected; falling back to manual"`
- the gateway **can't settle your store currency** → `"<gateway> settles only in KZT; falling back to manual."`

Treat that response as an offline order.

## 3. Complete the payment

### Stripe — inline card, no redirect

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

Card data goes **browser → Stripe directly** — it never touches our backend.

### ApiPay (Kaspi) — phone + async push, then poll

The buyer must supply `payload.phone` (a Kaspi number) — `initPayment` returns **400** without it. ApiPay pushes the charge to their Kaspi app; you poll until they approve it.

```js
const intentId = init.data.intent_id;         // init.data.kaspi_poll === true

const timer = setInterval(async () => {
  const res = await client.payments.status(intentId);
  // res.data → { status, paid, account_name }

  if (res.data.paid) {
    clearInterval(timer);
    await client.orders.place({ ...payload, payment_intent_id: intentId });
  }
  if (["expired", "canceled", "error"].includes(res.data.status)) {
    clearInterval(timer);   // buyer declined or the invoice lapsed
  }
}, 3000);                    // give up after ~3 minutes
```

The status is always re-fetched from ApiPay server-side — it is never taken from the client.

### TipTop Pay — popup widget, no redirect

```js
const cfg = init.data.cloudpayments_widget;
await loadScript(cfg.widget_js);              // https://widget.tiptoppay.kz/bundles/widget.js

const widget = new window.tiptop.Widget();
widget.oncomplete = async (result) => {
  if (result.type === "payment" && result.status === "success") {
    await client.orders.place({
      ...payload,
      payment_intent_id: String(result.data.transactionId),
    });
  }
};
widget.start({
  publicTerminalId: cfg.public_terminal_id,
  amount:           cfg.amount,
  currency:         cfg.currency,
  paymentSchema:    cfg.payment_schema,
  description:      cfg.description,
  externalId:       cfg.external_id,
  receiptEmail:     cfg.account_id,
});
```

Note the intent id here is the **TipTop `transactionId`**, not `init.data.intent_id`.

### ePay (Halyk) — hosted page redirect

```js
const cfg = init.data.halyk_pay;
await loadScript(cfg.paymentApiJs);           // Halyk's payment-api.js

stashPending({ payload, intentId: init.data.intent_id });   // see below

window.halyk.pay({
  invoiceId:  cfg.invoiceId,
  backLink:   cfg.backLink,                   // …/checkout/return?status=success
  failureBackLink: cfg.failureBackLink,       // …/checkout/return?status=failure
  postLink:   cfg.postLink,
  failurePostLink: cfg.postLink,
  language:   cfg.language,
  description: cfg.description,
  accountId:  cfg.invoiceId,
  terminal:   cfg.terminal,
  amount:     cfg.amount,
  currency:   cfg.currency,
  auth:       cfg.auth,
});
```

### Robokassa & PayPal — plain redirect

```js
stashPending({ payload, intentId: init.data.intent_id });
window.location.href = init.data.redirect_url;
```

### Manual

```js
await client.orders.place(payload);   // payload.payment_method = "manual"
```

### Coming back from a redirect

Halyk, Robokassa and PayPal send the buyer back to `…/checkout/return?status=success|failure`. Because the browser left your app, **stash the payload and intent id before you redirect** (e.g. in `sessionStorage`) and finish the order on return:

```js
// before redirecting
const stashPending = (v) => sessionStorage.setItem("checkout_pending", JSON.stringify(v));

// on /checkout/return
const { payload, intentId } = JSON.parse(sessionStorage.getItem("checkout_pending"));
if (new URLSearchParams(location.search).get("status") === "success") {
  await client.orders.place({ ...payload, payment_intent_id: intentId });
}
```

## 4. Place the order

```js
await client.orders.place({ ...payload, payment_intent_id: intentId });
// → { success: true, order_id }
```

`payment_method` accepts aliases: `card` → `stripe`, `cash` / `cod` → `manual`.

The resulting payment status:

| Method | Status |
|---|---|
| Any online gateway, verified | `paid` — counts as revenue immediately |
| `manual` | `manual` — settled offline |
| An online method whose gateway isn't connected | Silently downgraded to `manual` (recorded, **not** verified) |
| `other` *(legacy)* | `pending` — merchant confirms via "Mark as paid" |

> Because a broken gateway downgrades to `manual`, never assume `payment_method: "stripe"` in your request means a card was actually charged. Check `provider` in the `initPayment` response.

## 5. Poll an async payment

```js
const res = await client.payments.status(intentId);
// res.data → { status, paid, account_name }
```

Only meaningful for **ApiPay (Kaspi)**. Any other provider returns `{ status: "manual", paid: false }`.

## 6. Currency rules

| Gateway | Settles in |
|---|---|
| `apipay`, `halyk_epay`, `robokassa` | `KZT` |
| `cloudpayments` | `KZT`, `RUB` |
| `stripe` | many |
| `paypal` | many — **never `KZT`** (PayPal rejects it) |

Enforced twice. `initPayment` degrades to `manual` with a `warning`. `orders.place` — the authoritative money decision, since a client can call it directly — rejects with **400**:

> `apipay settles only in KZT; store currency is USD — cannot verify this payment safely. Use a matching-currency gateway.`

## 7. How it's secured

For every online method, `POST /orders` re-fetches the payment **server-to-server** and refuses to create a paid order unless the provider itself reports a terminal success:

| Gateway | Required status |
|---|---|
| `stripe` | `succeeded` |
| `apipay` | `paid` |
| `halyk_epay` | `paid` |
| `cloudpayments` | `paid` |
| `robokassa` | `paid` |
| `paypal` | `COMPLETED` — an `APPROVED` order is **not** enough |

On top of that:

- **Amount check.** The cart total is recomputed server-side from the live cart and compared against what the provider says it charged (0.02 tolerance; Kaspi is compared in whole tenge). A mismatch is a **409**.
- **Replay guard.** One intent → one order. Re-using an `payment_intent_id` is a **409**.
- **Method validation.** The chosen `payment_method` is checked against the store's *enabled* methods — you cannot skip a required card by sending `manual`.
- **Credentials never leave the server.** Only the Stripe `publishable_key` (safe by design) and Halyk's single-invoice scoped `auth` token are ever returned to the browser.

So: you **cannot** create a `paid` order without a real, provider-confirmed payment of the right amount.

## 8. Errors you'll actually hit

| Status | Where | Meaning |
|---|---|---|
| `401` | `initPayment` | No session — `"Login required to place an order"` |
| `429` | both | Rate limit (15/min init, 12/min place) |
| `400` | `initPayment` | `"Kaspi phone number is required"` |
| `400` | `initPayment` | Gateway rejected the create call (`"PayPal payment error: …"`) |
| `400` | both | `"Selected payment method is not available."` |
| `400` | `orders.place` | Currency / gateway mismatch |
| `402` | `orders.place` | `"Payment intent required for card payment. Call POST /orders/init-payment first."` |
| `402` | `orders.place` | `"Payment not completed (provider status: …)"` |
| `409` | `orders.place` | `"Intent … already used for order #…"` |
| `409` | `orders.place` | `"Cart total changed since payment…"` — re-run `initPayment` |

## 9. One caveat worth designing around

For **Kaspi, Halyk, TipTop Pay and Robokassa** the money is captured **at the gateway** before `orders.place` runs. If the buyer closes the tab at that moment, the payment exists but the order does not — the gateway's webhook can only *update* an existing order, never create one.

So: stash the payload and intent id before leaving the page, and complete `orders.place` on return (or on the next visit). The reference storefront does exactly this via `sessionStorage`.

**PayPal is the exception:** the capture happens on our server *during* `orders.place`, so an approved-but-abandoned checkout charges nothing at all.

## The three keys

Torta uses a three-key model. Use the right key for the right context:

| Key | Where | Header | Used for |
|---|---|---|---|
| **Public key** | URL path | — | Identifies the store. Safe to expose. |
| **Publishable key** | Browser | `X-Publishable-Key` | Storefront calls (cart, checkout, orders). Validated on every request. |
| **Secret key** | **Server only** | `X-Secret-Key` | Trusted server-to-server writes (e.g. [pushing customers](/docs/customers)). **Never ship it to the browser.** |

Checkout runs in the browser, so it uses the **publishable** key — requiring a secret there would mean leaking it to every visitor, which is exactly what the publishable key exists to prevent. The publishable key only *identifies* the store: it can't move money (only a server-verified payment can), and any offline order it creates is non-paid and merchant-confirmed.

See also: [Cart & Orders](/docs/cart-orders) · [Payments setup](/docs/payments) · [Pushing Customers](/docs/customers).
