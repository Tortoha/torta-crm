// Google Ads conversion tracking (gtag).
//
// The base Google tag (gtag.js, AW-18233007232) is loaded once in index.html.
// These helpers fire conversion events at the exact success moments:
//   - trackSignup()   → a new CRM account was created      (Verification.jsx)
//   - trackPurchase() → a subscription was paid via Paddle (OrgCheckout.jsx)
//
// Conversions use gtag's default `beacon` transport (navigator.sendBeacon), so
// the ping survives the immediate navigate()/reload() that follows each action.
// Every call no-ops safely when gtag never loaded (ad-blocker, CSP, offline) —
// tracking is best-effort and must never break the auth or checkout flow.

const AW_ID = 'AW-18233007232';

// Conversion labels — from Google Ads → Goals → Conversions (event snippets).
const LABEL = {
  signup:   'vfjsCNaW2b0cEIC5lvZD',
  purchase: 'DpZSCNmW2b0cEIC5lvZD',
};

function _gtag(...args) {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  try { window.gtag(...args); } catch { /* never let tracking throw */ }
}

/** Fire the "Регистрация / Sign up" conversion — call once per new account. */
export function trackSignup() {
  _gtag('event', 'conversion', { send_to: `${AW_ID}/${LABEL.signup}` });
}

/**
 * Fire the "Оплата подписки / Purchase" conversion with the real plan price.
 * `value` is the amount charged (USD) so Google reports true revenue/ROAS
 * across the different plans. Caller must skip card-update transactions.
 */
export function trackPurchase(value, currency = 'USD') {
  _gtag('event', 'conversion', {
    send_to:  `${AW_ID}/${LABEL.purchase}`,
    value:    Number(value) || 0,
    currency,
  });
}
