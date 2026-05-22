# Getting Started

Welcome to **Torta CRM** — the console where you manage your stores, customers, orders, and the API that powers your storefront.

## The big picture

Torta is organized in three levels:

1. **Organization** — the top-level account. A company or brand.
2. **Project** — one store / branch inside an organization. Each project has its own products, orders, customers, and API keys.
3. **Console** — the set of pages for a single project (Products, Orders, Analytics, Authentication, and so on).

> One organization can hold many projects. For example a clothing brand with shops in different countries would be one organization with one project per country.

## First steps

1. Create an **organization** from the dashboard.
2. Inside it, create a **project** and give it your storefront URL.
3. Open the project — you'll land on the **Project Overview**.
4. Grab your **API keys** from the *Copy Keys* button (top of the overview) and connect your storefront with [torta-js](/docs/quickstart).

## Your three keys

Every project has three keys, each with a different job:

| Key | Where it lives | Use it for |
|-----|----------------|------------|
| **Public key** | in the request URL | identifies the store |
| **Publishable key** | `X-Publishable-Key` header (safe in the browser) | normal storefront calls (products, cart, login) |
| **Secret key** | server only — never in the browser | trusted server-to-server calls (e.g. pushing customers) |

The public + publishable keys are designed to live in your storefront's JavaScript. The **secret key must stay on your own server** — anyone who has it can write data into your CRM.

Next: [Organizations & Projects](/docs/organizations-projects) or jump straight to the [torta-js Quickstart](/docs/quickstart).
