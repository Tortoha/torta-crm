# Payments

Decide how customers pay you. **Torta never touches the money** — it flows straight into *your* gateway account (Stripe, Kaspi, Halyk, TipTop Pay, Robokassa, PayPal), or you collect it yourself off-platform (Manual). That keeps you off the hook for PCI compliance and money-handling licences. Torta's job is to **verify, record and reconcile** every order.

## Methods work together

You don't choose a single provider — you **connect the gateways you want**, and the customer picks one at checkout (the same model as Shopify and WooCommerce). Stripe + Kaspi + Robokassa can all be live at once.

| Method | What it is | Currencies | The order lands as |
|---|---|---|---|
| **Stripe** | Global card payments, collected inline on your storefront | Most currencies | **Paid** — verified automatically |
| **ApiPay (Kaspi)** | Buyer enters their phone; the charge is pushed to their Kaspi app | **KZT only** | **Paid** — verified automatically |
| **ePay (Halyk)** · *Beta* | Card payment on Halyk Bank's hosted page | **KZT only** | **Paid** — verified automatically |
| **TipTop Pay** *(ex-CloudPayments)* · *Beta* | Card payment in a popup widget, buyer stays on your page | **KZT, RUB** | **Paid** — verified automatically |
| **Robokassa** | Card payment on Robokassa's hosted page | **KZT only** | **Paid** — verified automatically |
| **PayPal** | Redirect to PayPal; we capture the money on return | **Not KZT** (USD / EUR / …) | **Paid** — verified automatically |
| **Manual** | Cash / bank transfer / pay-on-delivery — you collect directly | Any | **Settled** (`manual`) |

> Every **online** gateway is re-verified server-to-server before the order counts as revenue. You never click "Mark as paid" for them — that's automatic.

## Connecting a gateway

Open **Organization → Payments**. Every gateway is a row. The steps are the same for all of them:

1. **Click the row** to open its panel.
2. **Paste the credentials.** Each panel has an **Open Console** link straight to the page in the provider's dashboard where the keys live.
3. Click **Save**.
4. Click **Test connection**. On success the badge flips to **Connected**.
5. Turn on the **Active** switch — the gateway now appears at checkout.

### The status badge

| Badge | Meaning |
|---|---|
| **Not connected** | No credentials saved yet. |
| **Configured · awaiting check** | Credentials saved, but **Test connection** has never succeeded. |
| **Connected** | Test connection passed. The **Active** switch is now available. |

Manual is an offline method, so it simply shows **Enabled** / **Off**.

### The two switches

- **Active** — whether the gateway is offered to buyers at checkout. It stays locked until the badge says *Connected*. Turning it off pauses the gateway; your keys stay saved.
- **Test mode** — applied when you press **Save**. In test mode no real money moves; use the provider's test cards. Switch it off when you're ready to take real payments.

### Beta gateways

**ePay (Halyk)** and **TipTop Pay** carry a **Beta** pill. They are fully built and unit-tested, but not yet verified end-to-end with real money — test them with a small real payment before relying on them. Each Beta panel has a **Report an issue** button that reaches us directly.

---

## Stripe

**Recommended: use Stripe Connect** — click **Connect with Stripe →** instead of pasting keys. It's safer and you can revoke Torta's access from your own Stripe dashboard at any time.

If you'd rather paste keys, open [Stripe → Developers → API keys](https://dashboard.stripe.com/apikeys):

| Field | Required | Looks like |
|---|---|---|
| Publishable key | ✅ | `pk_test_…` / `pk_live_…` |
| Secret key | ✅ | `sk_test_…` / `sk_live_…` |
| Webhook signing secret | optional | `whsec_…` |

At checkout the card is collected **inline** (Stripe Elements) and goes browser → Stripe directly; it never reaches Torta's servers. The order is created only after Stripe confirms the payment.

> **Test card:** `4242 4242 4242 4242`, any future expiry, any CVC. No real money moves in test mode.

## ApiPay (Kaspi) — KZT only

Kaspi payments run through **ApiPay**. The buyer types their phone number at checkout, ApiPay pushes the charge to their **Kaspi app**, they approve it there, and Torta confirms it server-side.

| Field | Required | Where to get it |
|---|---|---|
| ApiPay API Key | ✅ | [apipay.kz](https://apipay.kz) → **API Keys** (sent as the `X-API-Key` header) |
| Webhook Secret | optional | Given to you when you create the webhook (below) |

Two things to do in the ApiPay dashboard:

1. **Connect your Kaspi cashier** — *Settings → Kaspi Authorization*. Without this, charges can't reach Kaspi.
2. **Add the webhook** — Torta's panel shows a **Webhook URL · POST**. Copy it into *Settings → Connection → Webhooks*. Creating the webhook gives you a **Webhook Secret** — paste that back into Torta.

Amounts settle in **whole tenge**.

## ePay (Halyk) — Beta · KZT only

The buyer pays on **Halyk Bank's hosted page**, then returns to your store. Torta confirms the charge with a server-side status check.

| Field | Required |
|---|---|
| Client ID | ✅ |
| Client secret | ✅ |
| Terminal ID | ✅ |

Get them from your [Halyk ePay cabinet](https://epayment.kz).

## TipTop Pay (ex-CloudPayments) — Beta · KZT / RUB

The buyer pays in a **popup widget** and never leaves your page. Torta confirms the charge server-side.

| Field | Required |
|---|---|
| Public ID | ✅ |
| API secret | ✅ |

Get them from your cabinet at [merchant.tiptoppay.kz](https://merchant.tiptoppay.kz).

## Robokassa — KZT only

The buyer pays on **Robokassa's hosted page**. Torta verifies the result with an OpState status check.

| Field | Required | Note |
|---|---|---|
| Merchant login | ✅ | |
| Password #1 | ✅ | |
| Password #2 | ✅ | |
| Hash algorithm | optional | `md5` by default (`md5` / `sha256` / `sha512`) |

Get them from [partner.robokassa.kz](https://partner.robokassa.kz).

**Then paste Torta's URLs back into your Robokassa cabinet.** The panel prints them for you (with a store picker if your organization has several projects):

| URL | Purpose |
|---|---|
| **Result URL · POST** | **Required.** Robokassa POSTs the payment result here. |
| **Success URL** | Where the buyer returns after paying. |
| **Fail URL** | Where the buyer returns if payment fails. |
| **Homepage URL** | Your store's front page. |

> The Success / Fail links are built from your store's site URL. If they show up empty, set it first in **Authentication → URL configuration**.

## PayPal — not KZT

The buyer is redirected to PayPal to approve the payment; Torta then **captures and confirms it server-side** when they return.

| Field | Required |
|---|---|
| Client ID | ✅ |
| Client secret | ✅ |

Create an app in the [PayPal Developer dashboard](https://developer.paypal.com/dashboard/applications). Test mode uses your sandbox credentials.

> ⚠️ **PayPal cannot charge KZT.** Your store currency must be a PayPal currency (USD / EUR / …).
>
> Money moves **only** when Torta captures it. If a buyer approves and then abandons checkout, nothing is charged.

## Manual — cash / pay on delivery

No credentials, no API. Switch it on for cash, bank transfer, or pay-on-delivery. The order is recorded as **settled** (`manual`) — you collect the money directly and fulfil it. No card is charged online.

---

## Currency rules

Some gateways only settle in one currency. Torta **refuses to mischarge** rather than guessing.

| Gateway | Settles in |
|---|---|
| ApiPay (Kaspi) | KZT |
| ePay (Halyk) | KZT |
| Robokassa | KZT |
| TipTop Pay | KZT, RUB |
| Stripe | many currencies |
| PayPal | many currencies, **but not KZT** |

If a buyer picks a gateway that can't settle your store's currency, checkout quietly **falls back to Manual** rather than charging the wrong amount. If something calls the API directly with a mismatched pair, the order is **rejected outright**.

## What status an order gets

| Situation | Payment status |
|---|---|
| Online gateway connected, payment verified | **Paid** — counts as revenue immediately |
| Manual | **Settled** (`manual`) — you collected it yourself |
| An online method was picked but its gateway isn't connected | Recorded as `manual` — the sale isn't blocked, but nothing was verified |
| Legacy `other` orders (from before the gateway integrations) | **Pending** until you click **Mark as paid** in **Orders** |

## Refunds

Refunds are issued from a **Return**, once you've marked it *inspected*. In a multi-gateway store the refund automatically goes back through **the gateway that took the money**.

| Gateway | Refund |
|---|---|
| Stripe · ApiPay (Kaspi) · TipTop Pay · Robokassa · PayPal | Issued through the provider's API, straight from Torta |
| **ePay (Halyk)** | Not wired yet — refund it in your **Halyk merchant cabinet**, then record the reference in Torta |
| Manual | Record-only — you move the money yourself |

If the provider's API rejects the refund, Torta **does not** mark the return as refunded. You'll never have a return that says "refunded" while the money is still with you.

## Security in one line

Card details go **straight to the gateway** — they never reach our servers, so the PCI burden isn't yours, and the money lands in **your** account, not ours. Every online order is re-verified server-to-server before it counts as revenue. For exactly how that's enforced, see the [Payments API reference](/docs/payments-api).
