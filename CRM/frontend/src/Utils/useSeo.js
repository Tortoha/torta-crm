import { useEffect } from 'react';

// Per-route SEO for the public marketing/landing pages. The app is a client-
// rendered SPA, so without this every route would inherit index.html's default
// <title>/description. Google renders JS, so updating these on mount gives each
// public page its own controlled search snippet + link-preview.
//
// Multilingual SEO: public pages exist at /{lang}/… (e.g. /ru/accounting). Pass
// the locale-agnostic `path` ('' = home, 'accounting', 'pricing', …) and this
// hook emits a locale-aware <link rel="canonical"> plus a full set of
// <link rel="alternate" hreflang> tags (one per language + x-default), so Google
// knows every page's translations and serves the right one per searcher.
//
// Usage (in a public page component):
//   useSeo({ title: '…', description: '…', path: 'pricing' });
// Legacy callers may still pass { canonical } directly (no hreflang emitted).

const BASE = 'https://tortacrm.com';
// Languages that have translated public pages. 'en' is served at the root (no
// prefix); the rest live under /{code}/. Mirrors locales/ that are at parity.
const HREFLANGS = ['en', 'ru', 'kk', 'de', 'es', 'fr', 'pt'];
const PREFIXES = HREFLANGS.filter((l) => l !== 'en');

// Absolute URL for a (lang, path) pair. path has no leading slash; '' = home.
function localeUrl(lang, path) {
  const segs = [];
  if (lang !== 'en') segs.push(lang);
  if (path) segs.push(path);
  return `${BASE}/${segs.join('/')}`;
}

// Active locale, read from the first path segment (/ru/… → 'ru') so the SEO
// tags match the URL a crawler actually fetched, regardless of any stored pref.
function langFromPath() {
  const seg = (window.location.pathname.split('/')[1] || '').toLowerCase();
  return PREFIXES.includes(seg) ? seg : 'en';
}

function setMeta(attr, key, content) {
  if (!content) return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setCanonical(href) {
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export function useSeo({ title, description, path, canonical } = {}) {
  useEffect(() => {
    if (title) {
      document.title = title;
      setMeta('property', 'og:title', title);
      setMeta('name', 'twitter:title', title);
    }
    if (description) {
      setMeta('name', 'description', description);
      setMeta('property', 'og:description', description);
      setMeta('name', 'twitter:description', description);
    }

    // Clear any hreflang alternates from a previous route so they never carry
    // over onto a page that has none (e.g. an English-only legal page).
    document.head.querySelectorAll('link[data-seo-alt]').forEach((el) => el.remove());

    if (path !== undefined) {
      const lang = langFromPath();
      document.documentElement.lang = lang;
      setCanonical(localeUrl(lang, path));
      // One alternate per language, plus x-default → the English URL.
      for (const l of [...HREFLANGS, 'x-default']) {
        const link = document.createElement('link');
        link.setAttribute('rel', 'alternate');
        link.setAttribute('hreflang', l);
        link.setAttribute('href', localeUrl(l === 'x-default' ? 'en' : l, path));
        link.setAttribute('data-seo-alt', '');
        document.head.appendChild(link);
      }
    } else if (canonical) {
      setCanonical(canonical);
    }
    // No cleanup of title/description: the next route sets its own; index.html
    // provides the default if a route doesn't call useSeo.
  }, [title, description, path, canonical]);
}
