# Emails

**Project → Emails** is where you control every email your store sends — the automatic messages *and* one-off campaigns. The page is a row of tabs across the top: one tab per automatic email, plus a final **Broadcasts** tab.

## The tabs at a glance

The first tabs are **transactional templates** — emails your store sends on its own, triggered by something a customer did:

- **Verification** — the sign-up code (one-time password).
- **Password reset** — the reset link/code.
- **Order** — order confirmation after checkout.
- **Booking** — appointment reminder.
- **Abandoned cart** — a nudge when a cart is left behind.
- **Restock** — "back in stock" notice for waitlisted products.

The last tab, **Broadcasts**, is different: it's for messages *you* send on purpose — announcements, promos, newsletters.

## Editing a transactional template

Every transactional tab works the same way. You get one editor with a live preview underneath:

- **Subject** — the subject line. Supports variables too.
- **Insert variables** — click a chip (e.g. `{{customer_name}}`, `{{store_name}}`) to drop it into the HTML. Each one fills in per recipient when the email goes out.
- **HTML** — write the email body as HTML. Syntax is highlighted; you have full control of the layout.
- **Media** (the 🖼 button) — opens your **Media library**: upload images and PDFs, then copy a link to paste into the HTML (`<img src="…">` for a picture, a normal link for a PDF). The library is shared across all your emails and campaigns.
- **Live preview** — a Gmail-style preview updates as you type, with sample data filled in.
- **Send test** — email a copy to yourself before going live.
- **Reset to default** — restore the original Torta design for that email.

> Some templates require a specific variable. Verification, for example, must contain the `{{code}}` — the editor warns you and won't save until it's back. Changes **save automatically**.

## Broadcasts

The **Broadcasts** tab is a campaign manager. The list shows every campaign with columns for **Name, Subject, Schedule, Sent** (how many recipients it reached) and **Status**. You can search it, switch between **grid and list** views, and use the **⋯ menu** on each row to **edit, pause/resume or delete** a campaign.

**Statuses:** `draft` (not scheduled yet) → `scheduled` (waiting for its time) → `sending` → `sent`. A campaign you pause shows `paused`; one that hit an error shows `failed`.

### Creating a campaign

Click **New campaign** to open the editor. The top bar has **Back** and an editable **name**. Below it you choose *when and to whom* with a four-mode switch:

- **Individual** — send to a single email address (good for a quick test to a real person).
- **Everyone** — send to all your customers right now.
- **One-time** — pick a **date and time** to send once. Tick **Repeat every year** to make it annual (e.g. a Christmas promo that re-sends every year on that date).
- **Weekly** — pick one or more **days of the week** and a time; it repeats on those days.

Next to the schedule is **Exclude guests** — leave it on to skip guest-checkout customers and email only registered accounts. The rest of the editor (subject, variables, media, HTML, preview) is identical to the template editor above.

Press **Schedule** (or **Send to all** / **Send** depending on the mode) to commit. Until then your edits are kept as a draft automatically.

### How the timing works

- **One-time** sends fire at the moment you picked, in **your own local time**.
- **Weekly** sends use your **project's timezone** (set in [Booking](/docs/booking-page) → Settings) so they stay consistent for your customers.
- The scheduler checks about **once a minute**, so a send lands within a minute of the chosen time — not to the exact second.

### Who receives a broadcast

Everyone in your [customer](/docs/customers-page) list who has an email and hasn't unsubscribed — all at once when the campaign fires. Guests are skipped when **Exclude guests** is on. Every broadcast automatically includes an **unsubscribe link**, so customers can opt out (after which they're excluded from future sends).

> Broadcasts are a paid feature, and the number of emails you can send per day depends on your plan. A campaign that would exceed the daily limit stops cleanly rather than partially sending.

## Delivery

All mail is sent through Torta's own email service — no setup needed to start. To send from **your own domain** (which looks more professional and improves deliverability), verify it under [Authentication](/docs/authentication) → Email; that page walks you through the DNS records. Once verified, your **from-name and from-address** are used on every email this project sends.
