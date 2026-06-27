import { useLocation } from 'react-router-dom';

// Public marketing paths that have a /{lang}/ localized version — mirror of
// App.jsx PUBLIC_SLUGS + the localized landing routes. Anything NOT here
// (/login, /docs, /terms, app routes) must never be prefixed: there's no
// localized route for it, so a prefix would dead-end.
const PREFIXES = ['ru', 'kk'];
const LOCALIZED = new Set([
  '/', '/pricing', '/developers', '/security',
  '/database', '/products', '/booking', '/digital', '/chat', '/auth', '/storage',
  '/automations', '/email', '/realtime', '/analytics', '/pos', '/accounting',
  '/multi-store', '/team', '/currencies',
]);

// On a localized public route (/ru/…), returns lp(to) that prefixes internal
// links pointing at a localized page with the active locale, so browsing stays
// in that language. On English (root) routes — and for any non-localized target
// — it's a no-op. Pass an app-absolute path, optionally with a query/hash
// ('/pricing', '/accounting', '/docs/x?from=landing').
export function useLocalePath() {
  const { pathname } = useLocation();
  const seg = (pathname.split('/')[1] || '').toLowerCase();
  const prefix = PREFIXES.includes(seg) ? `/${seg}` : '';
  return (to) => {
    if (!prefix || typeof to !== 'string') return to;
    const base = to.split(/[?#]/)[0];
    if (!LOCALIZED.has(base)) return to;
    return base === '/' ? prefix : prefix + to;
  };
}
