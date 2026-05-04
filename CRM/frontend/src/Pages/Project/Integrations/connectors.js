// Catalog of all connectors shown in the marketplace. `available: false` cards
// render as "Coming soon" placeholders — the real backend implementation lands
// when the first paying customer asks for it (per-country accounting tools).

export const CONNECTOR_CATEGORIES = [
  { key: 'popular',    label: 'Popular' },
  { key: 'accounting', label: 'Accounting' },
  { key: 'analytics',  label: 'Analytics' },
  { key: 'marketing',  label: 'Marketing' },
];

export const CONNECTORS = [
  // Popular
  {
    type: 'webhook', category: 'popular',
    name: 'Custom Webhook',
    description: 'POST every event to your own server URL.',
    available: true,
    icon: 'webhook',
  },
  {
    type: 'slack', category: 'popular',
    name: 'Slack',
    description: 'Get a Slack message every time something happens.',
    available: true,
    icon: 'slack',
  },
  {
    type: 'discord', category: 'popular',
    name: 'Discord',
    description: 'Post events to a Discord channel via webhook.',
    available: true,
    icon: 'discord',
  },
  {
    type: 'zapier', category: 'popular',
    name: 'Zapier',
    description: 'Connect to 5000+ apps via Zapier triggers.',
    available: false,
    icon: 'zapier',
  },

  // Accounting
  {
    type: '1c', category: 'accounting',
    name: '1C Бухгалтерия',
    description: 'Sync orders & invoices into 1C (Russia / CIS).',
    available: false,
    icon: '1c',
  },
  {
    type: 'kompra', category: 'accounting',
    name: 'Kompra',
    description: 'ЭСФ для Казахстана (electronic invoices).',
    available: false,
    icon: 'kompra',
  },
  {
    type: 'quickbooks', category: 'accounting',
    name: 'QuickBooks',
    description: 'Accounting for US / Canada small businesses.',
    available: false,
    icon: 'quickbooks',
  },
  {
    type: 'xero', category: 'accounting',
    name: 'Xero',
    description: 'Accounting for AU / UK / NZ businesses.',
    available: false,
    icon: 'xero',
  },
  {
    type: 'datev', category: 'accounting',
    name: 'DATEV',
    description: 'German accounting standard for SMBs.',
    available: false,
    icon: 'datev',
  },

  // Analytics
  {
    type: 'ga4', category: 'analytics',
    name: 'Google Analytics 4',
    description: 'Stream purchase events to GA4 for funnel analysis.',
    available: false,
    icon: 'ga4',
  },
  {
    type: 'mixpanel', category: 'analytics',
    name: 'Mixpanel',
    description: 'Product analytics & user behavior tracking.',
    available: false,
    icon: 'mixpanel',
  },

  // Marketing
  {
    type: 'mailchimp', category: 'marketing',
    name: 'Mailchimp',
    description: 'Add new customers to a Mailchimp audience.',
    available: false,
    icon: 'mailchimp',
  },
];

export const CONNECTOR_BY_TYPE = Object.fromEntries(CONNECTORS.map(c => [c.type, c]));
