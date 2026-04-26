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

  // ─── Core request helper ──────────────────────────────────────────────────
  async function req(method, path, body, extraHeaders) {
    const options = {
      method,
      credentials: "include",
      headers: {
        "X-Publishable-Key": publishableKey,
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
       * Fetch current user from /api/me (cached after first call).
       * Pass force=true to bypass cache (e.g. after login).
       */
      async getUser(force = false) {
        if (!force && _user !== undefined) return _user;
        if (!force && _userPromise)        return _userPromise;
        _userPromise = req("GET", "/api/me").then(({ ok, data }) => {
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
        return req("POST", "/api/send-code", payload);
      },

      /** Verify the 6-digit code. Clears user cache on success. */
      async verifyCode(email, code) {
        const result = await req("POST", "/api/verify-code", { email, code });
        if (result.ok) this.invalidateUser();
        return result;
      },

      /** Resend verification code to email. */
      async resendCode(email) {
        return req("POST", "/api/resend-code", { email });
      },

      /** Log out. Clears user cache. */
      async logout() {
        const result = await req("POST", "/api/logout");
        _user = null;
        _userPromise = null;
        return result;
      },

      /** Send password reset link to email. */
      async forgotPassword(email) {
        return req("POST", "/api/forgot-password", { email });
      },

      /** Validate a reset token. Returns { ok, data: { email } }. */
      async validateResetToken(token) {
        return req("GET", `/api/reset-password/validate/${token}`);
      },

      /** Submit a new password using a reset token. */
      async resetPassword(token, password, repeat_password) {
        return req("POST", "/api/reset-password", { token, password, repeat_password });
      },

      /** Redirect to Google OAuth login for this store (full page redirect). */
      googleLogin() {
        window.location.href = `${base}/api/auth/google/login`;
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
        window.location.href = `${base}/api/auth/oauth/${provider}/login`;
      },

      /**
       * Send an SMS OTP to a phone number.
       * @param {string} phone — E.164 format, e.g. "+77071234567"
       * @param {string} [name] — optional, used when creating a new user
       */
      async sendPhoneCode(phone, name) {
        return req("POST", "/api/auth/phone/send-code", { phone, name });
      },

      /**
       * Verify an SMS OTP. On success, the auth cookie is set automatically.
       * @param {string} phone
       * @param {string} code
       */
      async verifyPhoneCode(phone, code) {
        const result = await req("POST", "/api/auth/phone/verify-code", { phone, code });
        if (result.ok) this.invalidateUser();
        return result;
      },
    },

    // ── Products ─────────────────────────────────────────────────────────────
    products: {
      /** List all products (public endpoint). */
      async list() {
        return req("GET", "/api-products");
      },

      /** Get full product page by hash id. */
      async get(id) {
        return req("GET", `/api/product/${id}`);
      },
    },

    // ── Cart ─────────────────────────────────────────────────────────────────
    cart: {
      /** Get cart with items and subtotal. */
      async get() {
        return req("GET", "/api/cart");
      },

      /** Add item to cart. */
      async add(product_id, variation_id, size_id, quantity = 1) {
        return req("POST", "/api/cart/add", { product_id, variation_id, size_id, quantity });
      },

      /** Update quantity of a cart item. */
      async update(cartItemId, quantity) {
        return req("PUT", `/api/cart/${cartItemId}`, { quantity });
      },

      /** Remove an item from the cart. */
      async remove(cartItemId) {
        return req("DELETE", `/api/cart/${cartItemId}`);
      },
    },

    // ── Favorites ────────────────────────────────────────────────────────────
    favorites: {
      /** Get list of favorited product ids. */
      async list() {
        return req("GET", "/api/favorites");
      },

      /** Add a product to favorites by numeric id. */
      async add(product_id) {
        return req("POST", "/api/favorites/add", { product_id });
      },

      /** Remove a product from favorites by hash. */
      async remove(productHash) {
        return req("DELETE", `/api/favorites/${productHash}`);
      },
    },

    // ── Promos ───────────────────────────────────────────────────────────────
    promos: {
      /** Apply a promo code to the current cart. */
      async apply(code) {
        return req("POST", "/api/promo-code/apply", { code });
      },
    },

    // ── Reviews ──────────────────────────────────────────────────────────────
    reviews: {
      /** Submit a product review. */
      async add(product_id, rating, comment) {
        return req("POST", "/api/reviews/add", { product_id, rating, comment });
      },

      /** Delete own review by id. */
      async delete(reviewId) {
        return req("DELETE", `/api/reviews/${reviewId}`);
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
        return req("POST", "/api/orders", payload);
      },

      /** Get order history for the logged-in customer. */
      async list() {
        return req("GET", "/api/orders");
      },
    },

    // ── Track ────────────────────────────────────────────────────────────────
    track: {
      /** Record a site visit (fire-and-forget). */
      visit() {
        req("POST", "/api/track/visit").catch(() => {});
      },

      /** Record a product page view (fire-and-forget). */
      productView(product_id) {
        req("POST", "/api/track/product-view", { product_id }).catch(() => {});
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
          return req("GET", "/api/booking/services");
        },
        /** Get one service with its eligible staff. */
        async get(serviceId) {
          return req("GET", `/api/booking/services/${serviceId}`);
        },
        /**
         * Get available time slots for a service on a given date.
         * @param {number} serviceId
         * @param {string} date — "YYYY-MM-DD"
         * @param {number} [staffId] — required for services with requires_staff=true
         */
        async getSlots(serviceId, date, staffId) {
          const q = staffId ? `?date=${date}&staff_id=${staffId}` : `?date=${date}`;
          return req("GET", `/api/booking/services/${serviceId}/slots${q}`);
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
          return req("POST", "/api/booking/bookings", payload);
        },
        /** List the current user's bookings. */
        async list() {
          return req("GET", "/api/booking/bookings/my");
        },
        /** Cancel one of the current user's bookings (subject to cancellation window). */
        async cancel(bookingId) {
          return req("DELETE", `/api/booking/bookings/${bookingId}`);
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
       * Calls GET /api/chat/bootstrap.
       */
      async bootstrap() {
        const existing = _getWebChatId();
        const headers  = existing ? { "X-Web-Chat-Id": existing } : undefined;
        const res = await req("GET", "/api/chat/bootstrap", undefined, headers);
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
        const res = await req("POST", "/api/chat/messages", { text, web_chat_id });
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
          `/api/chat/messages?web_chat_id=${encodeURIComponent(web_chat_id)}&since_id=${since_id}`);
      },

      /** Reset the local visitor identity (forgets past conversation). */
      reset() {
        const s = _safeStorage();
        if (s) s.removeItem(WEB_CHAT_KEY);
      },
    },
  };
}
