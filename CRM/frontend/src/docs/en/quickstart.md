# Quickstart

`torta-js` is the official JavaScript SDK for the storefront API. Every call your storefront makes goes through it — no raw `fetch()` needed.

## Install

```bash
npm install torta-js
```

No bundler? Load it straight from a CDN:

```js
import { createClient } from 'https://cdn.jsdelivr.net/npm/torta-js/+esm';
```

> Using React, Next.js, Vue, SvelteKit, Astro…? See [Frameworks](/docs/frameworks) for the exact per-framework setup.

## Create the client

You need two keys, both safe to ship to the browser — copy them from **Copy Keys** on the Project Overview:

- **Public key** — goes in the URL path. Identifies the store.
- **Publishable key** (`pk_…`) — sent as a header on every request.

```js
import { createClient } from 'torta-js';

const API_URL = "https://api.tortacrm.com/PUBLIC_KEY"; // public key in the path
const API_PK  = "pk_PUBLISHABLE_KEY";                 // publishable key

export const client = createClient(API_URL, API_PK);
```

There is also a third **secret key** (`sk_…`) for server-to-server use only — see [Pushing Customers](/docs/customers). Never put it in browser code.

## The response shape

Every method returns the same object, so you handle errors without `try/catch`:

```js
const r = await client.products.list();
if (!r.ok) showToast(r.error); // r.error is always a plain string
else       render(r.data);
```

`{ ok, status, data, error }` — `ok` is the boolean success flag, `status` the HTTP code, `data` the payload (or `null`), `error` a ready-to-display string (or `null` on success). Full details in [Concepts](/docs/concepts).

## Authentication

Email login and registration are a two-step flow: send a code, then verify it.

```js
// 1. Send a 6-digit code to the email
await client.auth.sendCode({ name, email, password, type: "register" }); // or type: "login"

// 2. Verify the code — sets the session cookie on success
const res = await client.auth.verifyCode(email, code);

// Who's logged in? (cached after the first call)
const { data: user } = { data: await client.auth.getUser() };
```

Full auth surface — phone OTP, OAuth, sessions, password reset — is in [Authentication](/docs/auth).

## Products & cart

```js
const products = await client.products.list();        // optionally { category: 'shoes' }
const one      = await client.products.get(productId);

// add(product_id, variation_id, configuration_id, quantity?, modifierItemIds?)
await client.cart.add(productId, variationId, configurationId, 1);
const cart = await client.cart.get();
```

## Bootstrap config

Read the store's currency, name and timezone once on startup so prices render correctly on first paint:

```js
const { data } = await client.config.get(); // { currency, name, timezone, … }
```

---

Next: pick your [Framework](/docs/frameworks), then dive into the [Reference](/docs/auth).
