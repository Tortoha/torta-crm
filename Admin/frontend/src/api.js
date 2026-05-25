// Same fetch wrapper as CRM/frontend/src/api.js but trimmed:
// no i18n/theme sync (admin is single-locale, light theme).
// Talks to the CRM backend — admin endpoints are /api/admin/* on the same host.

export const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8001";

export function pickError(data, fallback = "Something went wrong") {
  if (!data) return fallback;
  const d = data.detail ?? data.error ?? data.message;
  if (!d) return fallback;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    return d.map((e) => typeof e === "string" ? e : (e?.msg || "Invalid value")).join("; ") || fallback;
  }
  try { return JSON.stringify(d); } catch { return fallback; }
}

const NO_REFRESH_PATHS = [
  "/api/refresh", "/api/login", "/api/logout",
  "/api/send-code", "/api/verify-code", "/api/resend-code",
];
const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

function getCsrfToken() {
  try {
    const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  } catch { return ""; }
}

async function ensureCsrfToken() {
  if (getCsrfToken()) return;
  try { await fetch(`${API_BASE}/api/csrf`, { credentials: "include" }); } catch {}
}

let _refreshPromise = null;

function isCrmRequest(url) {
  try { return String(url).startsWith(API_BASE); } catch { return false; }
}

function shouldSkipRefresh(url) {
  try {
    const p = new URL(url, window.location.origin).pathname;
    return NO_REFRESH_PATHS.some(x => p.endsWith(x) || p.includes(x));
  } catch { return false; }
}

async function doRefresh(originalFetch) {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = (async () => {
    try {
      const csrf = getCsrfToken();
      const res = await originalFetch(`${API_BASE}/api/refresh`, {
        method: "POST", credentials: "include",
        headers: csrf ? { "X-CSRF-Token": csrf } : {},
      });
      return res.ok;
    } catch { return false; }
    finally { setTimeout(() => { _refreshPromise = null; }, 0); }
  })();
  return _refreshPromise;
}

if (typeof window !== "undefined" && !window.fetch.__torta_admin_patched) {
  const originalFetch = window.fetch.bind(window);
  const wrapped = async function (input, init) {
    const url    = typeof input === "string" ? input : (input?.url || "");
    const method = ((init?.method) || "GET").toUpperCase();
    if (!isCrmRequest(url)) return originalFetch(input, init);

    if (!CSRF_SAFE_METHODS.has(method)) {
      let token = getCsrfToken();
      if (!token) { await ensureCsrfToken(); token = getCsrfToken(); }
      if (token) init = { ...init, headers: { "X-CSRF-Token": token, ...(init?.headers || {}) } };
    }

    let res = await originalFetch(input, init);
    if (res.status !== 401 || shouldSkipRefresh(url)) return res;
    const refreshed = await doRefresh(originalFetch);
    if (!refreshed) return res;
    return originalFetch(input, init);
  };
  wrapped.__torta_admin_patched = true;
  window.fetch = wrapped;
  ensureCsrfToken();
}
