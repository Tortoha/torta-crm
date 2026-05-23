# Integrations

**Project → Integrations** connects your store to outside tools. Two tabs: **Browse** (the marketplace) and **Logs** (delivery history).

## Browse

Search and filter by region. Connectors are grouped into **Popular, Accounting, Analytics and Marketing**, and each shows whether it's installed. There are three kinds, connected in different ways:

### Webhooks (Custom Webhook, Slack, Discord, Zapier)

Push events to your own endpoint or a chat in real time. You give it a destination URL, choose which **events** to send (orders, bookings, customers, payments, products — or subscribe to all), and can fire a **test** delivery. The **Custom Webhook** also gives you a **signing secret**.

> Verify every webhook came from Torta: check the `X-Torta-Signature: sha256=<hex>` header, which is an `HMAC-SHA256(body, secret)`. (Slack/Discord/Zapier don't use a signing secret.)

### API connectors (Google Analytics 4, Mixpanel, Mailchimp)

Connect with an identifier (Measurement ID / Project Token / Audience ID) plus an API key/secret, choose events, and test.

### Accounting exporters

A large set of country-specific exporters (QuickBooks, Xero, DATEV, 1С, Kompra, and many more). These are **export-only** — there's no live sync. You pick a **period**, optionally include unpaid orders, see a **live preview** (order count, revenue, sample rows), then either **download** the file in the right format or set an **email schedule** (daily / weekly / monthly) that mails a download link. The actual import (and any government e-invoice filing) happens inside the accounting software itself.

**Coming soon** — some connectors show as planned, with a **Notify me** button to register interest.

## Logs

A delivery log: time, event, connector, status, HTTP code and duration. Filter by status or event, click a row to expand the **request payload and response body**, and **Retry** failed deliveries.

This page is all server-to-server — it doesn't change anything a shopper sees on the storefront.
