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

// Fire a conversion, then run `onDone` once the hit is on its way. Uses gtag's
// event_callback so a caller that navigates/reloads right after can WAIT for the
// beacon: an immediate window.location.reload() otherwise tears the page down
// before gtag sends the hit and the conversion is silently lost — this is why
// "Регистрация" stayed at 0 / "Требуется действие". A timeout fallback guarantees
// onDone still runs when gtag is blocked (ad-blocker/CSP) or never calls back, so
// tracking can never strand the user mid-flow.
function _fireConversion(sendTo, extra, onDone) {
  let called = false;
  const done = () => { if (called) return; called = true; try { onDone && onDone(); } catch { /* ignore */ } };
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') { done(); return; }
  setTimeout(done, 1200);   // fallback: proceed even if gtag never calls back
  try {
    window.gtag('event', 'conversion', { send_to: sendTo, ...(extra || {}), event_callback: done });
  } catch { done(); }
}

/**
 * Fire the "Регистрация / Sign up" conversion — call once per new account.
 * Pass `onDone` to run AFTER the hit is sent (e.g. a navigate/reload) so the
 * conversion isn't killed by the page tearing down.
 */
export function trackSignup(onDone) {
  _fireConversion(`${AW_ID}/${LABEL.signup}`, null, onDone);
}

/**
 * Fire the "Оплата подписки / Purchase" conversion with the real plan price.
 * `value` is the amount charged (USD) so Google reports true revenue/ROAS
 * across the different plans. Caller must skip card-update transactions.
 * Optional `onDone` runs once the hit is sent (see trackSignup).
 */
export function trackPurchase(value, currency = 'USD', onDone) {
  _fireConversion(`${AW_ID}/${LABEL.purchase}`, { value: Number(value) || 0, currency }, onDone);
}
