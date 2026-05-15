import { useCallback, useEffect, useRef, useState } from 'react';

// Cursor-paginated list with IntersectionObserver-driven auto-load.
// Backend contract: GET <url>?cursor=N&limit=M → { items: [...], next_cursor: int|null, has_more: bool }.
// Backward-compat: when the same URL is hit WITHOUT a `cursor` param the server returns the legacy plain array, so callers can opt out of pagination simply by passing { paginated: false } and treating it as a single page.
//
// Usage:
//   const { items, hasMore, loading, loadMore, reload } = useInfiniteList({
//     url: `${API_BASE}/api/products${pq}`,
//     pageSize: 50,
//   });
//   ...
//   {hasMore && <div ref={useInfiniteScroll(loadMore)} className="inf-sentinel">Loading…</div>}
export function useInfiniteList({ url, pageSize = 50, paginated = true, deps = [], extraQS = '' }) {
  const [items,    setItems]   = useState([]);
  const [cursor,   setCursor]  = useState(null);
  const [hasMore,  setHasMore] = useState(true);
  const [loading,  setLoading] = useState(true);
  const [error,    setError]   = useState(null);

  // Mount counter — invalidates in-flight responses from a stale URL.
  const reqIdRef = useRef(0);
  // Latest stable cursor — useRef so loadMore can chain without stale closures.
  const cursorRef = useRef(null);

  const buildUrl = useCallback((c) => {
    let u = url;
    if (paginated) {
      const sep = u.includes('?') ? '&' : '?';
      u = `${u}${sep}cursor=${c ?? ''}&limit=${pageSize}`;
    }
    if (extraQS) {
      u += (u.includes('?') ? '&' : '?') + extraQS;
    }
    return u;
  }, [url, paginated, pageSize, extraQS]);

  const loadMore = useCallback(async () => {
    if (!hasMore && cursorRef.current !== null) return;
    const myId = ++reqIdRef.current;
    setLoading(true); setError(null);
    try {
      const r = await fetch(buildUrl(cursorRef.current), { credentials: 'include' });
      if (myId !== reqIdRef.current) return;     // a newer load won the race
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();

      // Paginated response shape: { items, next_cursor, has_more }.
      // Non-paginated fallback: backend returned a bare array — treat as final page.
      const isPaginated = data && typeof data === 'object' && Array.isArray(data.items);
      const pageItems = isPaginated ? data.items : (Array.isArray(data) ? data : []);
      const nextCursor = isPaginated ? data.next_cursor : null;
      const nextHasMore = isPaginated ? !!data.has_more : false;

      setItems(prev => cursorRef.current == null ? pageItems : [...prev, ...pageItems]);
      cursorRef.current = nextCursor;
      setCursor(nextCursor);
      setHasMore(nextHasMore);
    } catch (e) {
      setError(e);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [buildUrl, hasMore]);

  // Reset on URL/deps change — fresh stream of pages.
  const reload = useCallback(() => {
    cursorRef.current = null;
    setItems([]); setCursor(null); setHasMore(true);
    // schedule into the next tick so the cleared state is committed first
    setTimeout(() => loadMore(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadMore]);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, extraQS, ...deps]);

  return { items, cursor, hasMore, loading, error, loadMore, reload, setItems };
}
