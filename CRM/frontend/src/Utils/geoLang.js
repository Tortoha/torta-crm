// Visitor country from Cloudflare's same-origin /cdn-cgi/trace (loc=XX) —
// free, no third-party service, no API key, no rate limit. Returns null where
// there's no Cloudflare edge (e.g. local dev). Used only to keep a logged-in
// user's last_country fresh; it does NOT change the UI language (English is the
// default for everyone — multi-language SEO is handled via per-locale URLs +
// hreflang, not geo).
export async function detectCountry() {
  try {
    const r = await fetch('/cdn-cgi/trace', { cache: 'no-store' });
    if (!r.ok) return null;
    const txt = await r.text();
    const m = txt.match(/^loc=([A-Z]{2})$/m);
    return m ? m[1] : null;
  } catch { return null; }
}
