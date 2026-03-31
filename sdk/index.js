/**
 * torta-js — JavaScript client SDK for Torta CRM
 *
 * Usage:
 *   import { createClient } from 'torta-js';
 *   const client = createClient('http://localhost:8000', 'your-api-key');
 *
 * After publish, from CDN:
 *   import { createClient } from 'https://cdn.jsdelivr.net/npm/torta-js/+esm';
 */

export function createClient(baseUrl, apiKey) {
  const base = `${baseUrl}/${apiKey}`;

  // ─── User cache ───────────────────────────────────────────────────────────
  let _user = undefined;    // undefined = never fetched, null = not logged in
  let _userPromise = null;  // deduplicates concurrent getUser() calls

  // ─── Core request helper ──────────────────────────────────────────────────
  async function req(method, path, body) {
    const options = {
      method,
      credentials: "include",
      headers: {},
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
  };
}
