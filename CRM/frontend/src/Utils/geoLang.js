// Geo → default UI language for FIRST-TIME anonymous visitors.
//
// The country comes from Cloudflare's same-origin /cdn-cgi/trace (loc=XX) —
// free, no third-party service, no rate limit, no API key. We only act when the
// visitor has NO language preference yet (localStorage 'crm_lang' empty), so a
// returning visitor's or a logged-in user's own choice is never overridden
// (logged-in language is re-applied from /api/me via api.js → syncLang).
//
// Kazakhstan is multilingual, so it gets a kk/ru/en picker (banner) rather than
// a silent default. Ukraine, Georgia and the Baltics sit in the CIS region but
// deliberately default to English, not Russian.

import { syncLang } from '../i18n.js';

const RU         = new Set(['RU', 'BY', 'KG', 'TJ', 'TM', 'UZ', 'AM', 'MD', 'AZ']); // CIS → Russian
const RU_BUT_EN  = new Set(['UA', 'GE', 'EE', 'LV', 'LT']);                          // CIS region → English
const DE         = new Set(['DE', 'AT', 'CH', 'LI']);
const FR         = new Set(['FR', 'MC', 'LU']);
const ES         = new Set(['ES', 'MX', 'AR', 'CO', 'CL', 'PE', 'VE', 'EC', 'GT', 'CU', 'BO', 'DO', 'HN', 'PY', 'SV', 'NI', 'CR', 'PA', 'UY']);
const PT         = new Set(['BR', 'PT', 'AO', 'MZ']);

// Country code → { lang, pickerKZ? }. KZ returns 'ru' as a sensible default but
// flags pickerKZ so the caller offers kk/ru/en.
export function countryToLang(cc) {
  const c = (cc || '').toUpperCase();
  if (c === 'KZ')        return { lang: 'ru', pickerKZ: true };
  if (RU_BUT_EN.has(c))  return { lang: 'en' };
  if (RU.has(c))         return { lang: 'ru' };
  if (DE.has(c))         return { lang: 'de' };
  if (FR.has(c))         return { lang: 'fr' };
  if (ES.has(c))         return { lang: 'es' };
  if (PT.has(c))         return { lang: 'pt' };
  return { lang: 'en' };
}

// Visitor country from Cloudflare's same-origin trace endpoint. Returns null on
// any failure (e.g. local dev, where there's no Cloudflare edge) — caller no-ops.
export async function detectCountry() {
  try {
    const r = await fetch('/cdn-cgi/trace', { cache: 'no-store' });
    if (!r.ok) return null;
    const txt = await r.text();
    const m = txt.match(/^loc=([A-Z]{2})$/m);
    return m ? m[1] : null;
  } catch { return null; }
}

// First-visit geo language. Applies the detected language (which also stores
// 'crm_lang', so this never runs twice) and reports whether to show the KZ
// picker. No-op when the visitor already has a language preference.
export async function resolveGeoLanguage() {
  const cc = await detectCountry();   // always detect — the country is also reported to the backend
  if (!cc) return { country: null, pickerKZ: false };
  // Only auto-set the language on a true first visit; never override an
  // existing choice (a returning visitor, or a logged-in user whose language
  // is re-applied from /api/me).
  const hasPref = typeof localStorage !== 'undefined' && localStorage.getItem('crm_lang');
  if (hasPref) return { country: cc, pickerKZ: false };
  const { lang, pickerKZ } = countryToLang(cc);
  await syncLang(lang);   // sets 'crm_lang' too → won't auto-set again
  return { country: cc, pickerKZ: !!pickerKZ };
}
