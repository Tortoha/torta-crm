# Payments

Connect a payment provider so customers can pay during checkout. **Torta never touches the money** — payments flow straight to *your* provider account, which keeps you off the hook for PCI compliance and money-handling licences.

There are three options, and they're deliberately simple:

| Option | What it does | Where the money goes |
|---|---|---|
| **Stripe** | Real online card payments, collected on your storefront | Straight to your Stripe account |
| **Manual** | Record-only — cash, bank transfer, pay-on-delivery | You collect it yourself, off-platform |
| **Other** | Record-only — any gateway we don't integrate (Kaspi, your own link, …) | You collect it yourself; record the reference |

## Why only Stripe?

We integrate **one** card processor deeply rather than a dozen shallowly. Every gateway (PayPal, Adyen, Mollie, …) has its own checkout mechanics — a redirect here, a hosted widget there, a catalog requirement somewhere else. Half-finished integrations are worse than none: they *look* supported but break in subtle ways.

Stripe is the cleanest, most API-native card processor — it hands the backend a payment intent and lets you render the card form however you like. So Stripe gets the full inline treatment, and **everything else goes through Manual / Other**, where you use any provider you want and simply record the payment. One integration done right, plus a universal fallback.

## Connect Stripe

1. Create a free [Stripe account](https://stripe.com). No card or company is needed to start in **test mode**.
2. In Stripe → **Developers → API keys**, copy your **Publishable key** (`pk_test_…`) and **Secret key** (`sk_test_…`).
3. In Torta open **Organization → Payments → Stripe**, paste both keys, and click **Save**.
4. Click **Test** — Torta pings Stripe to confirm the keys work. On success the row shows **Connected**.

Once connected, your storefront checkout collects the card inline (Stripe Elements) and the order is created **only after Stripe confirms the payment**. Switch to live keys (`pk_live_…` / `sk_live_…`) when you're ready to take real money.

> **Test card:** `4242 4242 4242 4242`, any future expiry, any CVC. No real money moves in test mode.

## Manual & Other

Pick **Manual** for cash / bank transfer / pay-on-delivery, or **Other** for any gateway we don't integrate. The order is recorded with a **`manual` payment status** — it is *not* marked paid. You collect the money your own way and confirm it before fulfilling. Refunds in these modes are record-only (you process the actual money externally).

## Security in one line

Your customer's card is handled **directly by Stripe** — it never reaches our servers, so the PCI burden isn't yours. The money lands in **your** account, not ours. For exactly how this is enforced at the API level, see the [Payments API reference](/docs/payments-api).
