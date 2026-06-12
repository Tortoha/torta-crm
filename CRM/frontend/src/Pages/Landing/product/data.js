// Per-slug config for the product feature pages. Text lives in i18n
// (locales/{en,ru}/product.json under `product.<slug>.*`); this file only
// carries the things JSON can't hold — Phosphor icon components, the doc
// link, and the nav order. One <ProductPage> renders all six from here.

import {
  Database, Lock, HardDrives, Lightning, EnvelopeSimple, Broadcast,
  Package, ShoppingCart, UsersThree, Star, CalendarCheck, ChartLine,
  DeviceMobile, GoogleLogo, Key, Monitor, UserCircle,
  ImageSquare, FileArrowDown, Gauge,
  ChatsCircle, Plugs, Bell, ListChecks,
  Receipt, SealCheck, Code, ClockCountdown, ChartLineUp,
  ChatCircle, Cursor, PencilSimple, NavigationArrow,
  TreeStructure, Barcode, Warehouse, Tag, Stack, CalendarBlank, FileZip, ArrowsClockwise,
} from '@phosphor-icons/react';

export const PRODUCTS = {
  database: {
    Icon: Database, docsTo: '/docs/cheatsheet',
    cardIcons: [Package, ShoppingCart, UsersThree, Star, CalendarCheck, ChartLine],
  },
  auth: {
    Icon: Lock, docsTo: '/docs/auth',
    cardIcons: [EnvelopeSimple, DeviceMobile, GoogleLogo, Key, Monitor, UserCircle],
  },
  storage: {
    Icon: HardDrives, docsTo: '/docs/catalog',
    cardIcons: [ImageSquare, Star, UserCircle, EnvelopeSimple, FileArrowDown, Gauge],
  },
  automations: {
    Icon: Lightning, docsTo: '/docs/integrations',
    cardIcons: [Lightning, ChatsCircle, Plugs, Bell, Broadcast, ListChecks],
  },
  email: {
    Icon: EnvelopeSimple, docsTo: '/docs/emails',
    cardIcons: [Receipt, Broadcast, SealCheck, Code, ClockCountdown, ChartLineUp],
  },
  realtime: {
    Icon: Broadcast, docsTo: '/docs/chat',
    cardIcons: [UsersThree, Cursor, ChatCircle, PencilSimple, NavigationArrow, Lightning],
  },
  products: {
    Icon: Package, docsTo: '/docs/catalog',
    cardIcons: [TreeStructure, Barcode, Warehouse, ClockCountdown, Tag, Stack],
  },
  booking: {
    Icon: CalendarCheck, docsTo: '/docs/cheatsheet',
    cardIcons: [CalendarCheck, UsersThree, CalendarBlank, UserCircle, Stack, Code],
  },
  chat: {
    Icon: ChatsCircle, docsTo: '/docs/chat',
    cardIcons: [ChatsCircle, ChatCircle, Lightning, UserCircle, EnvelopeSimple, SealCheck],
  },
  digital: {
    Icon: FileArrowDown, docsTo: '/docs/catalog',
    cardIcons: [FileArrowDown, FileZip, EnvelopeSimple, ImageSquare, ShoppingCart, ArrowsClockwise],
  },
};

// All feature-page slugs — drives the in-page "Explore more" links + sitemap.
export const PRODUCT_SLUGS = ['database', 'products', 'booking', 'digital', 'chat', 'auth', 'storage', 'automations', 'email', 'realtime'];

// The landing Header splits the feature pages into two dropdowns by audience:
//   Product    — what you sell + how you talk to customers
//   Developers — the platform building blocks + the API page (/developers)
export const PRODUCT_NAV = ['products', 'booking', 'digital', 'chat', 'email']
  .map(slug => ({ slug, Icon: PRODUCTS[slug].Icon }));

export const DEVELOPER_NAV = [
  { slug: 'developers', Icon: Code },   // the API & SDK page at /developers
  ...['database', 'auth', 'storage', 'realtime', 'automations']
    .map(slug => ({ slug, Icon: PRODUCTS[slug].Icon })),
];
