import { BracketsAngle, ChatCircleDots, Briefcase, ChartLine, Envelope, Lightning } from '@phosphor-icons/react';

// Tiny brand-coloured SVG marks for the marketplace cards. Inline so we don't
// pull in iconify; each one is a simplified logo kept in a 24×24 viewBox.

function SlackMark()   { return (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
    <rect x="3"  y="10" width="6" height="2.5" rx="1.25" fill="#36C5F0" />
    <rect x="10" y="3"  width="2.5" height="6" rx="1.25" fill="#2EB67D" />
    <rect x="15" y="11.5" width="6" height="2.5" rx="1.25" fill="#ECB22E" />
    <rect x="11.5" y="15" width="2.5" height="6" rx="1.25" fill="#E01E5A" />
  </svg>
); }
function DiscordMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="#5865F2">
    <path d="M19.27 5.33A17.7 17.7 0 0 0 14.91 4l-.21.42a16.4 16.4 0 0 0-5.4 0L9.09 4a17.7 17.7 0 0 0-4.36 1.33C2.05 9.13 1.32 12.83 1.68 16.5c1.85 1.36 3.65 2.18 5.42 2.71l.42-.6c-.6-.21-1.18-.46-1.74-.75.15-.11.3-.22.43-.34a13.6 13.6 0 0 0 11.58 0c.13.12.28.23.43.34-.56.29-1.14.54-1.74.75l.42.6c1.77-.53 3.57-1.35 5.42-2.71.42-4.27-.7-7.94-3.05-11.17ZM8.52 14.5c-1 0-1.83-.93-1.83-2.07 0-1.14.81-2.07 1.83-2.07s1.85.94 1.83 2.07c0 1.14-.81 2.07-1.83 2.07Zm6.96 0c-1 0-1.83-.93-1.83-2.07 0-1.14.81-2.07 1.83-2.07s1.85.94 1.83 2.07c0 1.14-.81 2.07-1.83 2.07Z"/>
  </svg>
); }
function ZapierMark()  { return (
  <svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="9" fill="#FF4F00"/>
    <path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
    <path d="M7 7l10 10M17 7L7 17" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
  </svg>
); }
function OneCMark()    { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <rect width="24" height="24" rx="5" fill="#FFD23F"/>
    <text x="12" y="16" textAnchor="middle" fontFamily="Arial, sans-serif"
      fontSize="11" fontWeight="800" fill="#7C0000">1С</text>
  </svg>
); }
function KompraMark()  { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <rect width="24" height="24" rx="5" fill="#00A651"/>
    <text x="12" y="16" textAnchor="middle" fontFamily="Arial, sans-serif"
      fontSize="10" fontWeight="800" fill="#fff">KZ</text>
  </svg>
); }
function QuickbooksMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <circle cx="12" cy="12" r="10" fill="#2CA01C"/>
    <text x="12" y="16" textAnchor="middle" fontFamily="Arial, sans-serif"
      fontSize="10" fontWeight="800" fill="#fff">qb</text>
  </svg>
); }
function XeroMark()    { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <circle cx="12" cy="12" r="10" fill="#13B5EA"/>
    <text x="12" y="16" textAnchor="middle" fontFamily="Arial, sans-serif"
      fontSize="9" fontWeight="800" fill="#fff">X</text>
  </svg>
); }
function DatevMark()   { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <rect width="24" height="24" rx="5" fill="#0072CE"/>
    <text x="12" y="16" textAnchor="middle" fontFamily="Arial, sans-serif"
      fontSize="9" fontWeight="800" fill="#fff">DATEV</text>
  </svg>
); }
function GA4Mark()     { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <path d="M12 4v16M6 10v10M18 14v6" stroke="#F9AB00" strokeWidth="3" strokeLinecap="round" fill="none"/>
  </svg>
); }
function MixpanelMark(){ return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <circle cx="12" cy="12" r="10" fill="#7856FF"/>
    <text x="12" y="16" textAnchor="middle" fontFamily="Arial, sans-serif"
      fontSize="9" fontWeight="800" fill="#fff">mp</text>
  </svg>
); }
function MailchimpMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <circle cx="12" cy="12" r="10" fill="#FFE01B"/>
    <text x="12" y="16" textAnchor="middle" fontFamily="Arial, sans-serif"
      fontSize="11" fontWeight="900" fill="#241C15">M</text>
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
