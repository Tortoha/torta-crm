/**
 * Currency utilities — single source of truth for money formatting.
 *
 * Why a custom util instead of `Intl.NumberFormat`?
 * - `Intl` is locale-driven, but we let merchants pick any currency
 *   independently of their browser locale (Kazakh merchant selling in
 *   USD must see `$100.00`, not `100,00 $US`).
 * - Custom symbol-position table — `$100` vs `100₸` is what real shops
 *   actually print on receipts. `Intl` insists on the CLDR rules and
 *   gives you `US$100.00` or `100,00 ₸` (with awkward spacing).
 *
 * Usage:
 *   import { formatMoney, CURRENCIES, getCurrencyMeta } from './currency';
 *   formatMoney(1234.5, 'USD')   // → "$1,234.50"
 *   formatMoney(1234.5, 'KZT')   // → "1,234.50 ₸"
 *   formatMoney(1234,    'JPY')  // → "¥1,234"   (zero decimals)
 */

// ── Currency table ────────────────────────────────────────────────────────
//
// `position` — where the symbol goes:
//   'prefix' → tight before the amount   "$100.00"
//   'suffix' → space before symbol after "100.00 ₸"
//
// `decimals` — fraction digits. Most are 2; JPY/KRW/HUF/UZS use 0
// (whole-yen / whole-won) because the smallest unit IS the major one.
//
// Sorted by region/popularity for the picker — keep this order; the
// Settings dropdown renders them top-to-bottom in this exact sequence.

export const CURRENCIES = [
  // ── Major reserve currencies ────────────────────────────────────────────
  { code: 'USD', symbol: '$',   position: 'prefix', decimals: 2, name: 'US Dollar' },
  { code: 'EUR', symbol: '€',   position: 'prefix', decimals: 2, name: 'Euro' },
  { code: 'GBP', symbol: '£',   position: 'prefix', decimals: 2, name: 'British Pound' },
  { code: 'JPY', symbol: '¥',   position: 'prefix', decimals: 0, name: 'Japanese Yen' },
  { code: 'CNY', symbol: '¥',   position: 'prefix', decimals: 2, name: 'Chinese Yuan' },
  { code: 'CHF', symbol: 'Fr.', position: 'prefix', decimals: 2, name: 'Swiss Franc' },
  { code: 'CAD', symbol: 'C$',  position: 'prefix', decimals: 2, name: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$',  position: 'prefix', decimals: 2, name: 'Australian Dollar' },
  { code: 'NZD', symbol: 'NZ$', position: 'prefix', decimals: 2, name: 'New Zealand Dollar' },
  { code: 'SGD', symbol: 'S$',  position: 'prefix', decimals: 2, name: 'Singapore Dollar' },
  { code: 'HKD', symbol: 'HK$', position: 'prefix', decimals: 2, name: 'Hong Kong Dollar' },

  // ── Asia / Middle East ──────────────────────────────────────────────────
  { code: 'INR', symbol: '₹',   position: 'prefix', decimals: 2, name: 'Indian Rupee' },
  { code: 'KRW', symbol: '₩',   position: 'prefix', decimals: 0, name: 'South Korean Won' },
  { code: 'IDR', symbol: 'Rp',  position: 'prefix', decimals: 0, name: 'Indonesian Rupiah' },
  { code: 'THB', symbol: '฿',   position: 'prefix', decimals: 2, name: 'Thai Baht' },
  { code: 'MYR', symbol: 'RM',  position: 'prefix', decimals: 2, name: 'Malaysian Ringgit' },
  { code: 'PHP', symbol: '₱',   position: 'prefix', decimals: 2, name: 'Philippine Peso' },
  { code: 'VND', symbol: '₫',   position: 'suffix', decimals: 0, name: 'Vietnamese Dong' },
  { code: 'AED', symbol: 'د.إ', position: 'suffix', decimals: 2, name: 'UAE Dirham' },
  { code: 'SAR', symbol: '﷼',   position: 'suffix', decimals: 2, name: 'Saudi Riyal' },
  { code: 'ILS', symbol: '₪',   position: 'prefix', decimals: 2, name: 'Israeli Shekel' },
  { code: 'TRY', symbol: '₺',   position: 'suffix', decimals: 2, name: 'Turkish Lira' },

  // ── Latin America ───────────────────────────────────────────────────────
  { code: 'BRL', symbol: 'R$',  position: 'prefix', decimals: 2, name: 'Brazilian Real' },
  { code: 'MXN', symbol: 'MX$', position: 'prefix', decimals: 2, name: 'Mexican Peso' },
  { code: 'ARS', symbol: 'AR$', position: 'prefix', decimals: 2, name: 'Argentine Peso' },
  { code: 'CLP', symbol: 'CLP$',position: 'prefix', decimals: 0, name: 'Chilean Peso' },
  { code: 'COP', symbol: 'COL$',position: 'prefix', decimals: 2, name: 'Colombian Peso' },

  // ── Africa ──────────────────────────────────────────────────────────────
  { code: 'ZAR', symbol: 'R',   position: 'prefix', decimals: 2, name: 'South African Rand' },
  { code: 'EGP', symbol: 'E£',  position: 'prefix', decimals: 2, name: 'Egyptian Pound' },
  { code: 'NGN', symbol: '₦',   position: 'prefix', decimals: 2, name: 'Nigerian Naira' },

  // ── EU (non-Euro) ───────────────────────────────────────────────────────
  { code: 'PLN', symbol: 'zł',  position: 'suffix', decimals: 2, name: 'Polish Złoty' },
  { code: 'CZK', symbol: 'Kč',  position: 'suffix', decimals: 2, name: 'Czech Koruna' },
  { code: 'HUF', symbol: 'Ft',  position: 'suffix', decimals: 0, name: 'Hungarian Forint' },
  { code: 'RON', symbol: 'lei', position: 'suffix', decimals: 2, name: 'Romanian Leu' },
  { code: 'BGN', symbol: 'лв',  position: 'suffix', decimals: 2, name: 'Bulgarian Lev' },
  { code: 'SEK', symbol: 'kr',  position: 'suffix', decimals: 2, name: 'Swedish Krona' },
  { code: 'NOK', symbol: 'kr',  position: 'suffix', decimals: 2, name: 'Norwegian Krone' },
  { code: 'DKK', symbol: 'kr',  position: 'suffix', decimals: 2, name: 'Danish Krone' },
  { code: 'ISK', symbol: 'kr',  position: 'suffix', decimals: 0, name: 'Icelandic Króna' },

  // ── CIS / Central Asia (важно для Казахстана и Russian-speaking markets) ─
  { code: 'KZT', symbol: '₸',   position: 'suffix', decimals: 2, name: 'Kazakhstani Tenge' },
  { code: 'RUB', symbol: '₽',   position: 'suffix', decimals: 2, name: 'Russian Ruble' },
  { code: 'UAH', symbol: '₴',   position: 'suffix', decimals: 2, name: 'Ukrainian Hryvnia' },
  { code: 'BYN', symbol: 'Br',  position: 'suffix', decimals: 2, name: 'Belarusian Ruble' },
  { code: 'KGS', symbol: 'с',   position: 'suffix', decimals: 2, name: 'Kyrgyzstani Som' },
  { code: 'UZS', symbol: "so'm",position: 'suffix', decimals: 0, name: 'Uzbek Som' },
  { code: 'TJS', symbol: 'SM',  position: 'suffix', decimals: 2, name: 'Tajik Somoni' },
  { code: 'TMT', symbol: 'm',   position: 'suffix', decimals: 2, name: 'Turkmen Manat' },
  { code: 'AZN', symbol: '₼',   position: 'suffix', decimals: 2, name: 'Azerbaijani Manat' },
  { code: 'GEL', symbol: '₾',   position: 'suffix', decimals: 2, name: 'Georgian Lari' },
  { code: 'AMD', symbol: '֏',   position: 'suffix', decimals: 2, name: 'Armenian Dram' },
];

// Fast lookup map — built once at module load.
const _BY_CODE = Object.fromEntries(CURRENCIES.map(c => [c.code, c]));

// Fallback used when an unknown / missing code arrives. Keeps formatters
// from crashing on stale data; just renders as USD with the bare ISO code.
const _FALLBACK = { code: 'USD', symbol: '$', position: 'prefix', decimals: 2, name: 'US Dollar' };


/**
 * Look up currency metadata. Always returns an object — falls back to
 * USD if the code is unknown so callers never have to null-check.
 */
export function getCurrencyMeta(code) {
  if (!code) return _FALLBACK;
  return _BY_CODE[String(code).toUpperCase()] || _FALLBACK;
}


/**
 * Format a number as money in the project's currency.
 *
 *   formatMoney(1234.5,  'USD')                  // "$1,234.50"
 *   formatMoney(1234.5,  'KZT')                  // "1,234.50 ₸"
 *   formatMoney(1234,    'JPY')                  // "¥1,234"
 *   formatMoney(-50,     'EUR')                  // "-€50.00"
 *   formatMoney(null,    'USD')                  // "$0.00"
 *   formatMoney(1234,    'USD', { decimals: 0 }) // "$1,234"
 *   formatMoney(0.5,     'USD', { compact: true }) // "$0.50"  (no truncation)
 *   formatMoney(1234567, 'USD', { compact: true }) // "$1.2M"
 *
 * Options:
 *   decimals — override the currency's default decimals
 *   compact  — abbreviate large numbers (1.2K / 1.2M / 1.2B)
 *   signed   — always render leading + for positive amounts (used in
 *              KPI deltas like "+$120")
 *   noSymbol — return just the formatted number, no currency symbol
 *              (rare; used in input fields where the symbol is shown
 *              separately as an adornment)
 */
export function formatMoney(amount, code, opts = {}) {
  const meta = getCurrencyMeta(code);
  const n = Number(amount);
  const safe = Number.isFinite(n) ? n : 0;

  const decimals = (opts.decimals !== undefined) ? opts.decimals : meta.decimals;

  // Compact mode for charts / KPIs — never go below 0.01 precision
  // when the source value is < 1000 so prices like "$2.50" don't get
  // shortened to "$3".
  let numStr;
  if (opts.compact && Math.abs(safe) >= 1000) {
    numStr = _formatCompact(safe);
  } else {
    numStr = _formatWithGrouping(safe, decimals);
  }

  if (opts.signed && safe > 0) numStr = '+' + numStr;

  if (opts.noSymbol) return numStr;

  if (meta.position === 'suffix') {
    // The minus sign stays with the number, not before the symbol —
    // "-100 ₸" not "100 ₸-"
    return `${numStr} ${meta.symbol}`;
  }
  // prefix — handle negative gracefully: "-$100" not "$-100"
  if (safe < 0 && !opts.signed) {
    return `-${meta.symbol}${numStr.replace(/^-/, '')}`;
  }
  if (opts.signed && safe > 0) {
    return `+${meta.symbol}${numStr.replace(/^\+/, '')}`;
  }
  return `${meta.symbol}${numStr}`;
}

/**
 * Just the symbol — used as an input adornment ("$" inside the price
 * input box). Returns `{ symbol, position }` so the caller can put it
 * on the correct side of the input.
 */
export function currencyAdornment(code) {
  const meta = getCurrencyMeta(code);
  return { symbol: meta.symbol, position: meta.position };
}

/**
 * Just the code → human label, used in dropdown options.
 *   currencyLabel('KZT') → "KZT — Kazakhstani Tenge (₸)"
 */
export function currencyLabel(code) {
  const meta = getCurrencyMeta(code);
  return `${meta.code} — ${meta.name} (${meta.symbol})`;
}

// ── internal helpers ──────────────────────────────────────────────────────

function _formatWithGrouping(n, decimals) {
  // toFixed handles rounding; then we insert thousands separators by
  // splitting on the dot. Locale-agnostic — we always use `,` for
  // groups and `.` for fractions. Matches what merchants expect when
  // they paste prices from spreadsheets and what most accounting
  // exports use.
  const fixed = n.toFixed(decimals);
  const [intPart, fracPart] = fixed.split('.');
  const sign = intPart.startsWith('-') ? '-' : '';
  const grouped = intPart.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fracPart ? `${sign}${grouped}.${fracPart}` : `${sign}${grouped}`;
}

function _formatCompact(n) {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9)  return sign + (abs / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (abs >= 1e6)  return sign + (abs / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (abs >= 1e3)  return sign + (abs / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return sign + abs.toFixed(0);
}
