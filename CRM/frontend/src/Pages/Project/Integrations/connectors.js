// Catalogue of every connector shown in the marketplace.
// `available: true` connectors render as clickable installable rows;
// `available: false` render as expandable "Coming soon" rows where the
// merchant can read the planned feature list and tap "Notify me when ready".
//
// `kind` discriminates routing:
//   - 'webhook'    → generic webhook modal (Custom Webhook / Slack / Discord)
//   - 'accounting' → AccountingExportModal (period + format + schedule)
//   - 'analytics' / 'marketing' / 'automation' → request-only for now
//
// `country` powers the region filter chips on the Browse tab so a merchant
// in Kazakhstan can hide US-only tools and vice-versa.

export const CONNECTOR_CATEGORIES = [
  { key: 'popular',    label: 'Popular' },
  { key: 'accounting', label: 'Accounting' },
  { key: 'analytics',  label: 'Analytics' },
  { key: 'marketing',  label: 'Marketing' },
];

export const CONNECTOR_COUNTRIES = [
  { key: 'all',    label: 'All regions' },
  { key: 'global', label: 'Global' },
  { key: 'cis',    label: 'Russia / CIS' },
  { key: 'kz',     label: 'Kazakhstan' },
  { key: 'us',     label: 'US / Canada' },
  { key: 'eu',     label: 'Europe' },
  { key: 'apac',   label: 'AU / UK / NZ' },
];

export const CONNECTORS = [
  // ── Popular ──────────────────────────────────────────────
  {
    type: 'webhook', kind: 'webhook', category: 'popular', country: 'global',
    name: 'Custom Webhook',
    description: 'POST every event to your own server URL.',
    available: true, icon: 'webhook',
    features: ['HMAC-signed payloads', 'Retry on failure', 'Full event filtering'],
  },
  {
    type: 'slack', kind: 'webhook', category: 'popular', country: 'global',
    name: 'Slack',
    description: 'Get a Slack message every time something happens.',
    available: true, icon: 'slack',
    features: ['Posts to any channel via incoming webhook', 'Rich attachments', 'Per-event filter'],
  },
  {
    type: 'discord', kind: 'webhook', category: 'popular', country: 'global',
    name: 'Discord',
    description: 'Post events to a Discord channel via webhook.',
    available: true, icon: 'discord',
    features: ['Embed-formatted alerts', 'Server-side filtering', 'Test-send from CRM'],
  },
  {
    type: 'zapier', kind: 'webhook', category: 'popular', country: 'global',
    name: 'Zapier',
    description: 'Forward CRM events to a Zapier Catch Hook → 5000+ apps.',
    available: true, icon: 'zapier',
    primaryLabel: 'Catch Hook URL',
    primaryPlaceholder: 'https://hooks.zapier.com/hooks/catch/12345/abcdef/',
    primaryHelp: 'In Zapier: new Zap → Trigger "Webhooks by Zapier" → Catch Hook → copy the URL it generates.',
    docsUrl: 'https://zapier.com/help/create/code-webhooks/trigger-zaps-from-webhooks',
    features: [
      'Plain JSON payloads — Zapier auto-parses every field',
      'No HMAC overhead (Zapier doesn\'t verify) — simpler setup',
      'Per-event filter same as other webhooks',
    ],
  },

  // ── Accounting ───────────────────────────────────────────
  // All 5 now available via the generic export pipeline (CSV / IIF / XML).
  // No OAuth — merchant downloads on demand or receives signed email links.
  {
    type: 'acc_1c', kind: 'accounting', category: 'accounting', country: 'cis',
    name: '1C Бухгалтерия',
    description: 'Export orders to a 1C-compatible CSV (Windows-1251).',
    available: true, icon: '1c',
    accountingFormat: 'Semicolon CSV · Windows-1251 (Cyrillic)',
    features: [
      'One row per order with date / contact / amount / currency',
      'Cyrillic-safe encoding (cp1251) — imports straight into 1C 8.3',
      'Bulk historical export by period (day / week / month / custom)',
    ],
    setupSteps: [
      'Pick a delivery cadence (manual download / daily / weekly / monthly).',
      'Map currency in 1C Конфигуратор once — same file shape on every export.',
      'Open the file in 1C → Сервис → Загрузка данных из табличного документа.',
    ],
  },
  {
    type: 'acc_kompra', kind: 'accounting', category: 'accounting', country: 'kz',
    name: 'Kompra (ЭСФ Kazakhstan)',
    description: 'UTF-8 CSV ready for bulk ЭСФ upload in Kompra.kz.',
    available: true, icon: 'kompra',
    accountingFormat: 'Semicolon CSV · UTF-8 with BOM',
    features: [
      'VAT-split columns (Net / 12% NDS / Gross) — Kompra-import ready',
      'KZT currency, IIN/BIN column left blank for merchant fill-in',
      'BOM-prefixed UTF-8 so Excel keeps Cyrillic clean',
    ],
    setupSteps: [
      'Pick "Today / Last 7 days / Last month / Custom" period.',
      'Download the CSV — review IIN/BIN column before importing.',
      'In Kompra: Кабинет → ЭСФ → Загрузить из файла.',
    ],
  },
  {
    type: 'acc_quickbooks', kind: 'accounting', category: 'accounting', country: 'us',
    name: 'QuickBooks',
    description: 'IIF transaction files for QuickBooks Desktop / accountant tools.',
    available: true, icon: 'quickbooks',
    accountingFormat: '.IIF (Tab-delimited transactions)',
    features: [
      'TRNS / SPL / ENDTRNS blocks — one transaction per paid order',
      'Maps to Accounts Receivable + Sales accounts',
      'Compatible with every QuickBooks tool that ingests IIF',
    ],
    setupSteps: [
      'Download the .IIF file for the desired period.',
      'In QuickBooks Desktop: File → Utilities → Import → IIF Files.',
      'Review imported transactions before saving the session.',
    ],
  },
  {
    type: 'acc_xero', kind: 'accounting', category: 'accounting', country: 'apac',
    name: 'Xero',
    description: 'CSV in Xero’s Sales Invoice import schema.',
    available: true, icon: 'xero',
    accountingFormat: 'CSV · Xero Sales Invoice Template',
    features: [
      'Asterisked column headers (*ContactName / *InvoiceNumber / …) Xero requires',
      'Auto 14-day due date, currency snapshot from each order',
      'Multi-currency safe — Xero matches each line to the correct ledger',
    ],
    setupSteps: [
      'Download the CSV for the chosen period.',
      'In Xero: Business → Invoices → Import → choose CSV.',
      'Map AccountCode = 200 (Sales) on first import, Xero remembers it.',
    ],
  },
  {
    type: 'acc_datev', kind: 'accounting', category: 'accounting', country: 'eu',
    name: 'DATEV',
    description: 'German accounting CSV — DATEV Buchungsstapel format.',
    available: true, icon: 'datev',
    accountingFormat: 'Semicolon CSV · Windows-1252',
    features: [
      'Buchungsstapel columns: Umsatz, Soll/Haben, Konto/Gegenkonto, Belegfeld',
      'Comma decimal + DDMM date — DATEV-strict formatting',
      'Konto 1400 (Forderungen) → Gegenkonto 8400 (Erlöse) mapping',
    ],
    setupSteps: [
      'Export CSV → save to local disk.',
      'Open DATEV → Bestand → Importieren → wähle "Buchungsstapel CSV".',
      'Adjust Konto/Gegenkonto in DATEV before posting if your chart differs.',
    ],
  },

  // ── Analytics ────────────────────────────────────────────
  {
    type: 'ga4', kind: 'apiconn', category: 'analytics', country: 'global',
    name: 'Google Analytics 4',
    description: 'Stream purchase events to GA4 via Measurement Protocol.',
    available: true, icon: 'ga4',
    primaryLabel: 'Measurement ID',
    primaryPlaceholder: 'G-XXXXXXXXXX',
    primaryHelp: 'GA4 Admin → Data Streams → your web stream → Measurement ID. Starts with G-.',
    configFields: [
      { key: 'api_secret', label: 'API Secret', placeholder: '••••••••••••••••', secret: true,
        help: 'GA4 Admin → Data Streams → your stream → Measurement Protocol API secrets → Create. Never shown to customers.' },
    ],
    defaultEvents: ['order.paid', 'order.created'],
    docsUrl: 'https://developers.google.com/analytics/devguides/collection/protocol/ga4',
    features: [
      'Server-side Measurement Protocol — no client snippet needed',
      'Maps order.paid → purchase, order.created → begin_checkout, returns → refund',
      'Per-currency revenue + items[] passthrough (up to 50 per event)',
    ],
  },
  {
    type: 'mixpanel', kind: 'apiconn', category: 'analytics', country: 'global',
    name: 'Mixpanel',
    description: 'Product analytics & user behavior tracking.',
    available: true, icon: 'mixpanel',
    primaryLabel: 'Project Token',
    primaryPlaceholder: '32-character hex token',
    primaryHelp: 'Mixpanel Project Settings → Access Keys → Project Token.',
    configFields: [],
    defaultEvents: [],  // empty = all events
    docsUrl: 'https://docs.mixpanel.com/docs/tracking-methods/sdks/server-sdks',
    features: [
      'Forwards every CRM event with its native name (e.g. "order.paid")',
      'distinct_id mapped from CRM customer id (or email / anon-id fallback)',
      '$insert_id set per event for idempotent ingestion',
    ],
  },

  // ── Marketing ────────────────────────────────────────────
  {
    type: 'mailchimp', kind: 'apiconn', category: 'marketing', country: 'global',
    name: 'Mailchimp',
    description: 'Subscribe new customers to a Mailchimp audience.',
    available: true, icon: 'mailchimp',
    primaryLabel: 'Audience (List) ID',
    primaryPlaceholder: 'a1b2c3d4e5',
    primaryHelp: 'Mailchimp Audience → Settings → Audience name and defaults → "Unique ID for audience".',
    configFields: [
      { key: 'api_key', label: 'API Key', placeholder: 'xxxxxxxxxxxxxxxx-us21', secret: true,
        help: 'Mailchimp Account → Extras → API Keys. Must include the -dcXX datacenter suffix.' },
    ],
    defaultEvents: ['customer.created'],
    docsUrl: 'https://mailchimp.com/developer/marketing/api/list-members/',
    features: [
      'Auto-subscribe on customer.created (other events are silently skipped)',
      'Splits name into FNAME / LNAME merge fields',
      'Audience-level double-opt-in settings respected by Mailchimp',
    ],
  },
];

export const CONNECTOR_BY_TYPE = Object.fromEntries(CONNECTORS.map(c => [c.type, c]));
