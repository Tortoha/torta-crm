# torta-js Quickstart

`torta-js` is the official JavaScript SDK for the storefront API. All your storefront's API calls go through it — no raw `fetch()` needed.

## Install

```bash
npm install torta-js
```

Or load it from a CDN (plain HTML, no bundler):

```js
import { createClient } from 'https://cdn.jsdelivr.net/npm/torta-js/+esm';
```

## Create the client

Use the **public key** (in the URL) and the **publishable key** (header). Both are safe to ship to the browser. You'll find them under *Copy Keys* on the Project Overview.

```js
import { createClient } from 'torta-js';

const API_URL = "https://api.example.com/PUBLIC_KEY"; // public key in the path
const API_PK  = "pk_PUBLISHABLE_KEY";                 // publishable key

export const client = createClient(API_URL, API_PK);
```

## Authentication

Registration and login are a two-step flow: send a code, then verify it.

```js
// 1. Send a 6-digit code to the email
await client.auth.sendCode({ name, email, password, type: "register" }); // or type: "login"

// 2. Verify the code — sets the session cookie on success
const res = await client.auth.verifyCode(email, code);

// Who's logged in?
const { data } = await client.auth.getUser();
```

You can collect extra profile fields at registration — they're all optional:

```js
await client.auth.sendCode({
  name, email, password,
  surname, address, birthdate,   // extra fields
  type: "register",
});
```

## Products & cart

```js
const products = await client.products.list();
const one      = await client.products.get(id);

await client.cart.add({ /* ... */ });
const cart = await client.cart.get();
```

Every method returns `{ ok, status, data, error }`, so you can handle failures without try/catch:

```js
const r = await client.products.list();
if (!r.ok) showToast(r.error);
else render(r.data);
```

Next: [Pushing Customers](/docs/customers) — for stores that run their own authentication.
