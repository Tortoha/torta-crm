// VisitTracker — anonymous landing-visit beacon for the admin sales funnel
// (visited → registered → active → paid). Fires POST /api/track/visit ONCE per
// browser session (sessionStorage guard). `visitor_id` is a stable opaque id in
// localStorage — no PII; the backend stores no IP and dedupes to one row per
// visitor per day. Fire-and-forget: a failed beacon never affects the page.
import { useEffect } from 'react';
import { API_BASE } from '../api.js';

export default function VisitTracker() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem('tv_sent')) return;   // once per session
    } catch { /* storage blocked — fall through, beacon anyway */ }

    let vid = '';
    try {
      vid = localStorage.getItem('tv_visitor') || '';
      if (!vid) {
        vid = (window.crypto?.randomUUID?.() ||
               `${Date.now()}-${Math.random().toString(16).slice(2)}`);
        localStorage.setItem('tv_visitor', vid);
      }
      sessionStorage.setItem('tv_sent', '1');
    } catch { /* private mode — still send a one-off anon beacon */ }

    // Anonymous: no cookies/credentials (so no CSRF surface); country is read
    // server-side from Cloudflare's CF-IPCountry header.
    fetch(`${API_BASE}/api/track/visit`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitor_id: vid || 'anon', path: window.location.pathname }),
      keepalive: true,
    }).catch(() => { /* analytics must never surface an error */ });
  }, []);

  return null;
}
