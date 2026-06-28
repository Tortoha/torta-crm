import { useEffect, useRef } from 'react';

// Silently re-runs `refresh` on an interval (default 15s) and whenever the tab
// regains focus, pausing while the tab is hidden. This is the admin panel's
// "realtime" primitive — paired with a page-level loader that re-fetches
// WITHOUT clearing state (no spinner, no data reset), so the view updates with
// zero flicker.
//
// The latest `refresh` is always invoked (stored in a ref), so callers can pass
// a fresh closure every render — `useRealtimePoll(() => load(true))` — without
// re-subscribing the interval or capturing stale filter/selection values.
export function useRealtimePoll(refresh, intervalMs = 15000) {
  const ref = useRef(refresh);
  ref.current = refresh;

  useEffect(() => {
    const tick = () => { if (!document.hidden) ref.current?.(); };
    const id = setInterval(tick, intervalMs);
    // Refresh immediately on return-to-tab so a backgrounded panel isn't stale
    // for up to a full interval after the user comes back.
    const onFocus = () => { if (!document.hidden) ref.current?.(); };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [intervalMs]);
}
