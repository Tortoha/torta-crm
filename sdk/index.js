/**
 * torta-js — JavaScript client SDK for Torta CRM
 *
 * Usage:
 *   import { createClient } from 'torta-js';
 *
 *   const client = createClient(
 *     'http://localhost:8000/SHORT_KEY',   // base URL with short public key
 *     'pk_PUBLISHABLE_KEY'                 // publishable key — sent as X-Publishable-Key header
 *   );
 *
 * After publish, from CDN:
 *   import { createClient } from 'https://cdn.jsdelivr.net/npm/torta-js/+esm';
 */

export function createClient(baseUrl, publishableKey) {
  // baseUrl already contains the short public key in the path,
  // e.g. "http://localhost:8000/0c39355b5b6b5ac05bbc"
  const base = baseUrl.replace(/\/$/, '');

  // ─── User cache ───────────────────────────────────────────────────────────
  let _user = undefined;    // undefined = never fetched, null = not logged in
  let _userPromise = null;  // deduplicates concurrent getUser() calls

  // ─── Auto-refresh ──────────────────────────────────────────────────────────
  // Access token expires after 15 min; refresh token rotates and lasts 30 days.
  // When ANY request returns 401, we silently call /refresh once and retry.
  // Concurrent 401s share a single in-flight refresh promise — otherwise they'd
  // race to consume each other's rotated refresh tokens.
  const NO_REFRESH_PATHS = [
    "/refresh",
    "/send-code", "/verify-code", "/resend-code",
    "/forgot-password", "/reset-password",
    "/auth/google", "/auth/oauth", "/auth/phone",
    "/logout",
  ];
  function _isAuthPath(path) {
    return NO_REFRESH_PATHS.some(p => path.includes(p));
  }

  let _refreshPromise = null;
  async function _doRefresh() {
    if (_refreshPromise) return _refreshPromise;
    _refreshPromise = (async () => {
      try {
        const r = await fetch(`${base}/refresh`, {
          method: "POST",
          credentials: "include",
          headers: { "X-Publishable-Key": publishableKey },
        });
        return r.ok;
      } catch {
        return false;
      } finally {
        // Reset on next tick so concurrent waiters all see the same outcome
        setTimeout(() => { _refreshPromise = null; }, 0);
      }
    })();
    return _refreshPromise;
  }

  // ─── CSRF helpers ─────────────────────────────────────────────────────────
  // The External backend uses a double-submit cookie pattern:
  //   GET /csrf  → sets readable cookie `csrf_token`
  //   POST/PUT/...   → must include X-CSRF-Token: <same value>
  // An attacker on evil.com cannot read our cookie, so cannot forge the header.
  const _CSRF_SAFE = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

  function _getCsrfToken() {
    try {
      const m = (typeof document !== "undefined" ? document.cookie : "")
        .match(/(?:^|;\s*)csrf_token=([^;]+)/);
      return m ? decodeURIComponent(m[1]) : "";
    } catch { return ""; }
  }

  let _csrfPromise = null;
  async function _ensureCsrf() {
    if (_getCsrfToken()) return;
    if (_csrfPromise) return _csrfPromise;
    _csrfPromise = (async () => {
      try {
        await fetch(`${base}/csrf`, {
          credentials: "include",
          headers: { "X-Publishable-Key": publishableKey },
        });
      } catch { /* non-fatal */ } finally {
        _csrfPromise = null;
      }
    })();
    return _csrfPromise;
  }

  // ─── Core request helper ──────────────────────────────────────────────────
  async function _doFetch(method, path, body, extraHeaders) {
    const m = method.toUpperCase();
    // Ensure CSRF cookie is set before any state-changing request
    if (!_CSRF_SAFE.has(m)) await _ensureCsrf();

    const csrfToken = _getCsrfToken();
    const options = {
      method,
      credentials: "include",
      headers: {
        "X-Publishable-Key": publishableKey,
        // Echo CSRF cookie as header on state-changing requests
        ...(!_CSRF_SAFE.has(m) && csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        ...(extraHeaders || {}),
      },
    };
    if (body !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    const res = await fetch(`${base}${path}`, options);
    let data = null;
    try {
      if (res.headers.get("content-type")?.includes("application/json")) {
        data = await res.json();
      }
    } catch { /* ignore */ }
    return { ok: res.ok, status: res.status, data };
  }

  async function req(method, path, body, extraHeaders) {
    const result = await _doFetch(method, path, body, extraHeaders);
    if (result.status !== 401 || _isAuthPath(path)) return result;

    // 401 — try silent refresh, then retry once
    const refreshed = await _doRefresh();
    if (!refreshed) {
      _user = null;          // bust cached user — frontend should redirect
      _userPromise = null;
      return result;
    }
    return _doFetch(method, path, body, extraHeaders);
  }

  // ─── Web-chat identity (anonymous, persisted in localStorage) ─────────────
  const WEB_CHAT_KEY = "torta_web_chat_id";
  const _safeStorage = () => {
    try { return typeof localStorage !== "undefined" ? localStorage : null; }
    catch { return null; }
  };
  function _getWebChatId() {
    const s = _safeStorage();
    return s ? (s.getItem(WEB_CHAT_KEY) || "") : "";
  }
  function _setWebChatId(id) {
    const s = _safeStorage();
    if (s && id) s.setItem(WEB_CHAT_KEY, id);
  }

  // ─── Client ───────────────────────────────────────────────────────────────
  return {

    // ── Auth ─────────────────────────────────────────────────────────────────
    auth: {
      /** Cached user object. undefined = not yet fetched, null = not logged in. */
      get user() { return _user; },

      /**
       * Fetch current user from /me (cached after first call).
       * Pass force=true to bypass cache (e.g. after login).
       */
      async getUser(force = false) {
        if (!force && _user !== undefined) return _user;
        if (!force && _userPromise)        return _userPromise;
        _userPromise = req("GET", "/me").then(({ ok, data }) => {
          _user = ok ? data : null;
          _userPromise = null;
          return _user;
        }).catch(() => {
          _user = null;
          _userPromise = null;
          return null;
        });
        return _userPromise;
      },

      /** Clear user cache (called automatically on login/logout). */
      invalidateUser() {
        _user = undefined;
        _userPromise = null;
      },

      /**
       * Send email verification code.
       * payload: { email, password, type: "login"|"register", name? }
       */
      async sendCode(payload) {
        return req("POST", "/send-code", payload);
      },

      /** Verify the 6-digit code. Clears user cache on success. */
      async verifyCode(email, code) {
        const result = await req("POST", "/verify-code", { email, code });
        if (result.ok) this.invalidateUser();
        return result;
      },

      /** Resend verification code to email. */
      async resendCode(email) {
        return req("POST", "/resend-code", { email });
      },

      /** Log out. Clears user cache. */
      async logout() {
        const result = await req("POST", "/logout");
        _user = null;
        _userPromise = null;
        return result;
      },

      /** Send password reset link to email. */
      async forgotPassword(email) {
        return req("POST", "/forgot-password", { email });
      },

      /** Validate a reset token. Returns { ok, data: { email } }. */
      async validateResetToken(token) {
        return req("GET", `/reset-password/validate/${token}`);
      },

      /** Submit a new password using a reset token. */
      async resetPassword(token, password, repeat_password) {
        return req("POST", "/reset-password", { token, password, repeat_password });
      },

      /** Redirect to Google OAuth login for this store (full page redirect). */
      googleLogin() {
        window.location.href = `${base}/auth/google/login`;
      },

      /**
       * Redirect to a generic OAuth provider for this store (full page redirect).
       * Provider must be one of: github, discord, facebook, gitlab, bitbucket,
       * linkedin, twitch, spotify, slack, notion, figma, zoom, azure, apple,
       * x, vk, kakao, keycloak.
       *
       * Example: client.auth.oauthLogin('github')
       */
      oauthLogin(provider) {
        if (!provider) throw new Error("provider name required");
        window.location.href = `${base}/auth/oauth/${provider}/login`;
      },

      /**
       * Send an SMS OTP to a phone number.
       * @param {string} phone — E.164 format, e.g. "+77071234567"
       * @param {string} [name] — optional, used when creating a new user
       */
      async sendPhoneCode(phone, name) {
        return req("POST", "/auth/phone/send-code", { phone, name });
      },

      /**
       * Verify an SMS OTP. On success, the auth cookie is set automatically.
       * @param {string} phone
       * @param {string} code
       */
      async verifyPhoneCode(phone, code) {
        const result = await req("POST", "/auth/phone/verify-code", { phone, code });
        if (result.ok) this.invalidateUser();
        return result;
      },

      /**
       * Manually trigger a refresh-token rotation. The SDK does this
       * automatically on 401, so you usually don't need to call it.
       */
      async refresh() {
        return req("POST", "/refresh");
      },

      /**
       * List the user's active sessions across all devices.
       * Each item has { id, is_current, created_at, last_used_at,
       *                 expires_at, user_agent, ip, label }.
       */
      async listSessions() {
        return req("GET", "/sessions");
      },

      /** Revoke a single session (logout from one device). */
      async revokeSession(sessionId) {
        return req("DELETE", `/sessions/${sessionId}`);
      },

      /** Logout from ALL devices for this user (revokes every session). */
      async logoutAll() {
        const result = await req("POST", "/logout-all");
        _user = null;
        _userPromise = null;
        return result;
      },
    },

    // ── Products ─────────────────────────────────────────────────────────────
    products: {
      /**
       * List products. Optional filter:
       *   list({ category: 'trousers' })   — only products in this category (by slug)
       *   list({ uncategorized: true })    — only products with no category
       *   list()                           — all products
       */
      async list(opts = {}) {
        const params = new URLSearchParams();
        if (opts.category)      params.set('category', opts.category);
        if (opts.uncategorized) params.set('uncategorized', 'true');
        const qs = params.toString();
        return req("GET", `/products${qs ? '?' + qs : ''}`);
      },

      /** Get full product page by hash id. */
      async get(id) {
        return req("GET", `/product/${id}`);
      },
    },

    // ── Categories ───────────────────────────────────────────────────────────
    categories: {
      /**
       * List all product categories (with products_count).
       * Returns: [{ id, name, slug, products_count }, ...]
       * Use the slug in `client.products.list({ category: slug })`.
       */
      async list() {
        return req("GET", "/categories");
      },
    },

    // ── Cart ─────────────────────────────────────────────────────────────────
    cart: {
      /** Get cart with items and subtotal. Each item carries `modifiers: [...]`
       *  (selected modifier items with `name`, `price_delta`, `group_name`) and
       *  `base_price` — the SKU price without modifiers, useful for UI breakdown.
       *  `price` is the unit price INCLUDING modifier deltas. */
      async get() {
        return req("GET", "/cart");
      },

      /**
       * Add item to cart.
       * @param {number} product_id
       * @param {number} variation_id
       * @param {number} configuration_id
       * @param {number} [quantity=1]
       * @param {number[]} [selected_modifier_item_ids=[]] — IDs from product.modifier_groups[*].items[*].id
       *
       * The server validates each id belongs to a group of this product and
       * that per-group min/max/required/radio constraints hold. Two cart lines
       * with the SAME SKU but DIFFERENT modifier sets are kept separate;
       * identical sets are merged (quantity bumped).
       */
      async add(product_id, variation_id, configuration_id, quantity = 1, selected_modifier_item_ids = []) {
        return req("POST", "/cart/add", {
          product_id, variation_id, configuration_id, quantity,
          selected_modifier_item_ids,
        });
      },

      /**
       * Update quantity (and optionally modifier selection) of a cart item.
       * @param {number} cartItemId
       * @param {number} quantity
       * @param {number[]} [selected_modifier_item_ids] — when provided, replaces
       *   the line's modifier set; when omitted, modifiers stay as-is.
       */
      async update(cartItemId, quantity, selected_modifier_item_ids) {
        const body = { quantity };
        if (selected_modifier_item_ids !== undefined) {
          body.selected_modifier_item_ids = selected_modifier_item_ids;
        }
        return req("PUT", `/cart/${cartItemId}`, body);
      },

      /** Remove an item from the cart. */
      async remove(cartItemId) {
        return req("DELETE", `/cart/${cartItemId}`);
      },
    },

    // ── Favorites ────────────────────────────────────────────────────────────
    favorites: {
      /** Get list of favorited product ids. */
      async list() {
        return req("GET", "/favorites");
      },

      /** Add a product to favorites by numeric id. */
      async add(product_id) {
        return req("POST", "/favorites/add", { product_id });
      },

      /** Remove a product from favorites by hash. */
      async remove(productHash) {
        return req("DELETE", `/favorites/${productHash}`);
      },
    },

    // ── Promos ───────────────────────────────────────────────────────────────
    promos: {
      /** Apply a promo code to the current cart. */
      async apply(code) {
        return req("POST", "/promo-code/apply", { code });
      },
    },

    // ── Reviews ──────────────────────────────────────────────────────────────
    reviews: {
      /** Submit a product review. */
      async add(product_id, rating, comment) {
        return req("POST", "/reviews/add", { product_id, rating, comment });
      },

      /** Delete own review by id. */
      async delete(reviewId) {
        return req("DELETE", `/reviews/${reviewId}`);
      },

      /**
       * Attach a previously-uploaded photo URL (from your S3 bucket) to one
       * of the user's reviews. Up to 5 photos per review. The URL must point
       * to your project's S3 bucket — external URLs are rejected.
       */
      async attachPhoto(review_id, url) {
        return req("POST", "/reviews/photos", { review_id, url });
      },

      /** Remove one of the user's review photos by id. */
      async deletePhoto(photoId) {
        return req("DELETE", `/reviews/photos/${photoId}`);
      },

      /** Cast or change a helpful/unhelpful vote on someone else's review. */
      async vote(review_id, is_helpful) {
        return req("POST", "/reviews/vote", { review_id, is_helpful });
      },

      /** Withdraw your vote on a review. */
      async unvote(reviewId) {
        return req("DELETE", `/reviews/vote/${reviewId}`);
      },
    },

    // ── Restock waitlist ────────────────────────────────────────────────────
    restock: {
      /**
       * Subscribe the visitor (anonymous or authenticated) to be notified by
       * email when this product/SKU is restocked.
       * @param {number} product_id
       * @param {number|null} [sku_id] — optional, watch a specific configuration
       * @param {string|null} [email] — required when not authenticated
       */
      async subscribe(product_id, sku_id, email) {
        return req("POST", "/restock/subscribe", { product_id, sku_id, email });
      },
    },

    // ── Orders ───────────────────────────────────────────────────────────────
    orders: {
      /**
       * Place an order from the current cart.
       * @param {object} payload
       * @param {string} payload.recipient_name   - Required
       * @param {string} [payload.phone]
       * @param {string} [payload.delivery_method] - "courier" | "postal" (default: "courier")
       * @param {string} [payload.address]         - Required when delivery_method = "courier"
       * @param {string} [payload.comment]
       * @param {string} [payload.payment_method]  - "card" | "cash" (default: "card")
       * @param {string} [payload.promo_code]
       */
      async place(payload) {
        return req("POST", "/orders", payload);
      },

      /** Get order history for the logged-in customer. */
      async list() {
        return req("GET", "/orders");
      },

      /**
       * Request a return for items from a delivered order. 14-day window.
       * @param {number} order_id
       * @param {object} payload
       * @param {string} payload.reason - damaged|wrong_item|not_as_described|changed_mind|arrived_late|quality_issue|other
       * @param {string} [payload.customer_message]
       * @param {Array<{order_item_id:number, quantity:number}>} payload.items
       * @param {string[]} [payload.customer_photos] - URLs (uploaded separately)
       */
      async requestReturn(order_id, payload) {
        return req("POST", `/orders/${order_id}/request-return`, payload);
      },

      /** List all return requests the customer has submitted for one of their orders. */
      async listReturns(order_id) {
        return req("GET", `/orders/${order_id}/returns`);
      },

      /**
       * Cancel a return request the customer themselves submitted. Only works
       * while status='requested' — once the merchant has approved/rejected/etc,
       * the customer must contact the store directly.
       */
      async cancelReturn(order_id, return_id) {
        return req("POST", `/orders/${order_id}/returns/${return_id}/cancel`);
      },
    },

    // ── Shipping / pickup ────────────────────────────────────────────────────
    //
    // Two helpers the storefront uses at checkout / on product cards:
    //   client.shipping.pickupLocations() — list of warehouses the merchant
    //     opted into "pickup at store". Each entry has structured address +
    //     opening hours + contact phone.
    //   client.shipping.deliveryEta()     — aggregate {min_days, max_days}
    //     across the merchant's warehouses, for the "Delivery in 2–4 days"
    //     hint on product/checkout pages. Returns null fields when no
    //     warehouse has an ETA configured (storefront should hide the hint).
    shipping: {
      async pickupLocations() {
        return req("GET", "/pickup-locations");
      },
      async deliveryEta() {
        return req("GET", "/delivery-eta");
      },
    },

    // ── Track ────────────────────────────────────────────────────────────────
    track: {
      /** Record a site visit (fire-and-forget). */
      visit() {
        req("POST", "/track/visit").catch(() => {});
      },

      /** Record a product page view (fire-and-forget). */
      productView(product_id) {
        req("POST", "/track/product-view", { product_id }).catch(() => {});
      },
    },

    // ── Booking (services + appointments) ────────────────────────────────────
    //
    // Two namespaces under booking:
    //   client.booking.services.list()
    //   client.booking.services.get(id)
    //   client.booking.services.getSlots(id, date, staffId?)
    //   client.booking.bookings.create({ serviceId, staffId?, startsAt, … })
    //   client.booking.bookings.list()        // current user's bookings
    //   client.booking.bookings.cancel(id)
    //
    booking: {
      services: {
        /** List active services for this store. */
        async list() {
          return req("GET", "/booking/services");
        },
        /** Get one service with its eligible staff. */
        async get(serviceId) {
          return req("GET", `/booking/services/${serviceId}`);
        },
        /**
         * Get available time slots for a service on a given date.
         * @param {number} serviceId
         * @param {string} date — "YYYY-MM-DD"
         * @param {number} [staffId] — required for services with requires_staff=true
         */
        async getSlots(serviceId, date, staffId) {
          const q = staffId ? `?date=${date}&staff_id=${staffId}` : `?date=${date}`;
          return req("GET", `/booking/services/${serviceId}/slots${q}`);
        },
      },
      bookings: {
        /**
         * Create a booking. starts_at must be ISO local ("YYYY-MM-DDTHH:MM").
         * @param {object} payload
         * @param {number} payload.service_id
         * @param {number} [payload.staff_id]
         * @param {string} payload.starts_at
         * @param {string} [payload.customer_name]
         * @param {string} [payload.customer_phone]
         * @param {string} [payload.customer_email]
         * @param {string} [payload.notes]
         */
        async create(payload) {
          return req("POST", "/booking/bookings", payload);
        },
        /** List the current user's bookings. */
        async list() {
          return req("GET", "/booking/bookings/my");
        },
        /** Cancel one of the current user's bookings (subject to cancellation window). */
        async cancel(bookingId) {
          return req("DELETE", `/booking/bookings/${bookingId}`);
        },
      },
    },

    // ── Web Chat (support widget) ────────────────────────────────────────────
    //
    // Anonymous customer chat with the store operators. The visitor identity
    // is a random UUID stored in localStorage (`torta_web_chat_id`). No login
    // required. The CRM operator sees the conversation in real time;
    // the widget polls `list()` to receive replies.
    //
    chat: {
      /** Returns the persisted anonymous web-chat id, or "" if not yet set. */
      get id() { return _getWebChatId(); },

      /**
       * Verifies whether the support widget is enabled for this project and
       * returns (or generates) the anonymous web_chat_id.
       * Calls GET /chat/bootstrap.
       */
      async bootstrap() {
        const existing = _getWebChatId();
        const headers  = existing ? { "X-Web-Chat-Id": existing } : undefined;
        const res = await req("GET", "/chat/bootstrap", undefined, headers);
        if (res.ok && res.data?.web_chat_id) {
          _setWebChatId(res.data.web_chat_id);
        }
        return res;
      },

      /** Send a message from the visitor to the CRM. */
      async send(text) {
        let web_chat_id = _getWebChatId();
        if (!web_chat_id) {
          const boot = await this.bootstrap();
          web_chat_id = boot.data?.web_chat_id || "";
        }
        const res = await req("POST", "/chat/messages", { text, web_chat_id });
        if (res.ok && res.data?.web_chat_id) _setWebChatId(res.data.web_chat_id);
        return res;
      },

      /**
       * Fetch messages newer than `since_id` for the current visitor.
       * Returns { messages: [{ id, direction: 'in'|'out', text, created_at }] }.
       * Use `direction === 'out'` to find new operator replies.
       */
      async list(since_id = 0) {
        const web_chat_id = _getWebChatId();
        if (!web_chat_id) return { ok: true, status: 200, data: { messages: [] } };
        return req("GET",
          `/chat/messages?web_chat_id=${encodeURIComponent(web_chat_id)}&since_id=${since_id}`);
      },

      /** Reset the local visitor identity (forgets past conversation). */
      reset() {
        const s = _safeStorage();
        if (s) s.removeItem(WEB_CHAT_KEY);
      },
    },
  };
}
