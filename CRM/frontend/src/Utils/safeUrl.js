// Safe URL helpers — block `javascript:`, `data:`, `vbscript:`, `file:`
// schemes in user-supplied URLs.
//
// Why this exists: the backend `sanitize()` only escapes `& < > " '` —
// it doesn't reject URL schemes. A malicious user can submit a "photo
// URL" or custom-field value like `javascript:fetch('/api/sessions',{...})`
// and when a CRM admin clicks the resulting `<a href={url}>`, the
// script executes inside their authenticated CRM session (account
// takeover). Same risk for `<img src={url}>` though most browsers
// won't execute javascript: there.

const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/**
 * Returns the URL if its scheme is safe, otherwise returns a fallback.
 *
 *   safeUrl('https://example.com')  // → 'https://example.com'
 *   safeUrl('javascript:alert(1)')  // → '' (fallback)
 *   safeUrl('foo.png', '#')         // → '#' (relative URLs aren't parseable
 *                                   //       by URL ctor without a base; we
 *                                   //       return the fallback to be safe.
 *                                   //       For relative storefront paths
 *                                   //       use `safeRelative` instead.)
 */
export function safeUrl(url, fallback = '') {
  if (typeof url !== 'string' || !url) return fallback;
  try {
    // Parse with a base URL so relative paths resolve. If the parsed
    // protocol is in our allowlist, return the ORIGINAL (so we don't
    // accidentally absolutise relative URLs that the caller intended
    // to stay relative).
    const u = new URL(url, window.location.origin);
    if (SAFE_SCHEMES.has(u.protocol)) return url;
    return fallback;
  } catch {
    // URL constructor throws on truly malformed input — treat as unsafe.
    return fallback;
  }
}

/**
 * Strict variant — requires absolute http(s) URLs only. Use for
 * external-resource references (logos, images uploaded to S3, webhook
 * targets) where relative paths make no sense.
 */
export function safeHttpUrl(url, fallback = '') {
  if (typeof url !== 'string' || !url) return fallback;
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return url;
    return fallback;
  } catch {
    return fallback;
  }
}
