// Paddle.js singleton — lazy-initialised the first time anything calls
// `getPaddle()`. The backend `GET /api/billing/config` returns env + token +
// 6 price IDs; we feed env + token into Paddle.Setup once and cache the
// resulting Paddle instance for every subsequent caller.
//
// Why a singleton (not a hook): checkout can fire from multiple roots —
// Pricing page, billing page in org settings, the 402-error upgrade modal.
// Calling Setup twice would either re-mount Paddle's iframe (visible flicker)
// or print a noisy warning. One promise, one instance.
//
// Why expose an event subscriber: Setup only takes ONE eventCallback, but
// different surfaces want different reactions (Pricing → redirect to /dashboard,
// modal → close itself + toast). We fan out the single callback to N listeners
// via `onPaddleEvent`.

import { initializePaddle } from '@paddle/paddle-js';
import { API_BASE } from '../api.js';

// ── Listener fan-out ───────────────────────────────────────────────────
const _listeners = new Set();

function _emit(event) {
  for (const fn of _listeners) {
    try { fn(event); } catch (e) { console.error('[paddle] listener threw:', e); }
  }
}

/**
 * Subscribe to Paddle events ('checkout.completed' | 'checkout.closed' |
 * 'checkout.payment_failed' | …). Returns an unsubscribe function.
 *
 * Always unsubscribe in a useEffect cleanup — listeners persist for the
 * lifetime of the page otherwise (and a stale listener can call setState
 * on an unmounted component).
 */
export function onPaddleEvent(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

// ── Config fetch (memoised) ───────────────────────────────────────────
let _configPromise = null;

/**
 * GET /api/billing/config → { environment, client_token, prices: {...} }.
 * Cached per page-load — we never need to re-fetch this within one session.
 */
export function getBillingConfig() {
  if (_configPromise) return _configPromise;
  _configPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/billing/config`, { credentials: 'include' });
      if (!res.ok) return null;
      const cfg = await res.json();
      return cfg && cfg.client_token ? cfg : null;
    } catch {
      return null;
    }
  })();
  return _configPromise;
}

// ── Paddle instance (memoised) ────────────────────────────────────────
let _paddlePromise = null;

/**
 * Initialise + return the Paddle instance. Returns `null` when the backend
 * has no client_token configured (dev without Paddle creds, or before the
 * operator has populated Fly secrets). Callers should fall back gracefully —
 * usually that means leaving the legacy `/registration` link in place.
 */
export function getPaddle() {
  if (_paddlePromise) return _paddlePromise;
  _paddlePromise = (async () => {
    const cfg = await getBillingConfig();
    if (!cfg) return null;
    try {
      return await initializePaddle({
        environment: cfg.environment === 'production' ? 'production' : 'sandbox',
        token:       cfg.client_token,
        eventCallback: _emit,
      });
    } catch (e) {
      console.error('[paddle] initializePaddle failed:', e);
      _paddlePromise = null;  // allow retry on next call
      return null;
    }
  })();
  return _paddlePromise;
}

/**
 * Open Paddle's inline checkout overlay for a transaction created by
 * POST /api/orgs/{id}/billing/checkout. Throws if Paddle isn't configured —
 * callers should catch + show a friendly error toast.
 *
 * Settings: `displayMode: 'overlay'` (default), `theme: 'light'`. Settings
 * are passed through unchanged so callers can override locale, allow logo,
 * etc., when needed.
 */
export async function openCheckout(transactionId, settings = {}) {
  const paddle = await getPaddle();
  if (!paddle) throw new Error('paddle_not_configured');
  paddle.Checkout.open({
    transactionId,
    settings: { displayMode: 'overlay', theme: 'light', ...settings },
  });
}

/**
 * Close any open checkout overlay. Safe to call when nothing is open
 * (Paddle no-ops). Used by the upgrade modal when the user clicks Cancel.
 */
export async function closeCheckout() {
  const paddle = await getPaddle();
  if (!paddle) return;
  try { paddle.Checkout.close(); } catch { /* nothing open */ }
}
