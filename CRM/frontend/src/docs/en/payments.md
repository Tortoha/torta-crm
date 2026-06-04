# Payments

Decide how customers pay you. **Torta never touches the money** — it flows straight to *your* Stripe account, or you collect it yourself off-platform (Manual / Other). That keeps you off the hook for PCI compliance and money-handling licences. Torta's job is to **record and track** every order.

## Methods work together

You don't choose a single provider — you **switch on the methods you want**, and the customer picks one at checkout (the same model as Shopify and WooCommerce).

| Method | What it is | The order lands as |
|---|---|---|
| **Stripe** | Real online card payments, collected on your storefront | **Paid** — verified automatically |
| **Manual** | Cash / bank transfer / pay-on-delivery — you collect directly | **Settled** (`manual`) |
| **Other** | Any gateway we don't integrate (Kaspi, your bank, your own link) | **Pending** — you confirm it after the money arrives |

Open **Organization → Payments**. Each row shows a status badge (Connected / Enabled / Off). **Click a row to configure it**, then switch it on. Several methods can be on at the same time.

## Stripe — full automation

The only hands-off method: the card is charged and the order is marked **paid** with no work from you.

1. Create a free [Stripe account](https://stripe.com). No card or company is needed to start in **test mode**.
2. In Stripe → **Developers → API keys**, copy your **Publishable key** (`pk_test_…`) and **Secret key** (`sk_test_…`).
3. In Torta open **Organization → Payments → Stripe**, paste both keys, click **Save**, then **Test**. On success the row shows **Connected** and card payments turn on automatically.

At checkout the card is collected inline (Stripe Elements) and the order is created **only after Stripe confirms the payment** — so it lands as **paid** and counts as revenue immediately. Switch to live keys (`pk_live_…` / `sk_live_…`) when you're ready to take real money.

> **Test card:** `4242 4242 4242 4242`, any future expiry, any CVC. No real money moves in test mode.

## Manual — cash / pay on delivery

Switch on **Manual** for cash, bank transfer, or pay-on-delivery. The order is recorded as **settled** (`manual`): you collect the money directly (e.g. cash from the courier) and fulfil it. No card is charged online.

## Other — any gateway, your way

This is the flexible one. Use **Other** for any method we don't integrate — **Kaspi**, your bank's payment page, a PayPal link, anything.

1. Click the **Other** row. Give it a **display name** the customer sees (e.g. "Kaspi") and **payment instructions** (e.g. *"Send the total to Kaspi +7 700 123 4567 and reply with the receipt."*). Switch it on.
2. At checkout the customer picks it and sees your instructions, then sees them again on the order-confirmation screen.
3. The order lands as **Pending** — recorded in your CRM, but **not counted as revenue yet**, because Torta can't verify an external payment.

### Getting paid and confirming it

Because Torta can't see your external gateway, **you** confirm the payment:

1. The customer pays you (Kaspi / bank / etc.).
2. Open the order in **Orders** and click **Mark as paid**.
3. The order flips to **Paid** and now counts as revenue.

That's the whole loop: the order reaches the CRM the moment it's placed; you mark it paid once the money is in. (Card orders skip this — they're confirmed automatically.)

## Security in one line

A customer's card is handled **directly by Stripe** — it never reaches our servers, so the PCI burden isn't yours, and the money lands in **your** account, not ours. For exactly how this is enforced at the API level, see the [Payments API reference](/docs/payments-api).
