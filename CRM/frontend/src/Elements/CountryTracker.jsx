// Best-effort: report the visitor's current country (from Cloudflare's
// same-origin /cdn-cgi/trace) so a logged-in user's last_country stays current
// if they travel. Renders nothing and never touches the UI language — English
// is the default for everyone. Anonymous callers get 401 and are ignored.
import { useEffect } from 'react';
import { API_BASE } from '../api.js';
import { detectCountry } from '../Utils/geoLang.js';

export default function CountryTracker() {
  useEffect(() => {
    let alive = true;
    detectCountry().then((cc) => {
      if (!alive || !cc) return;
      fetch(`${API_BASE}/api/me/country`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country: cc }),
      }).catch(() => {});
    });
    return () => { alive = false; };
  }, []);
  return null;
}
