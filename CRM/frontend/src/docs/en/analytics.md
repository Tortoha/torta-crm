# Analytics

**Project → Analytics** is one long, read-only report that stacks many independent sections — revenue, orders, customers, products, returns, bookings, reviews, traffic and more. Each section loads on its own as you scroll, so a slow query never blocks the rest of the page, and most update live within seconds when a new order arrives.

## Choosing a period

Most sections have their own period dropdown: **1 day, 3 days, 1 week, 2 weeks, 1 month, 2 months, Season, Half-year, 1 year, 2 years, or Custom** (a date-range picker). Because each section's period is independent, you can compare a metric over a year while looking at today's funnel right below it. A few snapshot sections (cohort retention, inventory health, the goals widget) have no period — they're always current.

## The headline sections

- **Overview KPIs** — Revenue, Orders, Average order value, Conversion %, Visitors, Customers, each with a period-over-period change (up/down). Exportable to CSV.
- **Revenue over time** — the flagship chart. Pan it by dragging, switch Day/Week/Month granularity, **Ctrl/Cmd + scroll to zoom**, and overlay a second period with **Compare with**. Older history lazy-loads as you pan back. At Day granularity, **click a day** to drill into that day's individual orders. Export to CSV.
- **Sales funnel** — Visits → Product views → Added to cart → Paid orders, with the drop-off at each step.
- **Margin analysis** — an expandable Product → Variation → SKU tree of units, revenue, cost, profit and margin (thin margins flagged), with totals and CSV export.

## Customers, products & quality

- **Popular products** — top by revenue, top by units, most favorited, and slow movers (nothing sold).
- **Customers** — new vs returning over time, your top customers, and top cities.
- **Cohort retention** — a month-by-month grid of how many customers from each signup month keep buying.
- **Returns analysis** — return rate, processing time, top reasons, and the products returned most.
- **Reviews quality** — average rating, star distribution, best-rated products, and ones needing attention.

## Traffic, bookings & operations

- **Traffic sources / Devices / Countries** — where visitors come from (direct, organic, social, referral, UTM campaigns), what they browse on, and from which countries. Powered by the storefront's [tracking](/docs/tracking) calls.
- **Search insights** — top queries and, importantly, **zero-result searches** (gaps in your catalog).
- **Bookings** — totals, no-show and cancellation rates, revenue by service and by staff.
- **Digital products**, **Promo codes**, **Heatmap** (orders by day-of-week × hour), **Inventory health**, **Operations** (median order→shipped→delivered times, cart abandonment).
- **Goals widget** — a preview of your active [Targets](/docs/targets).

> Everything is shown in your project's currency, and sections below the fold only load when you scroll to them — so the report fills in progressively.
