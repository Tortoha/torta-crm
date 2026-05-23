# Booking

**Project → Booking** runs appointments for businesses that sell time — salons, clinics, studios. It has four tabs: **Bookings, Services, Staff, Settings.**

## Bookings

Your schedule, in three views: **List, Cards, or Calendar** (a weekly grid). On the calendar you can **drag a booking to reschedule it**, and click an empty slot to create one there; past and off-hours slots are blocked.

- Search by customer or service; sort by date or customer; filter by status.
- **Statuses:** pending, confirmed, completed, cancelled, no-show. Bookings whose end-time has passed are flipped to **no-show automatically**.
- **Bulk actions** — multi-select to set status or delete several at once.
- **Create a booking** — pick the service, staff and customer details and a start time. The time picker only offers slots that fit your working hours and slot interval.
- **Details** — when, service, staff, customer (phone/email/address with a map link, notes), with a status changer.

## Services

What customers can book. Each service has a name, description, image, **duration**, **price**, a visibility toggle, a **"requires staff"** toggle (a person must be assigned vs a group/shared booking with **capacity**), and a location type (at shop / at customer / either), plus its linked staff.

> A service is also a product of type *service*, so it shows up in [Products](/docs/products) too — the two are unified.

## Staff

Your team. Each member has a photo, bio, **commission %**, the services they provide, and a **weekly working-hours editor** (open/close per day). Each card also shows live, period-based metrics: revenue earned, bookings, hours worked and average ticket.

## Settings

- **Stats** — totals, week-over-week, average ticket, no-show rate (warns above 15%), top staff.
- **Working hours** — your opening hours per day. These (plus the slot interval) define which times customers can book. Saved automatically.
- **Booking rules** — slot interval, minimum advance notice, how far ahead bookings are allowed, cancellation window, **timezone** (anchors customer-facing slot times), and **auto-confirm** (new bookings skip "pending").

## From the storefront

Customers browse services and book slots via the SDK — see [Booking](/docs/booking) (`client.booking`). The live availability check happens there; this admin page lets you book any valid time manually.
