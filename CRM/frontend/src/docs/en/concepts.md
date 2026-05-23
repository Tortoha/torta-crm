# Concepts

The few ideas that apply to every `torta-js` call. Read this once and the rest of the reference is self-explanatory.

## The three keys

| Key | Prefix | Where it lives | Secret? |
|-----|--------|----------------|---------|
| **Public key** | — (20 hex chars) | In the URL path (`/PUBLIC_KEY`) | No — safe in the browser |
| **Publishable key** | `pk_` | `X-Publishable-Key` header (the SDK adds it) | No — safe in the browser |
| **Secret key** | `sk_` | `X-Secret-Key` header, **server only** | **Yes — never ship to the browser** |

The public + publishable keys are what `createClient(url, pk)` uses. The publishable key is validated on every request, so copying the URL alone isn't enough to call the API.

The **secret key** unlocks server-to-server endpoints (currently `client.customers.save`). Pass it as the third argument and only ever from your own backend:

```js
const client = createClient(url, pk, { secretKey: 'sk_…' }); // SERVER ONLY
```

See [Pushing Customers](/docs/customers).

## The response shape

Every method resolves to the same object — it never throws on HTTP errors:

```js
const { ok, status, data, error } = await client.products.list();
```

| Field | Type | Meaning |
|-------|------|---------|
| `ok` | boolean | `true` on 2xx |
| `status` | number | HTTP status code (`0` if the request never left) |
| `data` | object \| array \| null | Parsed JSON body, or `null` |
| `error` | string \| null | Ready-to-display message on failure, `null` on success |

`error` is always a **plain string**, even when the backend returns a validation array or a nested `{ detail }` object — the SDK normalises it for you. So you can drop it straight into a toast:

```js
const r = await client.cart.add(productId, variationId, configId, 1);
if (!r.ok) return toast(r.error);
```

## Sessions & auto-refresh

Auth is cookie-based. After login the browser holds an httpOnly access token (15 min) and a refresh token (30 days). You don't manage tokens — when any request returns **401**, the SDK silently calls `/refresh` once and retries. Concurrent 401s share a single refresh so they don't race.

If the refresh also fails, the cached user is cleared and the original 401 is returned — that's your cue to redirect to login:

```js
const r = await client.orders.list();
if (r.status === 401) redirectToLogin();
```

## CSRF

State-changing requests (POST/PUT/PATCH/DELETE) use a double-submit cookie. The SDK fetches a `csrf_token` cookie automatically and echoes it as `X-CSRF-Token`. You don't do anything — just know that the very first write triggers a one-time `GET /csrf`.

## Server-side rendering

Because auth lives in a browser cookie, **logged-in calls must run in the browser** (components, `useEffect`, `onMount`). Public data (products, categories, config) can be fetched during SSR since `fetch` exists in Node 18+, but the user session won't be available there. The SDK guards `window`/`document` access, so importing it in a server bundle is safe — it just returns less tracking metadata.

## No raw fetch

Keep every API call inside the SDK. It centralises the keys, CSRF, refresh and error-normalisation in one place — raw `fetch()` calls in components re-implement all of that and drift out of sync.
