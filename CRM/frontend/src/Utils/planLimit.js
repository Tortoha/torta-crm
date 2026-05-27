// Plan-limit (HTTP 402) global handling.
//
// Backend's `enforce_limit()` raises a 402 with a structured body:
//   { detail: { error: 'plan_limit_exceeded', plan, resource, limit, current, requested } }
//
// Rather than wrapping every fetch call in a try/catch that pops a modal,
// we install a one-time fetch interceptor at app boot. Whenever ANY fetch
// response comes back 402 with that body shape, we dispatch a CustomEvent
// on `window`. The PlanLimitModal listens for it + renders.
//
// Original Response is returned unchanged — callers still see their 402
// and can fall back to whatever error UI they had. The modal is additive.

let _installed = false;

export function installPlanLimitInterceptor() {
  if (_installed || typeof window === 'undefined') return;
  _installed = true;
  const origFetch = window.fetch;
  window.fetch = async (...args) => {
    const res = await origFetch(...args);
    // Fast-path: only inspect 402 responses with a JSON content-type.
    if (res.status === 402) {
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('json')) {
        try {
          const body = await res.clone().json();
          const detail = body && body.detail;
          if (detail && detail.error === 'plan_limit_exceeded') {
            window.dispatchEvent(new CustomEvent('plan_limit_exceeded', { detail }));
          }
        } catch { /* malformed body — let caller see the raw response */ }
      }
    }
    return res;
  };
}

/**
 * Subscribe to plan_limit_exceeded events. Returns an unsubscribe function.
 * The modal is the only intended consumer — direct callers shouldn't need this.
 */
export function onPlanLimit(handler) {
  if (typeof window === 'undefined') return () => {};
  const wrapped = ev => handler(ev.detail || {});
  window.addEventListener('plan_limit_exceeded', wrapped);
  return () => window.removeEventListener('plan_limit_exceeded', wrapped);
}
