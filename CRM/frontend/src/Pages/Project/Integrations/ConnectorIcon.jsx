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

// Conta Azul (BR): light-blue brand square + lowercase "ca" wordmark.
function ContaAzulMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <rect width="24" height="24" rx="5" fill="#19A0E2"/>
    <text x="12" y="16" textAnchor="middle"
      fontFamily="Helvetica, Arial, sans-serif"
      fontSize="11" fontWeight="800" fill="#fff" letterSpacing="-0.5">ca</text>
  </svg>
); }

// Nibo (BR): pink/magenta circle + "n" monogram (Nibo's brand mark is a
// minimalist n inside a rounded shape).
function NiboMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <circle cx="12" cy="12" r="11" fill="#E91F63"/>
    <text x="12" y="17" textAnchor="middle"
      fontFamily="Helvetica, Arial, sans-serif"
      fontSize="14" fontWeight="800" fill="#fff">n</text>
  </svg>
); }

// Contpaqi (MX): orange-red square + "Cp" monogram (Contpaqi's i-icon design).
function ContpaqiMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <rect width="24" height="24" rx="4" fill="#EE3E2C"/>
    <text x="12" y="16" textAnchor="middle"
      fontFamily="Helvetica, Arial, sans-serif"
      fontSize="9.5" fontWeight="800" fill="#fff" letterSpacing="-0.3">Cp</text>
  </svg>
); }

// Aspel (MX): blue square + "A" with the orange diagonal slash that Aspel
// uses across all its products (SAE/COI/NOI/BANCO).
function AspelMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <rect width="24" height="24" rx="4" fill="#003399"/>
    <text x="12" y="17" textAnchor="middle"
      fontFamily="Helvetica, Arial, sans-serif"
      fontSize="14" fontWeight="800" fill="#fff">A</text>
    <path d="M16 7l3 3" stroke="#FF8800" strokeWidth="2" strokeLinecap="round"/>
  </svg>
); }

// Tally Prime (IN): red rounded square + bold "T" — Tally's iconic red brand.
function TallyMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <rect width="24" height="24" rx="4" fill="#D52E2E"/>
    <text x="12" y="17" textAnchor="middle"
      fontFamily="Helvetica, Arial, sans-serif"
      fontSize="14" fontWeight="900" fill="#fff">T</text>
  </svg>
); }

// Zoho Books (IN/Global): blue square + the Zoho red "Z" — Zoho's family
// branding (Books/CRM/Mail all share this colour pair).
function ZohoMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <rect width="24" height="24" rx="4" fill="#226DB4"/>
    <text x="12" y="17" textAnchor="middle"
      fontFamily="Helvetica, Arial, sans-serif"
      fontSize="14" fontWeight="900" fill="#E42029">Z</text>
  </svg>
); }

// BAS Бухгалтерія (UA): yellow square + "BAS" wordmark in dark text — BAS
// kept the visual identity from its 1C-Ukraine fork (yellow stays).
function BasMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <rect width="24" height="24" rx="4" fill="#FFD23F"/>
    <text x="12" y="15" textAnchor="middle"
      fontFamily="Arial, sans-serif"
      fontSize="6.5" fontWeight="900" fill="#0057B8" letterSpacing="0.2">BAS</text>
  </svg>
); }

// 1C UZ — same yellow/red 1C palette as Russia, with "UZ" badge to disambiguate
// at a glance from the cis-region 1C card.
function OneCUzMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <rect width="24" height="24" rx="5" fill="#FFD23F"/>
    <text x="9.5" y="16" textAnchor="middle" fontFamily="Arial, sans-serif"
      fontSize="11" fontWeight="800" fill="#B30000" letterSpacing="-0.5">1С</text>
    <text x="18" y="20" textAnchor="middle" fontFamily="Arial, sans-serif"
      fontSize="5.5" fontWeight="800" fill="#0099B5">UZ</text>
  </svg>
); }

// Logo Tiger (TR): orange square + bold "L" — Logo's iconic orange used since
// the company was founded in Istanbul in 1984.
function LogoTigerMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <rect width="24" height="24" rx="4" fill="#FF6F00"/>
    <text x="12" y="17" textAnchor="middle"
      fontFamily="Helvetica, Arial, sans-serif"
      fontSize="13" fontWeight="900" fill="#fff">L</text>
  </svg>
); }

// Mikro Bulut (TR): green-to-blue gradient + "M" — modern cloud branding.
function MikroBulutMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <defs>
      <linearGradient id="mbGrad" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%"  stopColor="#00B96B"/>
        <stop offset="100%" stopColor="#0099D6"/>
      </linearGradient>
    </defs>
    <rect width="24" height="24" rx="4" fill="url(#mbGrad)"/>
    <text x="12" y="17" textAnchor="middle"
      fontFamily="Helvetica, Arial, sans-serif"
      fontSize="13" fontWeight="900" fill="#fff">M</text>
  </svg>
); }

// Comarch Optima (PL): the iconic Comarch red — bold "C" monogram.
function ComarchMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <rect width="24" height="24" rx="4" fill="#E20613"/>
    <text x="12" y="17" textAnchor="middle"
      fontFamily="Helvetica, Arial, sans-serif"
      fontSize="13" fontWeight="900" fill="#fff">C</text>
  </svg>
); }

// iFirma (PL): green circle + "iF" — iFirma's online-first brand colour.
function IFirmaMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <circle cx="12" cy="12" r="11" fill="#00A859"/>
    <text x="12" y="16" textAnchor="middle"
      fontFamily="Helvetica, Arial, sans-serif"
      fontSize="9.5" fontWeight="800" fill="#fff" letterSpacing="-0.3">iF</text>
  </svg>
); }

// Yonyou (CN): red square with the iconic 用 Hanzi — Yonyou's brand identity
// has used this glyph since the company was founded in Beijing in 1988.
function YonyouMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <rect width="24" height="24" rx="4" fill="#E60012"/>
    <text x="12" y="18" textAnchor="middle"
      fontFamily="'PingFang SC', 'Microsoft YaHei', sans-serif"
      fontSize="14" fontWeight="800" fill="#fff">用</text>
  </svg>
); }

// Freee (JP): light blue circle + "f" lowercase — Freee's web-app brand.
function FreeeMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <circle cx="12" cy="12" r="11" fill="#2DA9E2"/>
    <text x="12" y="17" textAnchor="middle"
      fontFamily="Helvetica, Arial, sans-serif"
      fontSize="14" fontWeight="800" fill="#fff">f</text>
  </svg>
); }

// Money Forward (JP): navy + green "MF" wordmark.
function MoneyForwardMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <rect width="24" height="24" rx="4" fill="#0F2B5B"/>
    <text x="12" y="15.5" textAnchor="middle"
      fontFamily="Helvetica, Arial, sans-serif"
      fontSize="8" fontWeight="900" fill="#7DBA39" letterSpacing="-0.3">MF</text>
  </svg>
); }

// Douzone (KR): blue square + "D" — Douzone Bizon Co. brand mark.
function DouzoneMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <rect width="24" height="24" rx="4" fill="#003C8A"/>
    <text x="12" y="17" textAnchor="middle"
      fontFamily="Helvetica, Arial, sans-serif"
      fontSize="14" fontWeight="900" fill="#fff">D</text>
  </svg>
); }

// Mekari Jurnal (ID): teal square + "J" — Jurnal is part of the Mekari family.
function MekariJurnalMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <rect width="24" height="24" rx="4" fill="#0EAFA9"/>
    <text x="12" y="17" textAnchor="middle"
      fontFamily="Helvetica, Arial, sans-serif"
      fontSize="14" fontWeight="900" fill="#fff">J</text>
  </svg>
); }

// FlowAccount (TH): orange-red square + lowercase "fl" — modern Thai SaaS.
function FlowAccountMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <rect width="24" height="24" rx="4" fill="#FF5722"/>
    <text x="12" y="16" textAnchor="middle"
      fontFamily="Helvetica, Arial, sans-serif"
      fontSize="10" fontWeight="800" fill="#fff" letterSpacing="-0.5">fl</text>
  </svg>
); }

// MISA SME (VN): red square + "M" — MISA JSC brand colour.
function MisaMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <rect width="24" height="24" rx="4" fill="#D71921"/>
    <text x="12" y="17" textAnchor="middle"
      fontFamily="Helvetica, Arial, sans-serif"
      fontSize="13" fontWeight="900" fill="#fff">M</text>
  </svg>
); }

// SQL Account (MY): dark blue circle + "SQL" wordmark.
function SqlAccountMark() { return (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <circle cx="12" cy="12" r="11" fill="#1B3A6B"/>
    <text x="12" y="15" textAnchor="middle"
      fontFamily="Helvetica, Arial, sans-serif"
      fontSize="6.5" fontWeight="900" fill="#fff" letterSpacing="0.3">SQL</text>
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
  conta_azul:  ContaAzulMark,
  nibo:        NiboMark,
  contpaqi:    ContpaqiMark,
  aspel:       AspelMark,
  tally:       TallyMark,
  zoho:        ZohoMark,
  bas:         BasMark,
  '1c_uz':     OneCUzMark,
  logo_tiger:  LogoTigerMark,
  mikro_bulut: MikroBulutMark,
  comarch:       ComarchMark,
  ifirma:        IFirmaMark,
  yonyou:        YonyouMark,
  freee:         FreeeMark,
  money_forward: MoneyForwardMark,
  douzone:       DouzoneMark,
  mekari_jurnal: MekariJurnalMark,
  flow_account:  FlowAccountMark,
  misa_sme:      MisaMark,
  sql_account:   SqlAccountMark,
};

export default function ConnectorIcon({ icon }) {
  const Comp = ICON_MAP[icon];
  if (Comp) return <Comp />;
  return <Briefcase size={22} weight="bold" />;
}
