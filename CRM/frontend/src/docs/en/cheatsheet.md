# API Cheatsheet

One page with **every storefront connection** — what each is for and how it works — so you don't have to hop between reference pages. Everything hangs off a single `client` object from [`torta-js`](/docs/quickstart), and every method returns the same `{ ok, status, data, error }`.

## Why this exists

Every call your storefront makes goes through this one SDK client. It keeps the keys, session refresh, CSRF and error-handling in **one place**, so your components just call `client.something()` and never touch raw `fetch()`. Create the client once in a shared module and import it everywhere:

```js
import { createClient } from 'torta-js';
export const client = createClient("https://api.tortacrm.com/PUBLIC_KEY", "pk_PUBLISHABLE_KEY");
```

## How every call works

Four rules cover the whole API — learn them once (full detail in [Concepts](/docs/concepts)):

- **Same response shape.** Every method resolves to `{ ok, status, data, error }` and never throws on an HTTP error. Check `ok`, show `error` (always a plain string), use `data`.
- **Two browser keys.** The **public key** sits in the URL path (identifies the store); the **publishable key** (`pk_…`) is sent as a header on every request. Both are safe to ship to the browser.
- **Sessions refresh themselves.** Login sets an httpOnly cookie. On a `401` the SDK silently refreshes once and retries — you never manage tokens.
- **Tracking is fire-and-forget.** `client.track.*` returns nothing to await and never throws, so analytics can't break the shopping flow.

> One method runs **server-side only** — `client.customers.save`, which needs the **secret key** (`sk_…`). Never ship that key to the browser. See [Pushing Customers](/docs/customers).

## Every connection at a glance

### Store bootstrap — read-only, no login
| Call | What it does |
|---|---|
| `client.config.get()` | Store currency, name, timezone, enabled payment methods. Call once on startup. |
| `client.categories.list()` | All categories (`id, name, slug, products_count`). |
| `client.products.list(opts?)` | Products; filter by `{ category }` or `{ uncategorized }`. |
| `client.products.get(hash)` | One product with variations, sizes, images, modifier groups. |

→ Full guide: [Catalog](/docs/catalog)

### Auth & sessions — `client.auth`
| Call | What it does |
|---|---|
| `getUser(force?)` · `user` · `invalidateUser()` | Current user (cached); sync cached value; drop the cache. |
| `sendCode({ name, email, password, type })` | Email OTP step 1 — `type` is `"register"` or `"login"`. |
| `verifyCode(email, code)` | Step 2 — sets the session cookie. |
| `resendCode(email)` | Resend the email code. |
| `sendPhoneCode(phone, name?)` · `verifyPhoneCode(phone, code)` | SMS OTP (when the merchant enabled it). |
| `googleLogin()` · `oauthLogin(provider)` | OAuth full-page redirect login. |
| `forgotPassword(email)` | Email a password-reset link. |
| `validateResetToken(token)` · `resetPassword(token, pw, repeat)` | Complete a reset. |
| `logout()` · `logoutAll()` | End this session / every session. |
| `listSessions()` · `revokeSession(id)` | List signed-in devices / revoke one. |
| `methods()` | Which contact methods the store accepts (`{ email, phone }`). |

→ Full guide: [Authentication](/docs/auth)

### Cart & checkout
| Call | What it does |
|---|---|
| `client.cart.get()` | Current cart with per-line prices, modifiers and subtotal. |
| `client.cart.add(productId, variationId, configId, qty?, modifierIds?)` | Add a line. |
| `client.cart.update(itemId, qty, modifierIds?)` · `client.cart.remove(itemId)` | Change quantity / remove. |
| `client.promos.apply(code)` | Validate and apply a promo code. |
| `client.addresses.list/add/setDefault/remove` | The customer's saved address book. |
| `client.payments.initPayment(payload)` | Start checkout; tells you whether a card payment is needed. |
| `client.orders.place(payload)` | Create the order (after card confirm, or directly for offline methods). |
| `client.orders.list()` | Order history. |
| `client.orders.cancel(id)` | Cancel while `new` / `confirmed` / `shipped`. |
| `client.orders.requestReturn/listReturns/cancelReturn` | 14-day returns flow. |
| `client.shipping.pickupLocations()` · `client.shipping.deliveryEta()` | Pickup points / delivery estimate. |

→ Full guides: [Cart & Orders](/docs/cart-orders) · [Payments](/docs/payments-api)

### Engagement
| Call | What it does |
|---|---|
| `client.favorites.list()` · `add(productId)` · `remove(productHash)` | Wishlist (add by id, remove by hash). |
| `client.reviews.add(productId, rating, text)` · `delete(id)` | Write / delete your own review. |
| `client.reviews.attachPhoto(id, url)` · `deletePhoto(id)` | Up to 5 photos per review. |
| `client.reviews.vote(id, helpful)` · `unvote(id)` | Helpful votes on other people's reviews. |
| `client.restock.subscribe(productId, skuId?, email?)` | "Notify me when it's back in stock". |

→ Full guide: [Reviews & Favorites](/docs/reviews-favorites)

### Booking — `client.booking`
| Call | What it does |
|---|---|
| `services.list()` · `services.get(id)` | Browse bookable services (+ eligible staff). |
| `services.getSlots(id, date, staffId?)` | Free slots for a date (`YYYY-MM-DD`). |
| `bookings.create(payload)` | Reserve a slot. |
| `bookings.list()` · `bookings.cancel(id)` | The user's bookings / cancel one. |

→ Full guide: [Booking](/docs/booking)

### Support chat — `client.chat`
| Call | What it does |
|---|---|
| `bootstrap()` | Is the widget enabled? Get or create the anonymous id. |
| `send(text)` | Send a visitor message (auto-bootstraps). |
| `list(sinceId)` | Poll for new messages (operator replies have `direction: 'out'`). |
| `reset()` · `id` | Forget the local thread / current anonymous id. |

→ Full guide: [Web Chat](/docs/chat)

### Analytics — `client.track` (fire-and-forget)
| Call | What it does |
|---|---|
| `visit()` | Once per page load. |
| `productView(productId)` | On a product page. |
| `search(query, resultsCount)` | Search queries (surfaces zero-result gaps). |
| `cartEvent(action, data)` | `add` / `remove` / `update_qty` / `apply_promo` / `remove_promo`. |
| `checkout(step, data?)` | `started` / `address_filled` / `promo_tried` / `submitted` / `failed`. |
| `goal(name, value?, meta?)` | Custom goal events (must match a goal configured in the CRM). |

→ Full guide: [Tracking](/docs/tracking)

### Server-to-server — `client.customers` (secret key)
| Call | What it does |
|---|---|
| `client.customers.save(customer)` | Upsert a customer from your own backend. **Server only — uses `sk_…`.** |

→ Full guide: [Pushing Customers](/docs/customers)

---

New here? Start with [Quickstart](/docs/quickstart) and [Concepts](/docs/concepts) — then keep this page open as your map.
