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
};

// Order shown in the Header "Product" dropdown and the in-page "Explore" links.
export const PRODUCT_SLUGS = ['database', 'auth', 'storage', 'automations', 'email', 'realtime'];

export const PRODUCT_NAV = PRODUCT_SLUGS.map(slug => ({ slug, Icon: PRODUCTS[slug].Icon }));
