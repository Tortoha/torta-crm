# Orders

**Project → Orders** is where you process what customers buy. It has two tabs: **Orders** and **Returns**. The Returns tab carries a live "action needed" badge so you always know what's waiting on you.

## Orders tab

A live list — new orders stream in automatically (no refresh) and it scrolls infinitely.

- **Find orders** — search by customer name or email; sort by date, amount or name; filter by status with the pills (All, New, Confirmed, Shipped, Delivered, Cancelled, Refunded). The **New** pill shows a count.
- **Two views** — table or cards.
- **Change status** — every order has an inline status dropdown. Statuses are `new → confirmed → shipped → delivered`, with `cancelled` and `refunded` as off-ramps; you can move an order to any status.
- **Print shipping labels** — the printer icon appears on **new / confirmed** orders. Select several with the checkboxes to print labels in bulk.
- **Order details** — click an order for the full picture: customer (name, email, phone), delivery method and address, payment method, comment, line items (with variation / size / quantity) and total. You can change status from here too.

## Returns tab

Customers can request a return within **14 days** of delivery. Each return moves through five stages, and the list groups them by what *you* need to do:

| Group | Stages | Your move |
|-------|--------|-----------|
| **Action needed** | requested, received | approve/reject, or mark received |
| **In progress** | approved, inspected | inspect items, record refund |
| **Completed** | refunded | done |
| **Closed** | rejected, cancelled | — |

Opening a return shows a stepper, and the action button changes with the stage:

1. **Requested** → **Approve** or **Reject** (a reason is required to reject).
2. **Approved** → **Mark received** when the parcel arrives.
3. **Received** → **Inspect** each item: set its condition (resellable / damaged / unrecoverable). Mark an item resellable and pick a **warehouse + batch** to put it back into stock.
4. **Inspected** → **Record refund**: the amount (capped at what the customer paid), an optional restocking fee, method and reference.

> Important: recording a refund here is just a **record** — the actual money is refunded in your **payment provider's dashboard** (the screen links you there). And stock only comes back when you mark an item resellable and choose where it goes.

## From the storefront

Orders, cancellations and return requests are created by customers through the SDK — see [Cart & Orders](/docs/cart-orders).
