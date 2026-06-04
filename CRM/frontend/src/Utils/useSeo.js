import { useEffect } from 'react';

// Per-route SEO for the public marketing/landing pages. The app is a client-
// rendered SPA, so without this every route would inherit index.html's default
// <title>/description. Google renders JS, so updating these on mount gives each
// public page its own controlled search snippet + link-preview.
//
// Usage (in a public page component):
//   useSeo({
//     title: 'Pricing that grows with your store — Torta CRM',
//     description: 'Simple, transparent pricing. Start free, scale when you need to.',
//   });

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

export function useSeo({ title, description, canonical } = {}) {
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
    if (canonical) {
      let link = document.head.querySelector('link[rel="canonical"]');
      if (!link) {
        link = document.createElement('link');
        link.setAttribute('rel', 'canonical');
        document.head.appendChild(link);
      }
      link.setAttribute('href', canonical);
    }
    // No cleanup: the next route sets its own values; the homepage/index.html
    // provides the default if a route doesn't call useSeo.
  }, [title, description, canonical]);
}
