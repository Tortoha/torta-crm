export const API_BASE   = "http://localhost:8001";
export const MAGAZ_BASE = "http://localhost:8000";

/**
 * AUTO-REFRESH MIDDLEWARE
 *
 * We monkey-patch window.fetch ONCE at module load. Every existing
 * `fetch(...)` call across the codebase automatically gets:
 *
 *   1. On 401 from CRM backend → silently call /api/refresh
 *   2. If refresh succeeds → retry the original request once
 *   3. If refresh fails → bubble the original 401 (caller redirects to /login)
 *
 * Concurrency: if 5 tabs all hit 401 at once, only ONE /api/refresh fires;
 * the others await the same in-flight promise. Prevents rotation races
 * where the second request would consume an already-rotated refresh token
 * and get the entire chain revoked.
 *
 * Skip refresh for the auth endpoints themselves (otherwise infinite loop
 * if refresh itself returns 401, etc).
 *
 * CSRF:
 *   GET /api/csrf is called once on load. The server sets a readable cookie
 *   `csrf_token`. The wrapper injects X-CSRF-Token on every state-changing
 *   (non-GET) request to the CRM backend. An attacker on evil.com cannot
 *   read our cookie (same-origin policy) and cannot forge the header.
 */
const NO_REFRESH_PATHS = [
  "/api/refresh",
  "/api/login",
  "/api/logout",
  "/api/send-code",
  "/api/verify-code",
  "/api/resend-code",
  "/api/forgot-password",
  "/api/reset-password",
  "/api/auth/google",
];

const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

// ─── CSRF helpers ──────────────────────────────────────────────────────────

/** Read the csrf_token cookie (set by GET /api/csrf, NOT httpOnly). */
function getCsrfToken() {
  try {
    const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  } catch { return ""; }
}

/** Fetch /api/csrf if we don't have the cookie yet. Non-fatal. */
async function ensureCsrfToken() {
  if (getCsrfToken()) return;
  try {
    await fetch(`${API_BASE}/api/csrf`, { credentials: "include" });
  } catch { /* non-fatal: server might be down, will retry on next mutable request */ }
}

// ─── Refresh helpers ───────────────────────────────────────────────────────

let _refreshPromise = null;

function isCrmRequest(url) {
  try {
    return String(url).startsWith(API_BASE);
  } catch { return false; }
}

function shouldSkipRefresh(url) {
  try {
    const path = new URL(url, window.location.origin).pathname;
    return NO_REFRESH_PATHS.some(p => path.endsWith(p) || path.includes(p));
  } catch {
    return false;
  }
}

async function doRefresh(originalFetch) {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = (async () => {
    try {
      // Refresh is a POST — needs the CSRF token too
      const csrfToken = getCsrfToken();
      const res = await originalFetch(`${API_BASE}/api/refresh`, {
        method: "POST",
        credentials: "include",
        headers: csrfToken ? { "X-CSRF-Token": csrfToken } : {},
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      // Reset on next tick so concurrent callers all see the same result
      setTimeout(() => { _refreshPromise = null; }, 0);
    }
  })();
  return _refreshPromise;
}

// ─── Install fetch wrapper (once) ─────────────────────────────────────────
// `__torta_patched` flag prevents double-wrap on HMR reload.
if (typeof window !== "undefined" && !window.fetch.__torta_patched) {
  const originalFetch = window.fetch.bind(window);

  const wrappedFetch = async function (input, init) {
    const url    = typeof input === "string" ? input : (input?.url || "");
    const method = ((init?.method) || "GET").toUpperCase();

    // Non-CRM requests pass through unchanged
    if (!isCrmRequest(url)) return originalFetch(input, init);

    // Inject X-CSRF-Token on state-changing requests
    if (!CSRF_SAFE_METHODS.has(method)) {
      const token = getCsrfToken();
      if (token) {
        init = {
          ...init,
          headers: { "X-CSRF-Token": token, ...(init?.headers || {}) },
        };
      }
    }

    let res = await originalFetch(input, init);
    if (res.status !== 401 || shouldSkipRefresh(url)) return res;

    const refreshed = await doRefresh(originalFetch);
    if (!refreshed) return res;   // bubble original 401

    // Retry exactly once with refreshed cookie (CSRF token unchanged)
    return originalFetch(input, init);
  };

  wrappedFetch.__torta_patched = true;
  window.fetch = wrappedFetch;

  // Prefetch CSRF token immediately so it's ready before the first POST.
  // Use originalFetch (GET /api/csrf is safe — CSRF middleware skips GETs).
  ensureCsrfToken();
}
