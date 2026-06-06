// Global presence bootstrapper — mounted once in App.jsx so the WebSocket
// opens on EVERY authenticated page, not only the ones wrapped in Layout /
// OrgLayout / etc. Without this, pages like /dashboard, /invite/:token,
// /accept-terms wouldn't appear "online" to other users — and the second
// account in a 2-tab test wouldn't show as online to the first.
//
// We rely on /api/me to know whether the user is logged in. Same module-level
// singleton inside usePresence guarantees the WS opens once per tab even if
// multiple call-sites mount the hook (Layouts + this).

import { useEffect, useState } from 'react';
import { API_BASE } from '../api.js';
import { usePresence } from '../Utils/usePresence.js';

function PresenceInner() {
  usePresence();   // opens the singleton WS + reports route on navigation
  return null;
}

export default function PresenceBoot() {
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    fetch(`${API_BASE}/api/me`, { credentials: 'include' })
      .then(r => { if (r.ok) setAuthed(true); })
      .catch(() => { /* not logged in or backend down — no presence */ });
  }, []);
  return authed ? <PresenceInner /> : null;
}
