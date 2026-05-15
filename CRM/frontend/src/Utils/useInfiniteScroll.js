import { useCallback, useEffect, useRef } from 'react';

// IntersectionObserver-driven sentinel: attaches a ref to a placeholder div near the end of the list. When it scrolls into view (with a generous `rootMargin` so requests fire before the user hits the bottom), the supplied loadMore callback runs.
//
// Pattern:
//   const sentinelRef = useInfiniteScroll(loadMore);
//   {hasMore && <div ref={sentinelRef} className="inf-sentinel" />}
export function useInfiniteScroll(loadMore, { rootMargin = '200px', enabled = true } = {}) {
  const targetRef = useRef(null);
  const callbackRef = useRef(loadMore);
  callbackRef.current = loadMore;

  const setRef = useCallback((el) => {
    targetRef.current = el;
  }, []);

  useEffect(() => {
    const el = targetRef.current;
    if (!el || !enabled) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) callbackRef.current?.();
    }, { rootMargin, threshold: 0 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [enabled, rootMargin]);

  return setRef;
}
