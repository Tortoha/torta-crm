import { useCallback } from 'react';
import { useProjectEvents } from './useProjectEvents.js';

// useLiveReload — one-liner live collaboration for a page: when a teammate (or a
// storefront customer) creates / changes-status / deletes something in this
// project, every other viewer of the page refetches and sees it. Built on the
// project events WebSocket (same channel as Orders/Booking live-updates).
//
//   useLiveReload(projectId, 'products_changed', reload);
//   useLiveReload(projectId, ['orders_changed', 'order_status_changed'], reload);
//
// `reload` should be a stable callback (useCallback) that re-fetches the page's
// data. Modals stay local (plain React state) — only the underlying data syncs.
export function useLiveReload(projectId, topics, reload) {
  const key = Array.isArray(topics) ? topics.join('|') : String(topics || '');
  const handler = useCallback((e) => {
    if (!e?.type) return;
    if (key.split('|').includes(e.type)) reload?.();
  }, [key, reload]);
  // Pass the topics through so the server only delivers these event types to this
  // connection (page-scoped filtering) instead of the whole project stream.
  useProjectEvents(projectId, handler, key ? key.split('|') : null);
}
