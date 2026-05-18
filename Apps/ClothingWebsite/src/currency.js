/**
 * Storefront currency utilities — mirror of CRM's Utils/currency.js.
 *
 * The shop's currency comes from the project config (`client.config.get()`)
 * once at app bootstrap. We stash it in a module-level variable so every
 * `fmtMoney(n)` call across the storefront picks up the merchant's
 * chosen currency without prop-drilling.
 *
 * Usage in App.jsx:
 *
 *   import { setShopCurrency } from './currency';
 *   useEffect(() => {
 *     client.config.get().then(r => setShopCurrency(r.data?.currency));
 *   }, []);
 *
 * Usage anywhere else:
 *
 *   import { fmtMoney } from './currency';
 *   <span>{fmtMoney(item.price)}</span>
 */

const CURRENCIES = {
  // prefix-symbol currencies
  USD: { symbol: '$',   position: 'prefix', decimals: 2 },
  EUR: { symbol: '€',   position: 'prefix', decimals: 2 },
  GBP: { symbol: '£',   position: 'prefix', decimals: 2 },
  JPY: { symbol: '¥',   position: 'prefix', decimals: 0 },
  CNY: { symbol: '¥',   position: 'prefix', decimals: 2 },
  CHF: { symbol: 'Fr.', position: 'prefix', decimals: 2 },
  CAD: { symbol: 'C$',  position: 'prefix', decimals: 2 },
  AUD: { symbol: 'A$',  position: 'prefix', decimals: 2 },
  NZD: { symbol: 'NZ$', position: 'prefix', decimals: 2 },
  SGD: { symbol: 'S$',  position: 'prefix', decimals: 2 },
  HKD: { symbol: 'HK$', position: 'prefix', decimals: 2 },
  INR: { symbol: '₹',   position: 'prefix', decimals: 2 },
  KRW: { symbol: '₩',   position: 'prefix', decimals: 0 },
  IDR: { symbol: 'Rp',  position: 'prefix', decimals: 0 },
  THB: { symbol: '฿',   position: 'prefix', decimals: 2 },
  MYR: { symbol: 'RM',  position: 'prefix', decimals: 2 },
  PHP: { symbol: '₱',   position: 'prefix', decimals: 2 },
  ILS: { symbol: '₪',   position: 'prefix', decimals: 2 },
  BRL: { symbol: 'R$',  position: 'prefix', decimals: 2 },
  MXN: { symbol: 'MX$', position: 'prefix', decimals: 2 },
  ARS: { symbol: 'AR$', position: 'prefix', decimals: 2 },
  CLP: { symbol: 'CLP$',position: 'prefix', decimals: 0 },
  COP: { symbol: 'COL$',position: 'prefix', decimals: 2 },
  ZAR: { symbol: 'R',   position: 'prefix', decimals: 2 },
  EGP: { symbol: 'E£',  position: 'prefix', decimals: 2 },
  NGN: { symbol: '₦',   position: 'prefix', decimals: 2 },

  // suffix-symbol currencies (CIS, EU non-Euro, ME, VND)
  VND: { symbol: '₫',   position: 'suffix', decimals: 0 },
  AED: { symbol: 'د.إ', position: 'suffix', decimals: 2 },
  SAR: { symbol: '﷼',   position: 'suffix', decimals: 2 },
  TRY: { symbol: '₺',   position: 'suffix', decimals: 2 },
  PLN: { symbol: 'zł',  position: 'suffix', decimals: 2 },
  CZK: { symbol: 'Kč',  position: 'suffix', decimals: 2 },
  HUF: { symbol: 'Ft',  position: 'suffix', decimals: 0 },
  RON: { symbol: 'lei', position: 'suffix', decimals: 2 },
  BGN: { symbol: 'лв',  position: 'suffix', decimals: 2 },
  SEK: { symbol: 'kr',  position: 'suffix', decimals: 2 },
  NOK: { symbol: 'kr',  position: 'suffix', decimals: 2 },
  DKK: { symbol: 'kr',  position: 'suffix', decimals: 2 },
  ISK: { symbol: 'kr',  position: 'suffix', decimals: 0 },
  KZT: { symbol: '₸',   position: 'suffix', decimals: 2 },
  RUB: { symbol: '₽',   position: 'suffix', decimals: 2 },
  UAH: { symbol: '₴',   position: 'suffix', decimals: 2 },
  BYN: { symbol: 'Br',  position: 'suffix', decimals: 2 },
  KGS: { symbol: 'с',   position: 'suffix', decimals: 2 },
  UZS: { symbol: "so'm",position: 'suffix', decimals: 0 },
  TJS: { symbol: 'SM',  position: 'suffix', decimals: 2 },
  TMT: { symbol: 'm',   position: 'suffix', decimals: 2 },
  AZN: { symbol: '₼',   position: 'suffix', decimals: 2 },
  GEL: { symbol: '₾',   position: 'suffix', decimals: 2 },
  AMD: { symbol: '֏',   position: 'suffix', decimals: 2 },
};

// Module-level holder — set once at app boot via `setShopCurrency()`.
// Default USD so first paint doesn't show "undefined".
let __SHOP_CURRENCY = 'USD';

/** Sync the storefront's currency. Call once at app init from a
 *  `client.config.get()` response. Safe to call again on hot-reload. */
export function setShopCurrency(code) {
  __SHOP_CURRENCY = String(code || 'USD').toUpperCase();
}

/** Return the currency code currently active (for callers that need
 *  the raw string — e.g. dispatching to a different formatter for the
 *  cart's per-item delta chips). */
export function getShopCurrency() {
  return __SHOP_CURRENCY;
}

/** Format a number as the shop's currency string.
 *    fmtMoney(1234.5)  // "$1,234.50" / "1,234.50 ₸" / "¥1,235" (JPY)
 *
 *  Options:
 *    decimals — override the currency's default (used for whole-price
 *               chips where "$30" reads cleaner than "$30.00")
 *    signed   — render leading + for positives (used in price-delta
 *               chips inside cart-item modifiers: "+$2" / "-$1")
 */
export function fmtMoney(amount, opts = {}) {
  const meta = CURRENCIES[__SHOP_CURRENCY] || CURRENCIES.USD;
  const n = Number(amount);
  const safe = Number.isFinite(n) ? n : 0;
  const decimals = (opts.decimals !== undefined) ? opts.decimals : meta.decimals;

  // Thousands separators with `,`, fraction with `.`. Same rule as the
  // CRM-side util — locale-agnostic so a USD merchant viewing the
  // storefront in en-DE locale still sees `$1,234.50`.
  const fixed = safe.toFixed(decimals);
  const [intPart, fracPart] = fixed.split('.');
  const sign = intPart.startsWith('-') ? '-' : '';
  const grouped = intPart.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let numStr = fracPart ? `${sign}${grouped}.${fracPart}` : `${sign}${grouped}`;

  if (opts.signed && safe > 0) numStr = '+' + numStr;

  if (meta.position === 'suffix') return `${numStr} ${meta.symbol}`;
  // prefix — keep the sign with the number, not before the symbol:
  // "-$100" rather than "$-100".
  if (safe < 0 && !opts.signed) {
    return `-${meta.symbol}${numStr.replace(/^-/, '')}`;
  }
  if (opts.signed && safe > 0) {
    return `+${meta.symbol}${numStr.replace(/^\+/, '')}`;
  }
  return `${meta.symbol}${numStr}`;
}
