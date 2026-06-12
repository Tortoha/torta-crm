#!/usr/bin/env node
/*
 * gen-sitemap — regenerate CRM/frontend/public/sitemap.xml.
 *
 *   node scripts/gen-sitemap.mjs
 *
 * Marketing pages are translated into 7 languages and served at /{lang}/… (English
 * at the root). Each localized page is emitted once per language, and every entry
 * carries the full <xhtml:link rel="alternate" hreflang> set (all languages +
 * x-default → English) so Google serves the right language per searcher. Pages
 * with no translated content (login / docs / legal) stay English-only.
 *
 * Keep LOCALIZED in sync with App.jsx PUBLIC_SLUGS + the localized landing routes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://tortacrm.com';
const LANGS = ['en', 'ru', 'kk', 'de', 'es', 'fr', 'pt'];

// Localized marketing pages. path has no leading slash ('' = home).
const PRODUCT_SLUGS = ['database', 'products', 'booking', 'digital', 'chat', 'auth', 'storage', 'automations', 'email', 'realtime', 'analytics', 'pos', 'accounting', 'multi-store', 'team', 'currencies', 'reviews'];
const LOCALIZED = [
  { path: '', freq: 'weekly', prio: '1.0' },
  { path: 'pricing', freq: 'weekly', prio: '0.9' },
  { path: 'developers', freq: 'monthly', prio: '0.7' },
  { path: 'security', freq: 'monthly', prio: '0.5' },
  ...PRODUCT_SLUGS.map((s) => ({ path: s, freq: 'monthly', prio: '0.8' })),
];

// English-only pages (no translated content / not under a /{lang}/ route).
const EN_ONLY = [
  { path: 'login', freq: 'monthly', prio: '0.8' },
  { path: 'docs', freq: 'weekly', prio: '0.7' },
  { path: 'docs/getting-started', freq: 'monthly', prio: '0.6' },
  { path: 'docs/quickstart', freq: 'monthly', prio: '0.6' },
  { path: 'terms', freq: 'yearly', prio: '0.3' },
  { path: 'privacy', freq: 'yearly', prio: '0.3' },
  { path: 'refund', freq: 'yearly', prio: '0.3' },
];

const loc = (lang, p) => `${BASE}/${[lang === 'en' ? '' : lang, p].filter(Boolean).join('/')}`;
const alts = (p) =>
  [...LANGS, 'x-default']
    .map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${loc(l === 'x-default' ? 'en' : l, p)}"/>`)
    .join('\n');

const out = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
];
for (const page of LOCALIZED) {
  for (const lang of LANGS) {
    out.push('  <url>');
    out.push(`    <loc>${loc(lang, page.path)}</loc>`);
    out.push(alts(page.path));
    out.push(`    <changefreq>${page.freq}</changefreq>`);
    out.push(`    <priority>${page.prio}</priority>`);
    out.push('  </url>');
  }
}
for (const page of EN_ONLY) {
  out.push(`  <url><loc>${loc('en', page.path)}</loc><changefreq>${page.freq}</changefreq><priority>${page.prio}</priority></url>`);
}
out.push('</urlset>', '');

const dest = path.join(ROOT, 'CRM', 'frontend', 'public', 'sitemap.xml');
fs.writeFileSync(dest, out.join('\n'));
const total = LOCALIZED.length * LANGS.length + EN_ONLY.length;
console.log(`sitemap: ${LOCALIZED.length} localized × ${LANGS.length} langs + ${EN_ONLY.length} en-only = ${total} urls -> ${path.relative(ROOT, dest)}`);
