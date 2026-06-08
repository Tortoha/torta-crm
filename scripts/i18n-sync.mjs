#!/usr/bin/env node
/*
 * i18n-sync — keep the CRM console's locale files in step with English.
 *
 *   node scripts/i18n-sync.mjs check            parity report; exits 1 if any gaps (CI gate)
 *   node scripts/i18n-sync.mjs report <lang>     write scripts/i18n-missing.<lang>.json
 *                                                (grouped {namespace: {key: englishValue}})
 *   node scripts/i18n-sync.mjs merge  <lang> <file>
 *                                                merge a translated map (same shape as
 *                                                report output) back into locales/<lang>/*.json
 *   node scripts/i18n-sync.mjs fill   <lang>     auto: report -> translate via Anthropic
 *                                                API (needs ANTHROPIC_API_KEY) -> merge
 *
 * English (locales/en) is the single source of truth. The app sets fallbackLng:'en',
 * so any key a language hasn't translated still renders in English — nothing breaks.
 * This script's job is to surface exactly what's left to translate.
 *
 * Per-feature workflow: write the English strings -> `report <lang>` (or `check`) ->
 * translate the small missing map (by hand, by Claude, or `fill`) -> `merge`. Done.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOC = path.join(ROOT, 'CRM', 'frontend', 'src', 'locales');
const SRC = 'en';

const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJSON = (p, obj) => fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
const srcNamespaces = () =>
  fs.readdirSync(path.join(LOC, SRC)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
const targetLangs = () =>
  fs.readdirSync(LOC, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== SRC)
    .map((d) => d.name);

// Flatten nested object -> { 'a.b.c': 'leaf' } (string/number/bool leaves only).
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function setDeep(obj, dotKey, value) {
  const parts = dotKey.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts.at(-1)] = value;
}

// i18next stores plurals as separate keys with CLDR-category suffixes
// (foo_one / foo_other in English; foo_one / foo_few / foo_many in Russian, …).
// Compare on the *base* key (suffix stripped) so a language using more or fewer
// plural forms than English isn't flagged — only genuinely untranslated strings.
const PLURAL_RE = /_(zero|one|two|few|many|other)$/;
const baseKey = (k) => k.replace(PLURAL_RE, '');

// Compare one language against English, per namespace (on base keys).
function diffLang(lang) {
  const res = { lang, missingFiles: [], missing: {}, extra: {}, totalMissing: 0, totalExtra: 0 };
  for (const ns of srcNamespaces()) {
    const srcBases = new Set(Object.keys(flatten(readJSON(path.join(LOC, SRC, `${ns}.json`)))).map(baseKey));
    const dstPath = path.join(LOC, lang, `${ns}.json`);
    if (!fs.existsSync(dstPath)) {
      res.missingFiles.push(ns);
      res.missing[ns] = [...srcBases];
      res.totalMissing += srcBases.size;
      continue;
    }
    const dstBases = new Set(Object.keys(flatten(readJSON(dstPath))).map(baseKey));
    const miss = [...srcBases].filter((k) => !dstBases.has(k));
    const extra = [...dstBases].filter((k) => !srcBases.has(k));
    if (miss.length) { res.missing[ns] = miss; res.totalMissing += miss.length; }
    if (extra.length) { res.extra[ns] = extra; res.totalExtra += extra.length; }
  }
  return res;
}

// { namespace: { 'flat.key': englishValue } } — every English raw key whose base
// is untranslated in `lang` (expands each missing base to its plural variants).
function missingMap(lang) {
  const d = diffLang(lang);
  const out = {};
  for (const ns of Object.keys(d.missing)) {
    const srcFlat = flatten(readJSON(path.join(LOC, SRC, `${ns}.json`)));
    const missing = new Set(d.missing[ns]);
    out[ns] = {};
    for (const [k, v] of Object.entries(srcFlat)) if (missing.has(baseKey(k))) out[ns][k] = v;
  }
  return out;
}

function mergeGrouped(lang, grouped) {
  let n = 0;
  for (const ns of Object.keys(grouped)) {
    const p = path.join(LOC, lang, `${ns}.json`);
    const obj = fs.existsSync(p) ? readJSON(p) : {};
    for (const [k, v] of Object.entries(grouped[ns])) { setDeep(obj, k, v); n++; }
    writeJSON(p, obj);
  }
  return n;
}

function cmdCheck() {
  const langs = targetLangs();
  let bad = 0;
  console.log(`i18n parity vs '${SRC}'  (${srcNamespaces().length} namespaces)\n`);
  for (const lang of langs) {
    const d = diffLang(lang);
    if (d.totalMissing) bad++;
    const flag = d.totalMissing ? 'x' : 'ok';
    const note = d.missingFiles.length ? `   no file: ${d.missingFiles.join(', ')}` : '';
    console.log(`  [${flag.padEnd(2)}] ${lang.padEnd(4)} missing ${String(d.totalMissing).padStart(4)}   extra ${String(d.totalExtra).padStart(4)}${note}`);
  }
  console.log(bad
    ? `\n${bad} language(s) have untranslated keys. Next: node scripts/i18n-sync.mjs report <lang>`
    : '\nAll languages fully translated.');
  process.exit(bad ? 1 : 0);
}

function cmdReport(lang) {
  if (!lang) { console.error('usage: report <lang>'); process.exit(2); }
  const grouped = missingMap(lang);
  const count = Object.values(grouped).reduce((a, o) => a + Object.keys(o).length, 0);
  const dest = path.join(ROOT, 'scripts', `i18n-missing.${lang}.json`);
  writeJSON(dest, grouped);
  console.log(`${count} missing key(s) across ${Object.keys(grouped).length} namespace(s) -> ${path.relative(ROOT, dest)}`);
  if (count) console.log(`Translate the values in that file, then: node scripts/i18n-sync.mjs merge ${lang} ${path.relative(ROOT, dest)}`);
}

function cmdMerge(lang, file) {
  if (!lang || !file) { console.error('usage: merge <lang> <translated.json>'); process.exit(2); }
  const grouped = readJSON(path.resolve(ROOT, file));
  const n = mergeGrouped(lang, grouped);
  console.log(`Merged ${n} key(s) into locales/${lang}/`);
}

// Optional autonomous path. Translates the missing map per-namespace via the
// Anthropic API. The hand/Claude path (report -> translate -> merge) needs no key.
async function cmdFill(lang) {
  if (!lang) { console.error('usage: fill <lang>'); process.exit(2); }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not set. Use the keyless path instead:');
    console.error(`  node scripts/i18n-sync.mjs report ${lang}   # writes the missing English strings`);
    console.error('  (translate that file — by hand or with Claude Code — keeping keys identical)');
    console.error(`  node scripts/i18n-sync.mjs merge ${lang} scripts/i18n-missing.${lang}.json`);
    process.exit(2);
  }
  const model = process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest';
  const grouped = missingMap(lang);
  const nss = Object.keys(grouped);
  if (!nss.length) { console.log(`${lang}: nothing missing.`); return; }
  const sys = `You translate B2B SaaS CRM UI strings from English into ${lang}. Reply ONLY with a JSON object mapping each given key to its translation. Keep keys identical. Preserve {{placeholders}} verbatim. Do not translate brand/technical terms (Torta, POS, API, SKU, OAuth, DKIM, SPF, DMARC, URL, Webhook, JSON, CSV, Paddle, Google, Apple). Formal register.`;
  const translated = {};
  for (const ns of nss) {
    const body = {
      model, max_tokens: 8192, system: sys,
      messages: [{ role: 'user', content: JSON.stringify(grouped[ns], null, 2) }],
    };
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    if (!r.ok) { console.error(`${ns}: API ${r.status} ${await r.text()}`); process.exit(1); }
    const j = await r.json();
    const text = (j.content || []).map((c) => c.text || '').join('').trim().replace(/^```json\s*|\s*```$/g, '');
    translated[ns] = JSON.parse(text);
    console.log(`  ${ns}: ${Object.keys(translated[ns]).length} keys`);
  }
  const n = mergeGrouped(lang, translated);
  console.log(`Filled ${n} key(s) into locales/${lang}/ via ${model}`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'check' || !cmd) cmdCheck();
else if (cmd === 'report') cmdReport(rest[0]);
else if (cmd === 'merge') cmdMerge(rest[0], rest[1]);
else if (cmd === 'fill') await cmdFill(rest[0]);
else { console.error(`unknown command: ${cmd}`); process.exit(2); }
