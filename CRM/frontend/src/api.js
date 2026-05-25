import { syncLang } from "./i18n";
import { syncTheme } from "./theme";

export const API_BASE   = import.meta.env.VITE_API_BASE          || "http://localhost:8001";
export const MAGAZ_BASE = import.meta.env.VITE_EXTERNAL_API_BASE || "http://localhost:8000";


export function pickError(data, fallback = "Something went wrong") {
  if (!data) return fallback;
  const d = data.detail ?? data.error ?? data.message;
  if (!d) return fallback;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    const parts = d.map((e) => {
      if (typeof e === "string") return e;
      const field = Array.isArray(e?.loc) ? e.loc.filter(x => x !== "body").join(".") : "input";
      return `${field}: ${e?.msg || "Invalid value"}`;
    });
    return parts.join("; ") || fallback;
  }
  try { return JSON.stringify(d); } catch { return fallback; }
}

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

    // Inject X-CSRF-Token on state-changing requests. If the cookie is missing
    // (e.g. the initial GET /api/csrf failed because the backend wasn't up yet),
    // fetch it on-demand so the very first mutation doesn't get a spurious 403.
    if (!CSRF_SAFE_METHODS.has(method)) {
      let token = getCsrfToken();
      if (!token) { await ensureCsrfToken(); token = getCsrfToken(); }
      if (token) {
        init = {
          ...init,
          headers: { "X-CSRF-Token": token, ...(init?.headers || {}) },
        };
      }
    }

    let res = await originalFetch(input, init);

    // Apply the server-stored UI language whenever we load the current user,
    // so it follows the account across devices/browsers (localStorage is just a cache).
    if (res.ok && method === "GET") {
      try {
        const path = new URL(url, window.location.origin).pathname;
        if (path.endsWith("/api/me")) {
          res.clone().json().then(j => { syncLang(j?.language); syncTheme(j?.theme); }).catch(() => {});
        }
      } catch { /* ignore */ }
    }

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
