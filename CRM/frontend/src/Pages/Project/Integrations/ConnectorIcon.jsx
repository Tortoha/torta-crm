import { BracketsAngle, Briefcase } from '@phosphor-icons/react';

// Inline brand SVG marks for marketplace cards. Each mark fits a 24×24 viewBox
// and uses the real brand palette so the row reads as the actual product
// instantly. We don't pull a logo CDN — these are simplified-but-faithful
// reproductions (text glyph + brand colour) so they survive offline + dark
// modes and never trip on tracker-blocking.

function SlackMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
    <rect x="3"  y="10"   width="6"   height="2.5" rx="1.25" fill="#36C5F0" />
    <rect x="10" y="3"    width="2.5" height="6"   rx="1.25" fill="#2EB67D" />
    <rect x="15" y="11.5" width="6"   height="2.5" rx="1.25" fill="#ECB22E" />
    <rect x="11.5" y="15" width="2.5" height="6"   rx="1.25" fill="#E01E5A" />
  </svg>
); }
function DiscordMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="#5865F2">
    <path d="M19.27 5.33A17.7 17.7 0 0 0 14.91 4l-.21.42a16.4 16.4 0 0 0-5.4 0L9.09 4a17.7 17.7 0 0 0-4.36 1.33C2.05 9.13 1.32 12.83 1.68 16.5c1.85 1.36 3.65 2.18 5.42 2.71l.42-.6c-.6-.21-1.18-.46-1.74-.75.15-.11.3-.22.43-.34a13.6 13.6 0 0 0 11.58 0c.13.12.28.23.43.34-.56.29-1.14.54-1.74.75l.42.6c1.77-.53 3.57-1.35 5.42-2.71.42-4.27-.7-7.94-3.05-11.17ZM8.52 14.5c-1 0-1.83-.93-1.83-2.07 0-1.14.81-2.07 1.83-2.07s1.85.94 1.83 2.07c0 1.14-.81 2.07-1.83 2.07Zm6.96 0c-1 0-1.83-.93-1.83-2.07 0-1.14.81-2.07 1.83-2.07s1.85.94 1.83 2.07c0 1.14-.81 2.07-1.83 2.07Z"/>
  </svg>
); }
function ZapierMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <circle cx="12" cy="12" r="9" fill="#FF4F00" />
    <path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    <path d="M7 7l10 10M17 7L7 17"  stroke="#fff" strokeWidth="2" strokeLinecap="round" />
  </svg>
); }

// 1C: yellow rounded square with red "1С" + the iconic red colon dot. Russian
// "С" (cyrillic) intentional — 1С Бухгалтерия always renders with the cyrillic
// glyph in its own marketing.
function OneCMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <rect width="24" height="24" rx="5" fill="#FFD23F"/>
    <text x="11" y="16" textAnchor="middle" fontFamily="Arial, sans-serif"
      fontSize="11" fontWeight="800" fill="#B30000" letterSpacing="-0.5">1С</text>
    <circle cx="19" cy="9" r="1.5" fill="#B30000" />
  </svg>
); }

// Kompra: KZ brand green with a K monogram (their actual mark is a stylised
// "K" inside a rounded shield — close enough for a card-size badge).
function KompraMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <rect width="24" height="24" rx="6" fill="#00A651"/>
    <path d="M7 6v12M7 12l5-6M7 12l5 6" stroke="#fff" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>
); }

// QuickBooks: green circle with the famous lowercase "qb" wordmark.
function QuickbooksMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <circle cx="12" cy="12" r="11" fill="#2CA01C"/>
    <text x="12" y="16.5" textAnchor="middle"
      fontFamily="Helvetica, Arial, sans-serif"
      fontSize="11" fontWeight="700" fill="#fff" fontStyle="italic">qb</text>
  </svg>
); }

// Xero: blue circle with the looping single-stroke X mark. We approximate
// the loop using two crossing arcs.
function XeroMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <circle cx="12" cy="12" r="11" fill="#13B5EA"/>
    <path d="M8 8l8 8M16 8l-8 8" stroke="#fff" strokeWidth="2.2"
      strokeLinecap="round" />
  </svg>
); }

// DATEV: dark-blue square with the wordmark.
function DatevMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <rect width="24" height="24" rx="4" fill="#0072CE"/>
    <text x="12" y="15.5" textAnchor="middle"
      fontFamily="Helvetica, Arial, sans-serif"
      fontSize="6.2" fontWeight="800" fill="#fff" letterSpacing="0.3">DATEV</text>
  </svg>
); }

function GA4Mark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <path d="M6 18V12M12 18V6M18 18v-3" stroke="#F9AB00" strokeWidth="3"
      strokeLinecap="round" fill="none"/>
    <circle cx="12" cy="6" r="2" fill="#F9AB00" />
  </svg>
); }
function MixpanelMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <circle cx="12" cy="12" r="11" fill="#7856FF"/>
    <circle cx="8"  cy="12" r="2" fill="#fff" />
    <circle cx="13" cy="12" r="2" fill="#fff" />
    <circle cx="18" cy="12" r="2" fill="#fff" />
  </svg>
); }
function MailchimpMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <circle cx="12" cy="12" r="11" fill="#FFE01B"/>
    <path d="M8 14c0-3 1.5-5 4-5s4 2 4 5" stroke="#241C15" strokeWidth="1.6"
      fill="none" strokeLinecap="round" />
    <circle cx="10" cy="10" r="0.9" fill="#241C15" />
    <circle cx="14" cy="10" r="0.9" fill="#241C15" />
  </svg>
); }

const ICON_MAP = {
  webhook:    () => <BracketsAngle size={22} weight="bold" color="#0071E3" />,
  slack:      SlackMark,
  discord:    DiscordMark,
  zapier:     ZapierMark,
  '1c':       OneCMark,
  kompra:     KompraMark,
  quickbooks: QuickbooksMark,
  xero:       XeroMark,
  datev:      DatevMark,
  ga4:        GA4Mark,
  mixpanel:   MixpanelMark,
  mailchimp:  MailchimpMark,
};

export default function ConnectorIcon({ icon }) {
  const Comp = ICON_MAP[icon];
  if (Comp) return <Comp />;
  return <Briefcase size={22} weight="bold" />;
}
