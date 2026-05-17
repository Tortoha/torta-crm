// Project Analytics — the single long page that brings together every
// data signal across Products, Orders, Bookings, Reviews, Returns, etc.
// Each section is independent (its own period picker, fetch, skeleton)
// so a slow query in one card doesn't block the others.
//
// Design language mirrors Orders / Products / Auth Providers: clean rows,
// rounded `.crm-section`-style cards, soft shadows, blue accent only.
// Charts are inline SVG — no Recharts / Chart.js dependency, ~5KB of JS
// instead of ~150KB, and they hit pixel parity with the rest of the UI
// because the colours come from CSS variables.

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import {
  ChartLine, Users, MapPin, Star, ArrowUUpLeft,
  CalendarBlank, Package, Warning, Tag, GearSix, Funnel,
  DeviceMobile, Globe, MagnifyingGlass, Target,
  Eye, ShoppingCart, PlusCircle, CheckCircle,
  CaretRight, CaretDown, Percent, Folder, Cube,
  X,
} from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { Combobox, DatePicker } from './Booking/BookingCreateModal.jsx';
import { PoListRow } from '../../Utils/PoListRow.jsx';
import { useProjectEvents } from '../../Utils/useProjectEvents.js';
// Organization.css carries the .org-sort-toggle styles we reuse for the
// Day/Week/Month granularity picker inside Revenue-over-time.
// Products.css is required for the Combobox dropdown (.cat-filter-dropdown,
// .cat-filter-item, .cat-filter-indicator) — without it the period menu
// renders unstyled and invisibly (no position:fixed / z-index).
import '../../Style/Organization.css';
import '../../Style/Products.css';      // .po-tree-row, .po-set-table — used by MarginSection tree
import '../../Style/Authentication.css'; // .auth-modal-* for CustomRangeModal + DrillDownModal
import '../../Style/Analytics.css';

// ── Period codes — match _date_range_for_period in CRM backend ───────────
// The 'custom' option is a SENTINEL — selecting it from the dropdown
// opens the date-range modal (CustomRangeModal below) rather than
// committing the literal string 'custom' as the period. Once the
// user picks from/to dates the modal swaps period to the encoded
// "YYYY-MM-DD_YYYY-MM-DD" form, which the backend's
// _date_range_for_period regex parses out.
const PERIOD_OPTIONS = [
  { value: '1d',       label: '1 day'           },
  { value: '3d',       label: '3 days'          },
  { value: '1w',       label: '1 week'          },
  { value: '2w',       label: '2 weeks'         },
  { value: '1mo',      label: '1 month'         },
  { value: '2mo',      label: '2 months'        },
  { value: 'season',   label: '1 season (3 mo)' },
  { value: 'halfyear', label: 'Half-year'       },
  { value: '1y',       label: '1 year'          },
  { value: '2y',       label: '2 years'         },
  { value: 'custom',   label: 'Custom range…' },
];
// Same codes as a plain array so we can step forward/back when the user
// zooms the chart with Ctrl+wheel — +1 = wider window (zoom out), −1 =
// narrower window (zoom in). Excludes 'custom' (it's not a position on
// the zoom scale, it's a launcher for the date-range modal).
const PERIOD_ORDER = PERIOD_OPTIONS
  .filter(o => o.value !== 'custom')
  .map(o => o.value);

// Detect an encoded custom-range period like "2026-04-01_2026-04-15".
const CUSTOM_PERIOD_RE = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/;
const isCustomPeriod = (period) => CUSTOM_PERIOD_RE.test(period || '');
const parseCustomPeriod = (period) => {
  const m = (period || '').match(CUSTOM_PERIOD_RE);
  return m ? { from: m[1], to: m[2] } : null;
};
const formatCustomPeriod = (fromISO, toISO) => `${fromISO}_${toISO}`;

// ── Reusable section shell ───────────────────────────────────────────────
// Section visual: flat heading (like Products page groups — "Physical [5]")
// + optional period picker on the right. NO outer card wrapper — sections
// blend into the page background; only the inner cells (KPIs, mini-lists,
// tables) are white tiles with shadow. The `Icon` prop is accepted but
// intentionally ignored — design called for plain text headings.
function SectionShell({ title, periodValue, onPeriodChange, hidePeriod, headerControls, children }) {
  const [customOpen, setCustomOpen] = useState(false);
  const handlePeriodChange = (v) => {
    if (v === 'custom') {
      setCustomOpen(true);
      return; // don't commit 'custom' to state — wait for modal submit
    }
    onPeriodChange?.(v);
  };
  // Decorate the dropdown's displayed label when a custom encoded
  // period is active — Combobox would otherwise show the raw
  // `2026-04-01_2026-04-15` string. We piggy-back on the existing
  // PERIOD_OPTIONS list by injecting a synthetic option that mirrors
  // the current custom range as a readable label.
  const dropdownOptions = useMemo(() => {
    if (!isCustomPeriod(periodValue)) return PERIOD_OPTIONS;
    const { from, to } = parseCustomPeriod(periodValue);
    return [
      ...PERIOD_OPTIONS.filter(o => o.value !== 'custom'),
      { value: periodValue, label: `${from} → ${to}` },
      { value: 'custom',    label: 'Custom range…' },
    ];
  }, [periodValue]);
  return (
    <section className="an-section">
      <header className="an-section-head">
        <h2 className="an-section-title">{title}</h2>
        <div className="an-section-controls">
          {headerControls /* extra filter chips (e.g. Day/Week/Month for charts) */}
          {!hidePeriod && (
            <div className="an-section-period">
              <Combobox value={periodValue} options={dropdownOptions} onChange={handlePeriodChange} />
            </div>
          )}
        </div>
      </header>
      <div className="an-section-body">{children}</div>
      {customOpen && (
        <CustomRangeModal
          initialFrom={isCustomPeriod(periodValue) ? parseCustomPeriod(periodValue).from : ''}
          initialTo={isCustomPeriod(periodValue) ? parseCustomPeriod(periodValue).to   : ''}
          onClose={() => setCustomOpen(false)}
          onApply={(fromISO, toISO) => {
            onPeriodChange?.(formatCustomPeriod(fromISO, toISO));
            setCustomOpen(false);
          }} />
      )}
    </section>
  );
}

// ── Custom date-range modal ───────────────────────────────────────────────
// Two native <input type="date"> fields plus Apply / Cancel. The native
// date picker is good enough for desktop AND mobile — both render an OS-
// level calendar UI when tapped/clicked, no third-party date library
// needed. Submission encodes the pair as "YYYY-MM-DD_YYYY-MM-DD" which
// the backend's `_date_range_for_period` regex unwraps server-side, so
// every analytics endpoint already supports custom ranges with zero
// per-endpoint changes.
function CustomRangeModal({ initialFrom, initialTo, onClose, onApply }) {
  const todayISO = new Date().toISOString().slice(0, 10);
  // Default to "last 7 days ending today" when no prior custom range.
  const defaultFromISO = new Date(Date.now() - 7 * 86400 * 1000)
    .toISOString().slice(0, 10);
  const [fromVal, setFromVal] = useState(initialFrom || defaultFromISO);
  const [toVal,   setToVal]   = useState(initialTo   || todayISO);
  const [err, setErr] = useState('');
  const submit = (e) => {
    e?.preventDefault?.();
    if (!fromVal || !toVal) {
      setErr('Pick both dates');
      return;
    }
    if (fromVal > toVal) {
      setErr('"From" must be before "To"');
      return;
    }
    onApply(fromVal, toVal);
  };
  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal an-range-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title">Custom date range</div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>
        <form className="auth-modal-body an-range-form" onSubmit={submit}>
          <div className="an-range-fields">
            <label className="an-range-field">
              <span>From</span>
              {/* Reuse the calendar pop-up from BookingCreateModal — same
                  month grid + nav + DynamicBlock indicator as the booking
                  date picker, so the UI feels consistent across the app
                  (and replaces the native browser date input which the
                  user found ugly + inconsistent across browsers). */}
              <DatePicker value={fromVal}
                onChange={v => { setFromVal(v); setErr(''); }} />
            </label>
            <label className="an-range-field">
              <span>To</span>
              <DatePicker value={toVal}
                onChange={v => { setToVal(v); setErr(''); }} />
            </label>
          </div>
          {err && <p className="auth-msg auth-msg--err">{err}</p>}
          <div className="auth-actions">
            <button className="crm-submit-btn" type="submit">Apply</button>
            <button className="crm-submit-btn auth-btn-secondary"
              type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

// ── Hook: section-local fetch with re-fire on period change ──────────────
// `enabled` defaults to true — pass false from a lazy wrapper to defer the
// fetch until the section scrolls into the viewport. While disabled the
// hook returns loading=true and no data, so the section keeps showing its
// skeleton without firing a request.
function useSectionData(url, period, projectId, deps = [], enabled = true) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!projectId || !enabled) return;
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE}${url}?project_id=${projectId}&period=${period}`,
          { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(j => { if (!cancelled) { setData(j); setError(null); } })
      .catch(e => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [url, period, projectId, enabled, ...deps]);   // eslint-disable-line
  return { data, loading, error };
}

// ── Lazy-section wrapper ────────────────────────────────────────────────
// Renders a tall placeholder until the wrapper scrolls within `rootMargin`
// of the viewport, then renders `children` once and never unmounts them
// again (sticky=true). This way the 22 analytics fetches don't all stampede
// on page mount — only the 2-3 sections actually visible above the fold
// fire immediately, the rest fetch as the user scrolls.
//
// Usage: <LazySection minHeight={260}><HeavySection ... /></LazySection>
function LazySection({ children, minHeight = 220, rootMargin = '300px' }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible || !ref.current) return;
    // Older browsers (or jsdom in tests) without IntersectionObserver fall
    // back to immediate render so analytics still works — no jank.
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const obs = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setVisible(true); obs.disconnect(); }
    }, { rootMargin });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [visible, rootMargin]);
  return (
    <div ref={ref} style={{ minHeight: visible ? undefined : minHeight }}>
      {visible ? children : null}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────
// Project's default currency lives in a mutable ref (set once at page
// mount from the Outlet context). Every fmtMoney call reads the current
// code from there — that way we don't have to thread `currency` through
// every component prop. ISO 4217 code drives Intl.NumberFormat which
// picks the correct symbol / placement / decimals (KZT no decimals,
// USD has $, EUR has €, etc.).
let __ANALYTICS_CURRENCY = 'USD';
const setAnalyticsCurrency = (code) => { __ANALYTICS_CURRENCY = (code || 'USD').toUpperCase(); };
const fmtMoney = (n) => {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: __ANALYTICS_CURRENCY,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(+n || 0);
  } catch {
    // Unknown currency code — fall back to bare number + 3-letter suffix.
    return `${(+n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${__ANALYTICS_CURRENCY}`;
  }
};
const fmtInt   = (n) => (+n || 0).toLocaleString('en-US');

// ── CSV export helper ────────────────────────────────────────────────────
// Generates a CSV file client-side from in-memory section data and
// triggers a browser download. Each section passes a `rows` array and
// `columns` config — column object is `{ key, label, format? }`. We
// don't go through the backend for this because (a) the data is
// already on the client after the section rendered, (b) avoids a
// second auth-check round-trip, (c) keeps export instant.
//
// CSV escaping follows RFC 4180: wrap in double-quotes whenever the
// value contains a comma, double-quote, or newline; double up
// embedded double-quotes. BOM prefix so Excel auto-detects UTF-8
// (without BOM, Cyrillic and emoji turn into mojibake on Windows).
function downloadCSV(filename, rows, columns) {
  const esc = (val) => {
    if (val == null) return '';
    const s = String(val);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const header = columns.map(c => esc(c.label || c.key)).join(',');
  const body = rows.map(r =>
    columns.map(c => {
      const raw = r[c.key];
      return esc(c.format ? c.format(raw, r) : raw);
    }).join(',')
  ).join('\r\n');
  const csv = '﻿' + header + '\r\n' + body;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

// Convenience: a small "Download CSV" pill button that fits into
// SectionShell's `headerControls` slot or the section body. Disabled
// while there's no data yet.
function CsvButton({ onClick, disabled, label = 'CSV' }) {
  return (
    <button type="button"
      className="an-csv-btn"
      onClick={onClick}
      disabled={disabled}
      title="Download as CSV">
      ↓ {label}
    </button>
  );
}
const fmtPct   = (n, signed) => {
  if (n == null) return '—';
  const v = +n;
  const sign = signed && v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
};
const fmtDate  = (s) => s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
const fmtDays  = (n) => n == null ? '—' : `${(+n).toFixed(1)} d`;
// Adaptive duration formatter — picks the unit (s / min / h / d) based on
// magnitude. Input is in SECONDS. Used by Operations SLA so a 30-second
// cart-to-paid doesn't render as "0.0 h" / "0.0 d" (looks like the
// metric is broken when it's actually just very fast).
const fmtDuration = (seconds) => {
  if (seconds == null) return '—';
  const s = +seconds;
  if (s < 60)    return `${Math.max(1, Math.round(s))} s`;
  if (s < 3600)  return `${(s / 60).toFixed(1)} min`;
  if (s < 86400) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(1)} d`;
};
const fmtDaysAdaptive  = (days)  => days  == null ? '—' : fmtDuration(days  * 86400);
const fmtHoursAdaptive = (hours) => hours == null ? '—' : fmtDuration(hours * 3600);

// Tone helper — green for "good" (revenue ↑, conversion ↑) vs "bad" (returns ↑).
const deltaTone = (n, inverse = false) => {
  if (n == null || n === 0) return '';
  const positive = inverse ? n < 0 : n > 0;
  return positive ? ' an-delta--up' : ' an-delta--down';
};

// ── Scrollable line chart ────────────────────────────────────────────────
// Stock-chart-style horizontal panning: the FULL data history lives in a
// wide SVG group; an overflow-hidden wrapper shows one viewport-width at
// a time; drag translates the group (direct DOM mutation, no React
// re-render). No refetch on pan — backend ships the entire history up
// front, this widget just slides a window over it.
//
// Layout:
//   • Y-axis labels (right side) — OUTSIDE the scrolling group, stay fixed
//   • Data path + X-axis labels  — INSIDE the scrolling group, slide together
//   • Hover crosshair + dot      — inside the scrolling group, follow data
//   • Hover tooltip bubble       — outside the group, positioned in screen px
//
// Zoom level is driven by `viewportBuckets` — how many data buckets fit in
// the visible viewport. Wider buckets = "zoomed in" view; narrower buckets
// = "zoomed out". The period selector + granularity in the parent compute
// this. Ctrl/Cmd + wheel still fires `onZoom(±1)` for keyboard-driven
// zoom in/out without going to the dropdown.
function LineChart({
  data = [],            // history slice, [{bucket, revenue, ...}, ...]
  compareData = [],     // optional second series rendered as a dashed line
  viewportBuckets = 30, // how many buckets fit in the visible viewport (zoom)
  height = 320,
  valueKey = 'revenue',
  dateKey = 'bucket',
  // Default formatter uses fmtMoney (module-level, currency-aware) but
  // rounds to whole units for tooltip readability — `$1,234` reads
  // faster on a chart bubble than `$1,234.56`.
  formatValue = (v) => fmtMoney(Math.round(+v || 0)).replace(/[.,]00\b/, ''),
  onZoom,
  onLoadMore,           // called when scroll approaches the left edge
  loadingMore = false,  // true while a prepend fetch is in flight
  onBucketClick,        // (bucket, data) — fired on click (not drag)
}) {
  const wrapperRef     = useRef(null);
  const scrollGroupRef = useRef(null);
  const scrollXRef     = useRef(0);  // mutable scroll position (px translation)
  const dragRef        = useRef({ active: false, startX: 0, startScrollX: 0 });
  const prevDataLenRef = useRef(0);  // for prepend-detection
  const prevViewportRef = useRef(viewportBuckets); // for zoom-change detection
  // Once the user manually drags, we stop auto-anchoring to rightmost
  // on resize so we don't yank them out of the history view they were
  // looking at. Reset on (initial load, zoom change, granularity change).
  const userScrolledRef = useRef(false);

  const [wrapperW, setWrapperW] = useState(1000);
  const [hover,    setHover]    = useState(null);
  const [version,  setVersion]  = useState(0); // bump to force re-render after commit

  // Responsive width — recompute layout when the wrapper resizes.
  useEffect(() => {
    if (!wrapperRef.current) return;
    const sync = () => setWrapperW(wrapperRef.current?.clientWidth || 1000);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  const h = height;
  const padL = 24, padR = 72, padT = 28, padB = 38;
  const innerH = h - padT - padB;
  const innerW = Math.max(50, wrapperW - padL - padR);
  // 1 bucket = innerW / viewportBuckets pixels (always, regardless of
  // data length — keeps the per-bucket scale consistent at a chosen zoom).
  const bucketPx   = innerW / Math.max(1, viewportBuckets);
  const dataWidthPx = data.length * bucketPx;
  // Scroll position where the LAST data point sits at the right edge:
  // scrollX + padL + (data.length - 0.5) * bucketPx = wrapperW - padR
  const scrollAtRightmost = innerW - (data.length - 0.5) * bucketPx;
  // Scroll position where the FIRST data point sits at the left edge:
  // scrollX + padL + 0.5 * bucketPx = padL  →  scrollX = -0.5 * bucketPx
  const scrollAtLeftmost  = -0.5 * bucketPx;
  const canScroll = dataWidthPx > innerW;
  // Drag clamp range (min = most-negative, max = least-negative).
  const minScroll = canScroll ? scrollAtRightmost : scrollAtRightmost;
  const maxScroll = canScroll ? scrollAtLeftmost  : scrollAtRightmost;

  // Layout-effect helper — write scroll position to DOM WITHOUT firing
  // the lazy-load trigger. Used for programmatic re-anchoring (initial
  // load, resize re-anchor, prepend compensation). The user-driven
  // writeScroll wrapper (defined below for drag handlers) adds the
  // load-more side-effect on top.
  const writeScrollPosition = (x) => {
    scrollXRef.current = x;
    if (scrollGroupRef.current) {
      scrollGroupRef.current.setAttribute('transform', `translate(${x}, 0)`);
    }
  };

  // Layout effect — runs synchronously BEFORE paint so the user never
  // sees a frame with old scroll position + new data. Five cases:
  //   (1) Initial load: snap to rightmost (latest data on screen).
  //   (2) Prepend (lazy load): keep visual anchor by shifting scrollX
  //       by -N*bucketPx where N is the prepended bucket count.
  //   (3) Zoom change: viewportBuckets shifted — user picked a new
  //       scale, snap back to rightmost (their reference frame moved).
  //   (4) Resize before user has scrolled: re-anchor to rightmost so
  //       the initial dimension (default wrapperW=1000) doesn't leave
  //       the chart sitting in the middle of history after the
  //       ResizeObserver lands the real width.
  //   (5) Resize after user has scrolled: just clamp to the new range.
  useLayoutEffect(() => {
    const prev           = prevDataLenRef.current;
    const cur            = data.length;
    const viewportChanged = prevViewportRef.current !== viewportBuckets;
    prevViewportRef.current = viewportBuckets;

    if (prev === 0 && cur > 0) {
      // (1) initial load
      userScrolledRef.current = false;
      writeScrollPosition(scrollAtRightmost);
      setHover(null);
    } else if (prev > 0 && cur > prev) {
      // (2) prepend
      const added = cur - prev;
      writeScrollPosition(scrollXRef.current - added * bucketPx);
      setHover(h => h != null ? h + added : null);
    } else if (cur > 0 && viewportChanged) {
      // (3) zoom change — explicit reset
      userScrolledRef.current = false;
      writeScrollPosition(scrollAtRightmost);
    } else if (cur > 0 && !userScrolledRef.current) {
      // (4) resize / layout shift, user hasn't scrolled — re-anchor
      writeScrollPosition(scrollAtRightmost);
    } else if (cur > 0) {
      // (5) resize after user-scroll — clamp to valid range
      const clamped = Math.max(scrollAtRightmost,
                       Math.min(scrollAtLeftmost, scrollXRef.current));
      if (clamped !== scrollXRef.current) writeScrollPosition(clamped);
    }
    prevDataLenRef.current = cur;
  }, [data.length, scrollAtRightmost, scrollAtLeftmost, bucketPx, viewportBuckets]);

  // Y-axis: range across BOTH series so the scale fits the larger
  // of current vs comparison. Stable as the user pans.
  const allVals = [
    ...data.map(d => +d[valueKey] || 0),
    ...compareData.map(d => +d[valueKey] || 0),
  ];
  const maxRaw  = Math.max(1, ...allVals);
  const minRaw  = Math.min(0, ...allVals);
  const max = maxRaw + (maxRaw - minRaw) * 0.1;
  const min = minRaw;

  // X position of bucket i (in chart coordinate space — the scrolling
  // group will translate this whole space by scrollX on the screen).
  const xScale = (i) => padL + (i + 0.5) * bucketPx;
  const yScale = (v) => {
    const range = max - min || 1;
    return padT + innerH * (1 - (v - min) / range);
  };

  // Catmull-Rom path with sampled-and-clamped polyline output (no
  // sub-baseline dips, smooth shoulders, fat enough to look natural
  // around isolated peaks).
  const yTop = padT, yBot = padT + innerH;
  const SAMPLES = 16;
  const clampY = (y) => Math.max(yTop, Math.min(yBot, y));
  // Build a Catmull-Rom-sampled SVG path string for an arbitrary data
  // series. Extracted so both the primary chart line and the optional
  // comparison overlay can share the math.
  const buildPath = useCallback((series) => {
    if (series.length < 2) {
      if (series.length === 1) {
        return `M${xScale(0).toFixed(1)},${clampY(yScale(+series[0][valueKey] || 0)).toFixed(1)}`;
      }
      return '';
    }
    const pts = series.map((d, i) => [xScale(i), yScale(+d[valueKey] || 0)]);
    let p = `M${pts[0][0].toFixed(1)},${clampY(pts[0][1]).toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
      const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
      const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
      const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
      for (let s = 1; s <= SAMPLES; s++) {
        const t = s / SAMPLES;
        const u = 1 - t;
        const u3 = u*u*u, u2t = 3*u*u*t, ut2 = 3*u*t*t, t3 = t*t*t;
        const x = u3*p1[0] + u2t*cp1x + ut2*cp2x + t3*p2[0];
        const y = u3*p1[1] + u2t*cp1y + ut2*cp2y + t3*p2[1];
        p += ` L${x.toFixed(1)},${clampY(y).toFixed(1)}`;
      }
    }
    return p;
  }, [bucketPx, max, min, padL, padT, innerH, valueKey]);
  const pathD        = useMemo(() => buildPath(data),        [buildPath, data]);
  const comparePathD = useMemo(() => buildPath(compareData), [buildPath, compareData]);

  // Y-axis ticks — 5 evenly spaced.
  const tickCount = 5;
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const v = max - ((max - min) * i) / (tickCount - 1);
    return { v, y: padT + (innerH * i) / (tickCount - 1) };
  });

  // X-axis label density — ~one label per 100 px.
  const labelStep = Math.max(1, Math.round(100 / Math.max(1, bucketPx)));
  const fmtX = (val) => {
    if (!val) return '';
    try {
      const d = new Date(val);
      return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
    } catch { return String(val); }
  };
  const fmtXFull = (val) => {
    if (!val) return '';
    try {
      const d = new Date(val);
      return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
    } catch { return String(val); }
  };
  const fmtY = (v) => {
    if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
    return v.toFixed(v > 10 ? 0 : 1);
  };

  // Drag handlers — write directly to the DOM, no React re-render until
  // gesture ends. setVersion bump at release forces ONE final re-render
  // so React JSX (e.g. transform="translate(...)") stays in sync with
  // the imperative scroll position (otherwise the next React render
  // would clobber our DOM mutation with the stale JSX value).
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // Drag-driven scroll write — same as writeScrollPosition plus the
  // lazy-load trigger. The split lets the layout-effect re-anchor
  // programmatically without spamming onLoadMore as it touches the
  // left edge mathematically.
  const writeScroll = (x) => {
    writeScrollPosition(x);
    if (onLoadMore && !loadingMore && canScroll) {
      const range            = scrollAtLeftmost - scrollAtRightmost;
      const distFromLeftmost = scrollAtLeftmost - x;
      if (range > 0 && distFromLeftmost / range < 0.25) {
        onLoadMore();
      }
    }
  };
  // Pointer events handle mouse + touch + pen with one code path. `e.pointerType`
  // tells us which kind ("mouse" / "touch" / "pen") so hover can be mouse-only
  // (touch has no concept of hover — finger leaves screen → no fired moves).
  // setPointerCapture keeps the move events flowing to the wrapper even when
  // the user's finger drags outside its bounds.
  const handlePointerDown = (e) => {
    // Ignore non-primary mouse buttons (right-click etc.) — only main
    // button or first touch contact drives the pan.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startScrollX: scrollXRef.current,
      // Track travel so handlePointerUp can distinguish click vs drag.
      // Anything under ~5 px = click (open drill-down), more = pan.
      moved: 0,
    };
    setHover(null);
    if (wrapperRef.current) {
      wrapperRef.current.style.cursor = 'grabbing';
      try { wrapperRef.current.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
    }
    userScrolledRef.current = true;
  };
  const handlePointerMove = (e) => {
    if (dragRef.current.active) {
      const dx = e.clientX - dragRef.current.startX;
      // Track total motion so we can tell a click from a drag on
      // pointer-up. Use raw dx — even slight horizontal motion past
      // the threshold means the user is panning.
      if (Math.abs(dx) > Math.abs(dragRef.current.moved)) {
        dragRef.current.moved = dx;
      }
      writeScroll(clamp(dragRef.current.startScrollX + dx, minScroll, maxScroll));
      return;
    }
    // Hover crosshair is for pointing devices (mouse / pen) only — touch
    // has no "hover" semantics, and a sticky tooltip after every tap
    // reads like a bug.
    if (e.pointerType === 'touch') return;
    if (!data.length || !wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const xScreen = e.clientX - rect.left;
    const i = Math.floor((xScreen - scrollXRef.current - padL) / bucketPx);
    if (i >= 0 && i < data.length) setHover(i);
    else setHover(null);
  };
  // Click threshold — drag of <5 px on release counts as a click rather
  // than a pan. Big enough to absorb hand jitter on touchscreens, small
  // enough that a deliberate swipe still registers as pan.
  const CLICK_THRESHOLD_PX = 5;
  const endDrag = (e) => {
    const wasActive = dragRef.current.active;
    const movedPx   = Math.abs(dragRef.current.moved || 0);
    if (wasActive) {
      dragRef.current.active = false;
      // Force one re-render so the React-managed transform attribute on
      // the scrolling group matches the imperative DOM position. Without
      // this, the next state-driven re-render (e.g. on hover) would
      // reset the transform back to whatever JSX last wrote.
      setVersion(v => v + 1);
    }
    if (wrapperRef.current) {
      wrapperRef.current.style.cursor = 'grab';
      if (e?.pointerId != null) {
        try { wrapperRef.current.releasePointerCapture(e.pointerId); } catch { /* ok */ }
      }
    }
    // Click detection — pointer-up after barely any movement = open
    // drill-down for the bucket under the cursor. Resolves the bucket
    // from the up-event's screen position so it works even for touch
    // taps that never fired a hover.
    if (wasActive && movedPx < CLICK_THRESHOLD_PX && onBucketClick && e && data.length) {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (rect) {
        const xScreen = e.clientX - rect.left;
        const i = Math.floor((xScreen - scrollXRef.current - padL) / bucketPx);
        if (i >= 0 && i < data.length) {
          onBucketClick(data[i][dateKey], data[i]);
        }
      }
    }
  };
  const handlePointerUp     = (e) => endDrag(e);
  const handlePointerLeave  = (e) => { endDrag(e); setHover(null); };
  const handlePointerCancel = (e) => endDrag(e);
  const handleWheel         = (e) => {
    if (!onZoom || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    onZoom(e.deltaY > 0 ? +1 : -1);
  };

  // Hover point in CHART coords (still inside the scrolling group, so
  // crosshair tracks the data when the group translates).
  const hoverPt = hover != null && data[hover] ? {
    x: xScale(hover),
    y: yScale(+data[hover][valueKey] || 0),
    val: +data[hover][valueKey] || 0,
    date: data[hover][dateKey],
  } : null;

  // Unique clip-path id so multiple charts on a page don't collide.
  const clipId = `an-chart-clip-${valueKey}`;

  // Wrapper: overflow:hidden creates the viewport. The SVG is sized to
  // the wrapper width (no viewBox stretch). The scrolling group inside
  // the SVG is the ONLY element we translate — Y-axis labels sit at
  // fixed positions outside that group so they stay put while the user
  // pans through history.
  return (
    <div ref={wrapperRef}
         className="an-chart-wrap"
         onPointerDown={handlePointerDown}
         onPointerMove={handlePointerMove}
         onPointerUp={handlePointerUp}
         onPointerLeave={handlePointerLeave}
         onPointerCancel={handlePointerCancel}
         onWheel={handleWheel}
         style={{
           overflow: 'hidden',
           cursor: canScroll ? 'grab' : 'default',
           // Disable browser horizontal pan-scroll so our drag handler
           // owns horizontal gestures. Vertical scroll (pan-y) still
           // works so users can scroll the page through the chart on
           // mobile — only horizontal swipes are intercepted.
           touchAction: 'pan-y',
           userSelect: 'none',
           width: '100%',
           position: 'relative',
         }}>
    <svg className="an-chart" width={wrapperW} height={h}
         style={{ display: 'block', width: '100%' }}>
      <defs>
        <clipPath id={clipId}>
          {/* Clip HORIZONTALLY only — keep the full chart height so the
              x-axis date labels (rendered at y = h - 14, below the data
              area) stay visible. Previously height was `innerH + 32`
              which capped at y = padT + innerH + 16, hiding the date
              labels at y = 306 (chart height 320). */}
          <rect x={padL} y={0}
                width={wrapperW - padL - padR} height={h} />
        </clipPath>
      </defs>

      {/* Fixed: Y grid lines + labels (right side). Do NOT scroll. */}
      {ticks.map((t, i) => (
        <g key={`tick-${i}`}>
          <line x1={padL} x2={wrapperW - padR} y1={t.y} y2={t.y}
                stroke="#eef0f3" strokeWidth="1" />
          <text x={wrapperW - padR + 8} y={t.y + 4} textAnchor="start"
                fontSize="11" fill="#9a9aa0" fontFamily="inherit">
            {fmtY(t.v)}
          </text>
        </g>
      ))}

      {/* Scrollable group — path + X labels + hover crosshair live
          inside, all share the same translate(scrollX, 0). */}
      <g clipPath={`url(#${clipId})`}>
        <g ref={scrollGroupRef}
           transform={`translate(${scrollXRef.current}, 0)`}
           data-version={version}>
          {/* X-axis labels — auto-thinned so they don't overlap. */}
          {data.map((d, i) => {
            if (i % labelStep !== 0 && i !== data.length - 1) return null;
            return (
              <text key={`xlabel-${i}`}
                    x={xScale(i)} y={h - 14}
                    textAnchor="middle" fontSize="11"
                    fill="#9a9aa0" fontFamily="inherit">
                {fmtX(d[dateKey])}
              </text>
            );
          })}

          {/* Comparison series — drawn FIRST so the main line stays
              on top. Dashed + thinner + 50 % opacity so it reads as
              "supporting context", not competing with the primary
              metric. */}
          {comparePathD && (
            <path d={comparePathD} fill="none"
                  stroke="var(--accent)" strokeWidth="1.8"
                  strokeDasharray="6 4"
                  strokeLinecap="round" strokeLinejoin="round"
                  opacity="0.45" />
          )}
          {/* Data path — solid accent line. */}
          <path d={pathD} fill="none"
                stroke="var(--accent)" strokeWidth="2.6"
                strokeLinecap="round" strokeLinejoin="round" />

          {/* Hover crosshair + dot — inside the scrolling group so they
              follow data when the user pans. Hidden during drag. */}
          {hoverPt && !dragRef.current.active && (
            <g>
              <line x1={hoverPt.x} x2={hoverPt.x}
                    y1={padT} y2={padT + innerH}
                    stroke="#c7c7cc" strokeWidth="1" strokeDasharray="3 3" />
              <circle cx={hoverPt.x} cy={hoverPt.y} r="6"
                      fill="var(--accent)" stroke="#fff" strokeWidth="2" />
            </g>
          )}
        </g>
      </g>

      {/* Tooltip bubble — OUTSIDE the scrolling group so it isn't
          clipped or translated. Its screen x is the chart-x plus the
          current scrollX. Hidden during drag. */}
      {hoverPt && !dragRef.current.active && (() => {
        const screenX = hoverPt.x + scrollXRef.current;
        if (screenX < padL || screenX > wrapperW - padR) return null;
        const valStr = formatValue(hoverPt.val);
        const bw = Math.max(60, valStr.length * 7 + 16);
        const bx = Math.max(padL, Math.min(wrapperW - padR - bw, screenX - bw / 2));
        const by = Math.max(padT, hoverPt.y - 38);
        return (
          <g pointerEvents="none">
            <rect x={bx} y={by} width={bw} height="24" rx="6"
                  fill="var(--accent)" />
            <text x={bx + bw / 2} y={by + 16} textAnchor="middle"
                  fontSize="12" fontWeight="600" fill="#fff"
                  fontFamily="inherit">
              {valStr}
            </text>
            <text x={screenX} y={Math.max(padT - 6, hoverPt.y - 44)}
                  textAnchor="middle" fontSize="11" fill="var(--muted)"
                  fontFamily="inherit">
              {fmtXFull(hoverPt.date)}
            </text>
          </g>
        );
      })()}
    </svg>
    </div>
  );
}

// ── Inline SVG horizontal bar (stacked or simple) ────────────────────────
function HorizontalBars({ data, valueKey = 'revenue', labelKey = 'category',
                          max, formatValue, mode = 'share' }) {
  // `mode` controls what the bar width means:
  //   'max'   — bar width = value / max(values). Use for revenue-style
  //             charts where the absolute amount matters.
  //   'share' — bar width = value / sum(values), and we append the
  //             percentage to the right-side value. Use for category-
  //             distribution charts (traffic sources, devices, etc.)
  //             where the user wants to see "X% of all visitors came
  //             from this source". Without this mode, when every row
  //             has the same value (3 different sources × 1 visitor
  //             each), all bars render at 100% and the chart is
  //             meaningless.
  const fmt = formatValue || ((v) => v.toLocaleString('en-US'));
  const computedMax = max || Math.max(1, ...data.map(d => +d[valueKey] || 0));
  const total = data.reduce((s, d) => s + (+d[valueKey] || 0), 0) || 1;
  return (
    <div className="an-bars">
      {data.map((d, i) => {
        const v = +d[valueKey] || 0;
        const sharePct = (v / total) * 100;
        const widthPct = mode === 'share'
          ? sharePct
          : (computedMax ? (v / computedMax) * 100 : 0);
        return (
          <div key={i} className="an-bar-row">
            <span className="an-bar-label">{d[labelKey] || '—'}</span>
            <div className="an-bar-track">
              <div className="an-bar-fill" style={{ width: `${widthPct}%` }} />
            </div>
            <span className="an-bar-value">
              {fmt(v)}
              {mode === 'share' && (
                <span className="an-bar-share"> · {sharePct.toFixed(0)}%</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Skeleton block (loading state) ───────────────────────────────────────
function Skeleton({ height = 120 }) {
  return <div className="an-skeleton" style={{ height }} />;
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 1 — Overview KPIs
// ════════════════════════════════════════════════════════════════════════
function OverviewSection({ projectId, period, setPeriod }) {
  const { data, loading } = useSectionData('/api/analytics/overview', period, projectId);
  return (
    <SectionShell title="Overview" Icon={ChartLine}
      periodValue={period} onPeriodChange={setPeriod}
      headerControls={
        <CsvButton
          disabled={loading || !data}
          onClick={() => {
            if (!data) return;
            // Two rows: current period KPIs + previous period KPIs side
            // by side, plus a "delta_%" column. Useful for the merchant
            // to paste into a board deck and show period-over-period.
            const rows = [
              { metric: 'Revenue',
                current:  data.current.revenue,
                previous: data.previous.revenue,
                delta:    data.delta.revenue },
              { metric: 'Orders',
                current:  data.current.orders,
                previous: data.previous.orders,
                delta:    data.delta.orders },
              { metric: 'Avg order',
                current:  data.current.aov,
                previous: data.previous.aov,
                delta:    data.delta.aov },
              { metric: 'Conversion %',
                current:  data.current.conversion,
                previous: data.previous.conversion,
                delta:    data.delta.conversion },
              { metric: 'Visitors',
                current:  data.current.visitors,
                previous: data.previous.visitors,
                delta:    data.delta.visitors },
              { metric: 'Customers',
                current:  data.current.customers,
                previous: data.previous.customers,
                delta:    data.delta.customers },
            ];
            downloadCSV(
              `overview-${period}-${new Date().toISOString().slice(0,10)}.csv`,
              rows,
              [
                { key: 'metric',   label: 'Metric' },
                { key: 'current',  label: 'Current',  format: v => (+v || 0).toFixed(2) },
                { key: 'previous', label: 'Previous', format: v => (+v || 0).toFixed(2) },
                { key: 'delta',    label: 'Δ%',       format: v => v == null ? '' : (+v).toFixed(1) },
              ]
            );
          }} />
      }>
      {loading || !data ? <Skeleton height={120} /> : (
        <div className="an-kpi-grid">
          <Kpi label="Revenue"      value={fmtMoney(data.current.revenue)}   delta={data.delta.revenue} />
          <Kpi label="Orders"       value={fmtInt(data.current.orders)}      delta={data.delta.orders} />
          <Kpi label="Avg order"    value={fmtMoney(data.current.aov)}       delta={data.delta.aov} />
          <Kpi label="Conversion"   value={`${(data.current.conversion || 0).toFixed(1)}%`} delta={data.delta.conversion} />
          <Kpi label="Visitors"     value={fmtInt(data.current.visitors)}    delta={data.delta.visitors} />
          <Kpi label="Customers"    value={fmtInt(data.current.customers)}   delta={data.delta.customers} />
        </div>
      )}
    </SectionShell>
  );
}
function Kpi({ label, value, delta, inverse }) {
  return (
    <div className="an-kpi">
      <span className="an-kpi-label">{label}</span>
      <span className="an-kpi-value">{value}</span>
      {delta != null && (
        <span className={`an-delta${deltaTone(delta, inverse)}`}>
          {fmtPct(delta, true)}
        </span>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 2 — Revenue over time
// ════════════════════════════════════════════════════════════════════════
// Reuses Products' .org-sort-toggle visual: pill container + sliding accent
// indicator that follows hover OR active selection. Three options:
// Day / Week / Month.
const GRAN_OPTIONS = [
  { value: 'day',   label: 'Day'   },
  { value: 'week',  label: 'Week'  },
  { value: 'month', label: 'Month' },
];
function GranularitySegmented({ value, onChange }) {
  const indRef  = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);
  const cur = hovered ?? value;
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el  = btnRefs.current[cur];
      if (!ind || !el) return;
      ind.style.opacity   = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width     = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [cur, value]);
  return (
    <div className="org-sort-toggle" onMouseLeave={() => setHovered(null)}>
      <div ref={indRef} className="org-sort-indicator" />
      {GRAN_OPTIONS.map(({ value: v, label }) => (
        <button key={v} ref={el => { btnRefs.current[v] = el; }}
          className={`org-sort-btn${cur === v ? ' org-sort-btn--current' : ''}`}
          onMouseEnter={() => setHovered(v)}
          onClick={() => onChange(v)} type="button">
          {label}
        </button>
      ))}
    </div>
  );
}

// Period (selected width) × granularity (bucket size) → how many
// buckets fit in one viewport-wide view. Used as the zoom level for
// the scrollable chart — the period dropdown is now a pure visual
// zoom, not a fetch parameter (backend always returns full history).
const PERIOD_DAYS = {
  '1d': 1, '3d': 3, '1w': 7, '2w': 14, '1mo': 30, '2mo': 60,
  '3mo': 90, 'season': 90, 'halfyear': 180, '1y': 365, '2y': 730,
};
const GRAN_DAYS = { day: 1, week: 7, month: 30 };
function periodToViewportBuckets(period, gran) {
  const days = PERIOD_DAYS[period] || 30;
  const granDays = GRAN_DAYS[gran]  || 1;
  return Math.max(1, Math.round(days / granDays));
}

// Chunk size for each lazy-load request, in days. Tuned per granularity
// so each chunk is roughly "one viewport's worth + headroom" — enough
// that the user gets to scroll a meaningful distance before we fetch
// the next chunk, but small enough that the first load is fast.
const CHUNK_DAYS = { day: 60, week: 365, month: 365 * 2 };

function RevenueOverTimeSection({ projectId }) {
  const [period, setPeriod] = useState('1mo');
  const [gran,   setGran]   = useState('day');
  // `data` accumulates across multiple paginated fetches — initial load
  // brings the rightmost chunk (most recent buckets) and `handleLoadMore`
  // prepends older chunks as the user pans into the past. Buckets are
  // unique by their `bucket` ISO string so prepend de-dupes overlap.
  const [data, setData]                 = useState([]);
  const [oldestOrder, setOldestOrder]   = useState(null);
  const [loading, setLoading]           = useState(true);
  const [loadingMore, setLoadingMore]   = useState(false);
  // Optional "compare with" period — when set, fetch a SECOND time
  // series with this period's date range and overlay it on the chart
  // as a dashed line. Default 'off' = no comparison.
  const [comparePeriod, setComparePeriod] = useState('off');
  const [compareData,   setCompareData]   = useState([]);
  // dataVersion bumps whenever a project event arrives that could affect
  // revenue (order_created, order_status_changed). useEffect below
  // listens on it and re-fetches the visible chunk — so a new order
  // shows up on the chart within seconds without the user reloading.
  const [dataVersion, setDataVersion]   = useState(0);
  useProjectEvents(projectId, (event) => {
    if (event.type === 'order_created' || event.type === 'order_status_changed') {
      setDataVersion(v => v + 1);
    }
  });
  // When the user picks a custom range from the dropdown, period gets
  // encoded as "YYYY-MM-DD_YYYY-MM-DD". The revenue chart uses a
  // bespoke chunked fetcher (NOT the period-based useSectionData), so
  // we have to honour custom ranges here explicitly: pass `from` + `to`
  // straight to the endpoint and disable lazy-load / auto-fill (the
  // range is fixed, scrolling further past the boundary makes no sense).
  const customRange = isCustomPeriod(period) ? parseCustomPeriod(period) : null;
  // Initial fetch: bespoke URL depending on whether a custom range is
  // active. Resets on (projectId, granularity, period) change so picking
  // a custom range re-fires the fetch with the new dates.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData([]);
    setOldestOrder(null);
    let url = `${API_BASE}/api/analytics/revenue-over-time`
      + `?project_id=${projectId}&granularity=${gran}`;
    if (customRange) {
      // Both bounds inclusive in user expectation — append " end-of-day"
      // for `to` so the entire last day is covered. Backend's
      // `_parse_iso` accepts both forms.
      const fromISO = `${customRange.from}T00:00:00Z`;
      const toISO   = `${customRange.to}T23:59:59Z`;
      url += `&from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`;
    }
    fetch(url, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (cancelled || !j) return;
        setData(j.buckets || []);
        setOldestOrder(j.oldest_order || null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, gran, period, dataVersion]);
  // Fetch the chunk immediately older than what's currently loaded.
  // Skipped when (a) a request is already in flight, (b) we've already
  // reached the project's oldest_order, (c) data is empty (initial
  // load not finished yet).
  //
  // Chunk size is ADAPTIVE — the default is one period-typical chunk
  // (60 days / 1y / 2y), but if the current viewport is wider than
  // what's loaded (e.g. user just switched from "1 month" to "half-year"
  // and we only have 90 of the 180 buckets needed) the chunk grows to
  // cover the gap in ONE fetch instead of chaining 3-4 small ones.
  // Custom range mode: viewport fits the entire range (no scrolling),
  // so viewportBuckets = data.length once loaded. Falls back to the
  // preset-based calc while data is empty so layout math doesn't
  // divide by zero.
  const viewportBuckets = customRange
    ? Math.max(1, data.length || 30)
    : periodToViewportBuckets(period, gran);
  const handleLoadMore = useCallback(() => {
    // Custom range is a closed window — disable lazy-load and auto-fill.
    if (customRange) return;
    if (loadingMore || loading || data.length === 0) return;
    const earliestISO = data[0].bucket;
    const earliestDate = new Date(earliestISO);
    if (oldestOrder && earliestDate <= new Date(oldestOrder)) return;
    setLoadingMore(true);
    const granDays   = GRAN_DAYS[gran] || 1;
    const baseChunk  = CHUNK_DAYS[gran] || 60;
    const targetBkts = viewportBuckets + 30; // viewport + one headroom buffer
    const gap        = Math.max(0, targetBkts - data.length);
    const chunkDays  = Math.max(baseChunk, gap * granDays);
    const chunkMs    = chunkDays * 86400 * 1000;
    const fromDate   = new Date(earliestDate.getTime() - chunkMs);
    const fromISO    = fromDate.toISOString();
    fetch(
      `${API_BASE}/api/analytics/revenue-over-time?project_id=${projectId}`
      + `&granularity=${gran}&from=${encodeURIComponent(fromISO)}`
      + `&to=${encodeURIComponent(earliestISO)}`,
      { credentials: 'include' }
    )
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (!j) return;
        const newer = j.buckets || [];
        if (newer.length === 0) {
          // Backend confirmed no more data in that range — record the
          // boundary so we don't keep asking forever.
          if (j.oldest_order) setOldestOrder(j.oldest_order);
          return;
        }
        setData(prev => {
          // Drop any overlap (defensive): only keep prev buckets that
          // are strictly newer than the newest in the prepended chunk.
          const lastNewISO = newer[newer.length - 1].bucket;
          const tail = prev.filter(b => b.bucket > lastNewISO);
          return [...newer, ...tail];
        });
        if (j.oldest_order) setOldestOrder(j.oldest_order);
      })
      .finally(() => setLoadingMore(false));
  }, [projectId, gran, data, oldestOrder, loadingMore, loading, viewportBuckets, customRange]);
  // Auto-fill viewport: if the user picks a wide period (half-year, 1y)
  // but the data we have so far doesn't cover that many buckets, kick
  // off lazy-load chunks until the chart can display the requested
  // window — or we hit the project's `oldest_order` and there's
  // genuinely nothing more to fetch. Without this, switching from
  // "1 month" to "Half-year" would leave the chart with empty space
  // on the left and no way for the user to fetch more (drag can't
  // trigger lazy-load when data is smaller than viewport — there's
  // nothing to scroll).
  useEffect(() => {
    if (loading || loadingMore || data.length === 0) return;
    // Already covered with one chunk of headroom — stop chaining.
    if (data.length >= viewportBuckets + 30) return;
    // Hit the oldest order — nothing older to fetch.
    if (oldestOrder && new Date(data[0].bucket) <= new Date(oldestOrder)) return;
    handleLoadMore();
  }, [loading, loadingMore, data.length, viewportBuckets, oldestOrder, handleLoadMore]);
  const exportCsv = () => downloadCSV(
    `revenue-over-time-${new Date().toISOString().slice(0,10)}.csv`,
    data,
    [
      { key: 'bucket',  label: 'Date' },
      { key: 'revenue', label: 'Revenue', format: v => (+v || 0).toFixed(2) },
      { key: 'orders',  label: 'Orders' },
    ]
  );
  // Fetch the comparison period series whenever comparePeriod / gran /
  // projectId changes. Uses the same endpoint with period= (so the
  // _date_range_for_period parser handles preset + custom encoding).
  // 'off' clears comparison data without firing a fetch.
  useEffect(() => {
    if (comparePeriod === 'off') {
      setCompareData([]);
      return;
    }
    let cancelled = false;
    let from = null, to = null;
    if (isCustomPeriod(comparePeriod)) {
      const r = parseCustomPeriod(comparePeriod);
      from = `${r.from}T00:00:00Z`;
      to   = `${r.to}T23:59:59Z`;
    } else {
      // Preset like "1mo" → end at now, start at now - PERIOD_DAYS.
      const days = PERIOD_DAYS[comparePeriod] || 30;
      const end = new Date();
      const start = new Date(end.getTime() - days * 86400 * 1000);
      from = start.toISOString();
      to   = end.toISOString();
    }
    fetch(
      `${API_BASE}/api/analytics/revenue-over-time?project_id=${projectId}`
      + `&granularity=${gran}`
      + `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { credentials: 'include' }
    )
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (!cancelled && j) setCompareData(j.buckets || []); });
    return () => { cancelled = true; };
  }, [projectId, gran, comparePeriod]);
  // Drill-down: tap/click a bucket → open modal with the orders that
  // made up that day's revenue. Only meaningful at day granularity —
  // for week/month buckets the "orders on day X" query doesn't map
  // 1:1 to the bucket, so we collapse the click silently.
  const [drillDay, setDrillDay] = useState(null);
  const handleBucketClick = (bucketIso) => {
    if (!bucketIso || gran !== 'day') return;
    const day = String(bucketIso).slice(0, 10);
    setDrillDay(day);
  };
  // "Compare with" options — same list as the main period plus an
  // explicit "off" sentinel. Picking 'custom' opens the standard date-
  // range modal (handled inside SectionShell). Selected value is
  // displayed as e.g. "vs 1 week".
  const COMPARE_OPTIONS = useMemo(() => [
    { value: 'off', label: 'No comparison' },
    ...PERIOD_OPTIONS.map(o => ({
      value: o.value,
      label: o.value === 'custom' ? o.label : `vs ${o.label}`,
    })),
  ], []);
  const compareDropdownOptions = useMemo(() => {
    if (!isCustomPeriod(comparePeriod)) return COMPARE_OPTIONS;
    const { from, to } = parseCustomPeriod(comparePeriod);
    return [
      ...COMPARE_OPTIONS.filter(o => o.value !== 'custom'),
      { value: comparePeriod, label: `vs ${from} → ${to}` },
      { value: 'custom', label: 'Custom range…' },
    ];
  }, [comparePeriod, COMPARE_OPTIONS]);
  const [compareCustomOpen, setCompareCustomOpen] = useState(false);
  const handleCompareChange = (v) => {
    if (v === 'custom') {
      setCompareCustomOpen(true);
      return;
    }
    setComparePeriod(v);
  };
  const segmented = (
    <>
      <GranularitySegmented value={gran} onChange={setGran} />
      <CsvButton onClick={exportCsv} disabled={loading || data.length === 0} />
      <div className="an-compare-picker">
        <Combobox value={comparePeriod}
          options={compareDropdownOptions}
          onChange={handleCompareChange} />
      </div>
    </>
  );
  const stepPeriod = (delta) => {
    const i = PERIOD_ORDER.indexOf(period);
    const next = Math.max(0, Math.min(PERIOD_ORDER.length - 1, i + delta));
    if (next !== i) setPeriod(PERIOD_ORDER[next]);
  };
  return (
    <SectionShell title="Revenue over time" Icon={ChartLine}
      periodValue={period} onPeriodChange={setPeriod}
      headerControls={segmented}>
      <div className="an-tile">
        {loading ? <Skeleton height={240} /> : (
          data.length === 0
            ? <p className="an-empty">No orders yet.</p>
            : <LineChart data={data}
                compareData={compareData}
                viewportBuckets={viewportBuckets}
                valueKey="revenue"
                onZoom={stepPeriod}
                onLoadMore={handleLoadMore}
                loadingMore={loadingMore}
                onBucketClick={handleBucketClick} />
        )}
      </div>
      {drillDay && (
        <DrillDownOrdersModal
          projectId={projectId}
          day={drillDay}
          onClose={() => setDrillDay(null)} />
      )}
      {compareCustomOpen && (
        <CustomRangeModal
          initialFrom={isCustomPeriod(comparePeriod) ? parseCustomPeriod(comparePeriod).from : ''}
          initialTo={isCustomPeriod(comparePeriod) ? parseCustomPeriod(comparePeriod).to : ''}
          onClose={() => setCompareCustomOpen(false)}
          onApply={(fromISO, toISO) => {
            setComparePeriod(formatCustomPeriod(fromISO, toISO));
            setCompareCustomOpen(false);
          }} />
      )}
    </SectionShell>
  );
}

// ── Drill-down modal: orders that landed on a given day ──────────────────
// Triggered from a click on the Revenue-over-time chart. Shows compact
// list of orders so the merchant can see "what drove that $X day".
// Click a row to jump to the full Orders page (TODO when route exists).
function DrillDownOrdersModal({ projectId, day, onClose }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/analytics/orders-on-day?project_id=${projectId}&day=${encodeURIComponent(day)}`,
          { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(j => { if (!cancelled) setRows(Array.isArray(j) ? j : []); });
    return () => { cancelled = true; };
  }, [projectId, day]);
  const total = (rows || []).reduce((s, r) => s + (+r.total || 0), 0);
  const fmtTime = (iso) => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  };
  const fmtDayLong = (s) => {
    if (!s) return '';
    try { return new Date(s + 'T00:00').toLocaleDateString('en-US',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
    catch { return s; }
  };
  // ── Modal shell mirrors PromoCodes / Booking modals ──────────────
  // Same auth-modal + cpm-modal classes, same head with title +
  // subtitle row + close X. Body uses a stacked row list (PoListRow-
  // style grid) instead of a raw <table> so the layout reads like the
  // rest of the design system.
  const DRILL_COLS = '90px 1.8fr 70px 110px 110px';
  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal an-drill-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">{fmtDayLong(day)}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {rows == null ? 'Loading…'
                   : rows.length === 0 ? 'No orders on this day.'
                   : `${rows.length} order${rows.length === 1 ? '' : 's'} · ${fmtMoney(total)} total`}
                </span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>
        <div className="auth-modal-body an-drill-body">
          {rows == null ? (
            <Skeleton height={120} />
          ) : rows.length === 0 ? (
            <p className="an-empty">Nothing to drill into for this day.</p>
          ) : (
            <div className="po-set-table">
              <div className="po-set-row po-set-row--head"
                   style={{ gridTemplateColumns: DRILL_COLS }}>
                <span>Time</span>
                <span>Customer</span>
                <span style={{ textAlign: 'right' }}>Items</span>
                <span style={{ textAlign: 'right' }}>Total</span>
                <span>Status</span>
              </div>
              {rows.map(r => (
                <div key={r.id} className="po-set-row po-tree-row"
                     style={{ gridTemplateColumns: DRILL_COLS }}>
                  <span className="po-set-note">{fmtTime(r.created_at)}</span>
                  <span className="po-tree-name-cell">
                    <span className="po-set-strong">{r.customer_name}</span>
                    {r.customer_email && (
                      <span className="po-set-note po-tree-meta">· {r.customer_email}</span>
                    )}
                  </span>
                  <span className="po-money-cell">{r.item_count}</span>
                  <span className="po-money-cell">{fmtMoney(r.total)}</span>
                  <span>
                    <span className={`an-drill-status an-drill-status--${r.status}`}>
                      {r.status}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
// Convenience wrapper that bypasses useSectionData's URL convention — used
// when the endpoint needs custom query string keys (granularity).
function useFixedFetch(fullUrl) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE}${fullUrl}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (!cancelled) setData(j); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fullUrl]);
  return { data, loading };
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 3 — Revenue by category
// ════════════════════════════════════════════════════════════════════════
function RevenueByCategorySection({ projectId }) {
  const [period, setPeriod] = useState('1mo');
  const { data, loading } = useSectionData('/api/analytics/revenue-by-category', period, projectId);
  return (
    <SectionShell title="Revenue by category" Icon={Tag}
      periodValue={period} onPeriodChange={setPeriod}>
      <div className="an-tile">
        {loading || !data ? <Skeleton height={180} /> :
          data.length === 0 ? <p className="an-empty">No category sales yet.</p> :
          <HorizontalBars data={data} valueKey="revenue" labelKey="category"
            formatValue={fmtMoney} />}
      </div>
    </SectionShell>
  );
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 4 — Sales funnel
// ════════════════════════════════════════════════════════════════════════
function FunnelSection({ projectId }) {
  const [period, setPeriod] = useState('1mo');
  const { data, loading } = useSectionData('/api/analytics/funnel', period, projectId);
  // Backend returns the views count under the key `product_views` (see
  // analytics_funnel in CRM/backend/main.py). The previous `data.views`
  // was always undefined → step value=0 → display "0 (0.0%)" no matter
  // how many product page views existed. THIS was the funnel bug we
  // chased for hours.
  const steps = data ? [
    { key: 'visitors',  label: 'Site visits',     Icon: Eye,          value: data.visitors },
    { key: 'views',     label: 'Product views',   Icon: ShoppingCart, value: data.product_views },
    { key: 'atc',       label: 'Added to cart',   Icon: PlusCircle,   value: data.atc },
    { key: 'paid',      label: 'Paid orders',     Icon: CheckCircle,  value: data.paid },
  ] : [];
  const max = steps[0]?.value || 1;
  return (
    <SectionShell title="Sales funnel" Icon={Funnel}
      periodValue={period} onPeriodChange={setPeriod}>
      {loading || !data ? <Skeleton height={200} /> : (
        <div className="an-tile an-funnel">
          {steps.map((s, i) => {
            // Clamp 0..100 so an out-of-order data point (e.g. more carts
            // than visitors due to anonymous users adding to cart) doesn't
            // overflow the bar OR show "200%" / "NaN%" in the percentage
            // column. The funnel is for visual intuition, not absolute math.
            const rawPct = max > 0 ? (s.value / max * 100) : 0;
            const pct    = Number.isFinite(rawPct) ? Math.max(0, Math.min(100, rawPct)) : 0;
            const prev   = i > 0 ? steps[i - 1].value : null;
            // drop is the % LOST from the previous step (e.g. 60% drop means
            // 60% of people who saw a product did not add to cart). Only
            // displayed when prev > 0 AND the drop is positive — negative
            // drops (more carts than views) just hide the chip.
            const dropRaw = prev > 0 ? (1 - s.value / prev) * 100 : null;
            const drop    = (dropRaw != null && Number.isFinite(dropRaw)) ? dropRaw : null;
            const StepIcon = s.Icon;
            return (
              <div key={s.key} className="an-funnel-row">
                <div className="an-funnel-label">
                  <StepIcon className="an-funnel-icon" weight="regular" />
                  {s.label}
                </div>
                {/* Dedicated count column — always visible, regardless of
                    bar width. The in-bar value still renders for steps
                    where the fill is wide enough to comfortably hold it. */}
                <div className="an-funnel-count">{fmtInt(s.value)}</div>
                <div className="an-funnel-track">
                  <div className="an-funnel-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="an-funnel-pct">
                  {pct.toFixed(1)}%
                  {drop != null && drop > 0 && (
                    <span className="an-funnel-drop">  −{drop.toFixed(0)}%</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionShell>
  );
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 5 — Funnel dynamics (per-day conversion rates)
// ════════════════════════════════════════════════════════════════════════
function FunnelDynamicsSection({ projectId }) {
  const [period, setPeriod] = useState('1mo');
  const { data, loading } = useSectionData('/api/analytics/funnel-dynamics', period, projectId);
  return (
    <SectionShell title="Funnel dynamics" Icon={ChartLine}
      periodValue={period} onPeriodChange={setPeriod}>
      {loading || !data ? <Skeleton height={200} /> : data.length === 0 ? (
        <p className="an-empty">Not enough traffic to compute conversion trends.</p>
      ) : (
        <>
          <p className="an-section-hint">
            How efficiently each funnel step converts to the next, day by
            day. Big number is the period average — line shows the daily
            trend. Watch for sudden dips after a marketing push or site change.
          </p>
          <div className="an-multi-chart">
            <SmallSeries title="Visit → ATC" hint="of visitors who added something to cart"
              series={data} valueKey="visit_to_atc" suffix="%" />
            <SmallSeries title="ATC → Paid"  hint="of cart-builders who actually paid"
              series={data} valueKey="atc_to_paid"  suffix="%" />
            <SmallSeries title="Overall"     hint="of visitors who became paying customers"
              series={data} valueKey="overall"      suffix="%" />
          </div>
        </>
      )}
    </SectionShell>
  );
}
function SmallSeries({ title, hint, series, valueKey, suffix }) {
  const max = Math.max(1, ...series.map(d => +d[valueKey] || 0));
  const w = 240, h = 90, pad = 6;
  const path = series.map((d, i) => {
    const x = pad + (i / Math.max(1, series.length - 1)) * (w - pad * 2);
    const y = h - pad - ((+d[valueKey] || 0) / max) * (h - pad * 2);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  // Average is far more useful than "latest day" — a single bad day
  // would otherwise dominate a metric meant to summarize trends.
  const nVals = series.filter(d => (+d[valueKey]) >= 0).length || 1;
  const avg   = series.reduce((s, d) => s + (+d[valueKey] || 0), 0) / nVals;
  return (
    <div className="an-small-series">
      <span className="an-small-series-title">{title}</span>
      <span className="an-small-series-value">{avg.toFixed(1)}{suffix}</span>
      {hint && <span className="an-small-series-hint">avg · {hint}</span>}
      <svg className="an-small-series-chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" />
      </svg>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 6 — Heatmap (day of week × hour of day)
// ════════════════════════════════════════════════════════════════════════
const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function HeatmapSection({ projectId }) {
  const [period, setPeriod] = useState('2mo');
  const { data, loading } = useSectionData('/api/analytics/heatmap', period, projectId);
  const matrix = data?.matrix || Array.from({ length: 7 }, () => Array(24).fill(0));
  const max = Math.max(1, ...matrix.flat());
  return (
    <SectionShell title="Orders by day-of-week × hour" Icon={CalendarBlank}
      periodValue={period} onPeriodChange={setPeriod}>
      {loading ? <Skeleton height={260} /> : (
        <div className="an-heatmap-wrap">
          <div className="an-heatmap">
            <div className="an-heatmap-corner" />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="an-heatmap-h-label">{h}</div>
            ))}
            {matrix.map((row, dow) => (
              // React.Fragment is required (not <>) because we need a key on
              // the wrapper element — otherwise React 18 emits a "Each child
              // in a list should have a unique key" warning for the heatmap.
              <Fragment key={`dow-${dow}`}>
                <div className="an-heatmap-d-label">{DOW_LABELS[dow]}</div>
                {row.map((v, h) => {
                  // Quantize the order count into one of 5 intensity
                  // tiers + an empty tier. The actual colour lives in
                  // CSS (.an-heatmap-cell--t0..t5) instead of an inline
                  // rgba string — keeps theming centralized and avoids
                  // the React style-merge cost on a 168-cell grid.
                  const intensity = v / max;
                  let tier = 'empty';
                  if (v > 0) {
                    if (intensity <= 0.2)       tier = 't1';
                    else if (intensity <= 0.4)  tier = 't2';
                    else if (intensity <= 0.6)  tier = 't3';
                    else if (intensity <= 0.8)  tier = 't4';
                    else                        tier = 't5';
                  }
                  return (
                    <div key={`${dow}-${h}`}
                         className={`an-heatmap-cell an-heatmap-cell--${tier}`} />
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </SectionShell>
  );
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 7 — Popular products (4 quadrants)
// ════════════════════════════════════════════════════════════════════════
function PopularProductsSection({ projectId }) {
  const [period, setPeriod] = useState('1mo');
  const { data, loading } = useSectionData('/api/analytics/popular-products', period, projectId);
  return (
    <SectionShell title="Popular products" Icon={Package}
      periodValue={period} onPeriodChange={setPeriod}>
      {loading || !data ? <Skeleton height={300} /> : (
        <div className="an-quads">
          <ProductMiniList title="Top by revenue" rows={data.by_revenue}
            getValue={r => fmtMoney(r.revenue)} secondary={r => `${r.units} sold`} />
          <ProductMiniList title="Top by units sold" rows={data.by_units}
            getValue={r => `${r.units}`} secondary={r => fmtMoney(r.revenue)} />
          <ProductMiniList title="Most favorited" rows={data.favorites}
            getValue={r => `♥ ${r.favs}`} />
          <ProductMiniList title="Slow movers (90d no sales)" rows={data.slow}
            empty="None — everything moved in 90 days 🎉"
            getValue={() => '0 sold'} />
        </div>
      )}
    </SectionShell>
  );
}
function ProductMiniList({ title, rows, getValue, secondary, empty = 'No data yet.' }) {
  return (
    <div className="an-mini">
      <h3 className="an-mini-title">{title}</h3>
      {!rows || rows.length === 0
        ? <p className="an-mini-empty">{empty}</p>
        : (
          <ul className="an-mini-list">
            {rows.map(r => (
              <li key={r.id} className="an-mini-row">
                <span className="an-mini-name">{r.title}</span>
                <div className="an-mini-vals">
                  <span className="an-mini-val">{getValue(r)}</span>
                  {secondary && <span className="an-mini-secondary">{secondary(r)}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 8 — Customer types + Top customers + Geographic
// ════════════════════════════════════════════════════════════════════════
function CustomerSection({ projectId }) {
  const [period, setPeriod] = useState('1mo');
  // New-vs-returning chart fetches its OWN paginated data (matches the
  // Revenue-over-time scroll UX). Top customers + Top cities stick with
  // the period-driven useSectionData fetch — they're snapshot tables,
  // not time series.
  const [nrData,        setNrData]        = useState([]);
  const [nrOldestOrder, setNrOldestOrder] = useState(null);
  const [nrLoading,     setNrLoading]     = useState(true);
  const [nrLoadingMore, setNrLoadingMore] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setNrLoading(true);
    setNrData([]);
    setNrOldestOrder(null);
    // Always invoke chunked mode by passing `to` — sending `to=now`
    // anchors the response window's right edge at "now" and lets the
    // backend pick the default 90-day chunk on the left. Without a
    // chunked-mode trigger the endpoint falls back to legacy array
    // shape (no oldest_order metadata → lazy-load can't stop).
    // Custom range from period dropdown → fetch with explicit from/to
    // and disable lazy-load (range is fixed). Otherwise default chunked
    // mode (last 90 days, auto-fill on demand).
    const nrCustomRange = isCustomPeriod(period) ? parseCustomPeriod(period) : null;
    const nowISO = new Date().toISOString();
    let url = `${API_BASE}/api/analytics/customer-types?project_id=${projectId}`;
    if (nrCustomRange) {
      url += `&from=${encodeURIComponent(nrCustomRange.from + 'T00:00:00Z')}`
           + `&to=${encodeURIComponent(nrCustomRange.to + 'T23:59:59Z')}`;
    } else {
      url += `&to=${encodeURIComponent(nowISO)}`;
    }
    fetch(url, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (cancelled || !j) return;
        const buckets = Array.isArray(j) ? j : (j.buckets || []);
        setNrData(buckets);
        if (!Array.isArray(j) && j.oldest_order) setNrOldestOrder(j.oldest_order);
      })
      .finally(() => { if (!cancelled) setNrLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, period]);
  // Day-granularity → viewportBuckets is just PERIOD_DAYS (1d = 1 bucket,
  // 1mo = 30 buckets, half-year = 180 buckets, etc.). Custom range fits
  // its entire span in the viewport (no scrolling — closed window).
  const nrCustomRange = isCustomPeriod(period) ? parseCustomPeriod(period) : null;
  const nrViewportBuckets = nrCustomRange
    ? Math.max(1, nrData.length || 30)
    : (PERIOD_DAYS[period] || 30);
  const nrHandleLoadMore = useCallback(() => {
    // Custom range = closed window; no lazy-load needed.
    if (nrCustomRange) return;
    if (nrLoadingMore || nrLoading || nrData.length === 0) return;
    const earliestISO  = nrData[0].day;
    const earliestDate = new Date(earliestISO);
    if (nrOldestOrder && earliestDate <= new Date(nrOldestOrder)) return;
    setNrLoadingMore(true);
    const baseChunk  = 60;
    const targetBkts = nrViewportBuckets + 30;
    const gap        = Math.max(0, targetBkts - nrData.length);
    const chunkDays  = Math.max(baseChunk, gap);
    const fromDate = new Date(earliestDate.getTime() - chunkDays * 86400 * 1000);
    const fromISO  = fromDate.toISOString();
    fetch(
      `${API_BASE}/api/analytics/customer-types?project_id=${projectId}`
      + `&from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(earliestISO)}`,
      { credentials: 'include' }
    )
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (!j) return;
        const newer = Array.isArray(j) ? j : (j.buckets || []);
        if (newer.length === 0) {
          if (!Array.isArray(j) && j.oldest_order) setNrOldestOrder(j.oldest_order);
          return;
        }
        setNrData(prev => {
          const lastNewISO = newer[newer.length - 1].day;
          const tail = prev.filter(b => b.day > lastNewISO);
          return [...newer, ...tail];
        });
        if (!Array.isArray(j) && j.oldest_order) setNrOldestOrder(j.oldest_order);
      })
      .finally(() => setNrLoadingMore(false));
  }, [projectId, nrData, nrOldestOrder, nrLoadingMore, nrLoading, nrViewportBuckets, nrCustomRange]);
  // Auto-fill for wider periods — same pattern as revenue-over-time.
  // Disabled in custom-range mode since the range is already fully fetched.
  useEffect(() => {
    if (nrCustomRange) return;
    if (nrLoading || nrLoadingMore || nrData.length === 0) return;
    if (nrData.length >= nrViewportBuckets + 30) return;
    if (nrOldestOrder && new Date(nrData[0].day) <= new Date(nrOldestOrder)) return;
    nrHandleLoadMore();
  }, [nrLoading, nrLoadingMore, nrData.length, nrViewportBuckets, nrOldestOrder, nrHandleLoadMore, nrCustomRange]);
  const top = useSectionData('/api/analytics/top-customers', period, projectId);
  const geo = useSectionData('/api/analytics/geographic',    period, projectId);
  return (
    <SectionShell title="Customers" Icon={Users}
      periodValue={period} onPeriodChange={setPeriod}>
      <p className="an-section-hint">
        Who's buying from you. Left chart: daily split of orders placed
        by first-time vs returning customers — a high "New" share means
        marketing is bringing fresh traffic, a high "Returning" share
        means loyalty is paying off. Drag the chart to pan through
        history. Middle: top spenders. Right: most active shipping
        cities (courier deliveries only).
      </p>
      <div className="an-cust-grid">
        {/* New vs returning */}
        <div className="an-cust-cell an-cust-cell--wide">
          <h3 className="an-mini-title">New vs returning customers</h3>
          {nrLoading ? <Skeleton height={180} /> :
            nrData.length === 0 ? <p className="an-empty">No orders yet.</p> :
            <NewReturningChart data={nrData}
              viewportBuckets={nrViewportBuckets}
              onLoadMore={nrHandleLoadMore}
              loadingMore={nrLoadingMore} />}
        </div>
        {/* Top customers */}
        <div className="an-cust-cell">
          <h3 className="an-mini-title">Top customers</h3>
          {top.loading ? <Skeleton height={180} /> :
            !top.data?.length ? <p className="an-mini-empty">No customers yet.</p> : (
              <table className="an-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th className="an-table-num">Orders</th>
                    <th className="an-table-num">Spent</th>
                  </tr>
                </thead>
                <tbody>
                  {top.data.map(c => (
                    <tr key={c.id}>
                      <td>
                        <div className="an-table-name">{c.name}</div>
                        <div className="an-table-sub">{c.email}</div>
                      </td>
                      <td className="an-table-num">{c.orders}</td>
                      <td className="an-table-num">{fmtMoney(c.spent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
        {/* Geographic */}
        <div className="an-cust-cell">
          <h3 className="an-mini-title">Top cities</h3>
          {geo.loading ? <Skeleton height={180} /> :
            !geo.data?.length ? (
              <p className="an-mini-empty">
                No city data yet. Only courier orders contribute — postal
                and digital orders don't carry a shipping address.
              </p>
            ) : (
              <table className="an-table">
                <thead>
                  <tr>
                    <th>City</th>
                    <th className="an-table-num">Orders</th>
                    <th className="an-table-num">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {geo.data.map((c, i) => (
                    <tr key={i}>
                      <td>
                        <MapPin size={12} weight="fill" className="an-table-mappin" />
                        {c.city}
                      </td>
                      <td className="an-table-num">{c.orders}</td>
                      <td className="an-table-num">{fmtMoney(c.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </div>
    </SectionShell>
  );
}
// ── Scrollable bar chart for New-vs-returning customers ─────────────────
// Same scroll architecture as the Revenue-over-time LineChart: full
// dataset rendered inside a translate()'d <g>, wrapper has overflow:
// hidden so only one viewport's worth is visible at a time, drag pans,
// near-left-edge triggers lazy load. Bars (stacked new on top of
// returning) replace the smooth line — everything else (Y-axis baseline
// fixed outside scroll, hover tooltip outside scroll, useLayoutEffect
// scroll anchoring) is structurally identical.
function NewReturningChart({
  data = [],
  viewportBuckets = 30,
  onLoadMore,
  loadingMore = false,
}) {
  const wrapperRef     = useRef(null);
  const scrollGroupRef = useRef(null);
  const scrollXRef     = useRef(0);
  const dragRef        = useRef({ active: false, startX: 0, startScrollX: 0 });
  const prevDataLenRef = useRef(0);
  const prevViewportRef = useRef(viewportBuckets);
  const userScrolledRef = useRef(false);

  const [wrapperW, setWrapperW] = useState(1000);
  const [hover,    setHover]    = useState(null);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const sync = () => setWrapperW(wrapperRef.current?.clientWidth || 1000);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  const h = 220;
  const padL = 12, padR = 12, padT = 22, padB = 32;
  const innerH = h - padT - padB;
  const innerW = Math.max(50, wrapperW - padL - padR);
  const bucketPx = innerW / Math.max(1, viewportBuckets);
  const dataWidthPx = data.length * bucketPx;
  const max = Math.max(1, ...data.map(d => (d.new || 0) + (d.returning || 0)));
  const bw  = Math.max(2, Math.min(bucketPx - 6, 40));
  // Bars sit centered on xCenter(i), so their right edge is at
  // xCenter+bw/2 and their left edge at xCenter-bw/2. The "rightmost"
  // scroll position needs to land the LAST bar's RIGHT edge — not its
  // center — at the right boundary of the plot area, otherwise half
  // the bar is clipped by the overflow:hidden / clipPath rect. Same
  // story on the left for the first bar (- bw/2 inset).
  const halfBar = bw / 2;
  const scrollAtRightmost = innerW - (data.length - 0.5) * bucketPx - halfBar;
  const scrollAtLeftmost  = -0.5 * bucketPx + halfBar;
  const canScroll = dataWidthPx > innerW;

  const xCenter = (i) => padL + (i + 0.5) * bucketPx;
  const showNumLabels = bucketPx >= 22;

  // Density of x-axis labels — one per ~80 px visible.
  const labelStep = Math.max(1, Math.round(80 / Math.max(1, bucketPx)));

  const fmtDay = (s) => {
    if (!s) return '';
    try {
      const d = new Date(s);
      return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
    } catch { return String(s); }
  };
  const fmtDayFull = (s) => {
    if (!s) return '';
    try {
      const d = new Date(s);
      return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
    } catch { return String(s); }
  };

  const writeScrollPosition = (x) => {
    scrollXRef.current = x;
    if (scrollGroupRef.current) {
      scrollGroupRef.current.setAttribute('transform', `translate(${x}, 0)`);
    }
  };

  useLayoutEffect(() => {
    const prev = prevDataLenRef.current;
    const cur  = data.length;
    const viewportChanged = prevViewportRef.current !== viewportBuckets;
    prevViewportRef.current = viewportBuckets;
    if (prev === 0 && cur > 0) {
      userScrolledRef.current = false;
      writeScrollPosition(scrollAtRightmost);
      setHover(null);
    } else if (prev > 0 && cur > prev) {
      const added = cur - prev;
      writeScrollPosition(scrollXRef.current - added * bucketPx);
      setHover(h => h != null ? h + added : null);
    } else if (cur > 0 && viewportChanged) {
      userScrolledRef.current = false;
      writeScrollPosition(scrollAtRightmost);
    } else if (cur > 0 && !userScrolledRef.current) {
      writeScrollPosition(scrollAtRightmost);
    } else if (cur > 0) {
      const clamped = Math.max(scrollAtRightmost,
                       Math.min(scrollAtLeftmost, scrollXRef.current));
      if (clamped !== scrollXRef.current) writeScrollPosition(clamped);
    }
    prevDataLenRef.current = cur;
  }, [data.length, scrollAtRightmost, scrollAtLeftmost, bucketPx, viewportBuckets]);

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const writeScroll = (x) => {
    writeScrollPosition(x);
    if (onLoadMore && !loadingMore && canScroll) {
      const range            = scrollAtLeftmost - scrollAtRightmost;
      const distFromLeftmost = scrollAtLeftmost - x;
      if (range > 0 && distFromLeftmost / range < 0.25) {
        onLoadMore();
      }
    }
  };

  // Pointer Events unify mouse/touch/pen. setPointerCapture keeps the
  // move stream flowing even when the finger drags off the wrapper —
  // crucial on mobile where a long swipe can exit the chart bounds.
  const handlePointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startScrollX: scrollXRef.current,
    };
    setHover(null);
    if (wrapperRef.current) {
      wrapperRef.current.style.cursor = 'grabbing';
      try { wrapperRef.current.setPointerCapture(e.pointerId); } catch { /* ok */ }
    }
    userScrolledRef.current = true;
  };
  const handlePointerMove = (e) => {
    if (dragRef.current.active) {
      const dx = e.clientX - dragRef.current.startX;
      writeScroll(clamp(dragRef.current.startScrollX + dx,
                        scrollAtRightmost, scrollAtLeftmost));
      return;
    }
    // Hover only for pointing devices — touch has no hover semantics.
    if (e.pointerType === 'touch') return;
    if (!data.length || !wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const xScreen = e.clientX - rect.left;
    const i = Math.floor((xScreen - scrollXRef.current - padL) / bucketPx);
    if (i >= 0 && i < data.length) setHover(i);
    else setHover(null);
  };
  const endDrag = (e) => {
    if (dragRef.current.active) dragRef.current.active = false;
    if (wrapperRef.current) {
      wrapperRef.current.style.cursor = canScroll ? 'grab' : 'default';
      if (e?.pointerId != null) {
        try { wrapperRef.current.releasePointerCapture(e.pointerId); } catch { /* ok */ }
      }
    }
  };
  const handlePointerUp     = (e) => endDrag(e);
  const handlePointerLeave  = (e) => { endDrag(e); setHover(null); };
  const handlePointerCancel = (e) => endDrag(e);

  const hoverPt = hover != null && data[hover] ? {
    i:    hover,
    cx:   xCenter(hover),
    nw:   data[hover].new || 0,
    rt:   data[hover].returning || 0,
    date: data[hover].day,
  } : null;
  const hoverTotal = hoverPt ? (hoverPt.nw + hoverPt.rt) : 0;
  const hoverY = hoverPt ? (padT + innerH - (hoverTotal / max) * innerH) : 0;
  const clipId = `an-nr-clip`;

  return (
    <div className="an-cust-chart">
      <div ref={wrapperRef}
           className="an-chart-wrap"
           onPointerDown={handlePointerDown}
           onPointerMove={handlePointerMove}
           onPointerUp={handlePointerUp}
           onPointerLeave={handlePointerLeave}
           onPointerCancel={handlePointerCancel}
           style={{
             overflow: 'hidden',
             cursor: canScroll ? 'grab' : 'default',
             touchAction: 'pan-y',
             userSelect: 'none',
             width: '100%',
             position: 'relative',
           }}>
        <svg width={wrapperW} height={h}
             style={{ display: 'block', width: '100%' }}>
          <defs>
            <clipPath id={clipId}>
              {/* Clip HORIZONTALLY only — full chart height so x-axis
                  date labels (at y = h - 12) stay visible. */}
              <rect x={padL} y={0}
                    width={wrapperW - padL - padR}
                    height={h} />
            </clipPath>
          </defs>
          {/* Fixed baseline — does NOT scroll, runs the full viewport. */}
          <line x1={padL} x2={wrapperW - padR}
                y1={padT + innerH + 0.5} y2={padT + innerH + 0.5}
                stroke="#e5e7eb" strokeWidth="1" />
          {/* Scrollable group: bars + x-labels + hover crosshair. */}
          <g clipPath={`url(#${clipId})`}>
            <g ref={scrollGroupRef}
               transform={`translate(${scrollXRef.current}, 0)`}>
              {/* X-axis labels — auto-thinned. */}
              {data.map((d, i) => {
                if (i % labelStep !== 0 && i !== data.length - 1) return null;
                return (
                  <text key={`x-${i}`} x={xCenter(i)} y={h - 12}
                        textAnchor="middle" fontSize="11"
                        fill="var(--muted)" fontFamily="inherit">
                    {fmtDay(d.day)}
                  </text>
                );
              })}
              {/* Bars + per-day tick markers. For days with zero orders
                  we still draw a 1×2 px tick at the baseline so wide
                  periods (half-year × day = 180 buckets, most empty)
                  visually read as "180 days of timeline, most empty"
                  instead of "5 random bars in empty space". Reassures
                  the merchant the chart loaded the full range. */}
              {data.map((d, i) => {
                const total = (d.new || 0) + (d.returning || 0);
                const cx = xCenter(i);
                if (total === 0) {
                  return (
                    <rect key={`tick-${i}`}
                          x={cx - 0.5} y={padT + innerH - 2}
                          width={1} height={2}
                          fill="#cbd5e1" />
                  );
                }
                const x  = cx - bw / 2;
                const ret_h = ((d.returning || 0) / max) * innerH;
                const new_h = ((d.new      || 0) / max) * innerH;
                const ret_y = padT + innerH - ret_h;
                const new_y = ret_y - new_h;
                const isHov = hover === i;
                return (
                  <g key={i} opacity={hover != null && !isHov ? 0.55 : 1}>
                    {ret_h > 0 && (
                      <rect x={x} y={ret_y} width={bw} height={ret_h}
                            fill="var(--accent)" opacity="0.45" />
                    )}
                    {new_h > 0 && (
                      <rect x={x} y={new_y} width={bw} height={new_h}
                            fill="var(--accent)" />
                    )}
                    {showNumLabels && hover == null && (
                      <text x={cx} y={new_y - 5} textAnchor="middle"
                            fontSize="10" fontWeight="600" fill="var(--text)"
                            fontFamily="inherit">
                        {total}
                      </text>
                    )}
                  </g>
                );
              })}
              {/* Hover crosshair — inside scroll group so it tracks the bar. */}
              {hoverPt && !dragRef.current.active && (
                <line x1={hoverPt.cx} x2={hoverPt.cx}
                      y1={padT} y2={padT + innerH}
                      stroke="#c7c7cc" strokeWidth="1" strokeDasharray="3 3" />
              )}
            </g>
          </g>
          {/* Tooltip OUTSIDE the scroll group — uses screen-x = chart-x + scrollX. */}
          {hoverPt && !dragRef.current.active && (() => {
            const screenX = hoverPt.cx + scrollXRef.current;
            if (screenX < padL || screenX > wrapperW - padR) return null;
            const lines = [
              fmtDayFull(hoverPt.date),
              `New: ${hoverPt.nw}`,
              `Returning: ${hoverPt.rt}`,
              `Total: ${hoverTotal}`,
            ];
            const longestChars = Math.max(...lines.map(l => l.length));
            const bw2 = Math.max(160, longestChars * 7 + 24);
            const bh  = 4 + lines.length * 16 + 6;
            const bx = Math.min(wrapperW - padR - bw2,
                       Math.max(padL, screenX - bw2 / 2));
            const by = Math.max(padT + 4, hoverY - bh - 12);
            return (
              <g pointerEvents="none">
                <rect x={bx} y={by} width={bw2} height={bh} rx="8"
                      fill="rgba(20,20,30,0.92)" />
                {lines.map((line, j) => (
                  <text key={j} x={bx + 12} y={by + 18 + j * 16}
                        fontSize="11" fill="#fff" fontFamily="inherit"
                        fontWeight={j === 0 ? 600 : 400}>
                    {line}
                  </text>
                ))}
              </g>
            );
          })()}
        </svg>
      </div>
      <div className="an-legend">
        <span className="an-legend-dot an-legend-dot--new" /> New (first-ever order)
        <span className="an-legend-dot an-legend-dot--ret" /> Returning (≥2nd order)
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 9 — Cohort retention
// ════════════════════════════════════════════════════════════════════════
function CohortRetentionSection({ projectId }) {
  // Cohorts ignore period — period selector is hidden for this section.
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    fetch(`${API_BASE}/api/analytics/cohort-retention?project_id=${projectId}&months=6`,
          { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(j => setData(j))
      .finally(() => setLoading(false));
  }, [projectId]);
  return (
    <SectionShell title="Cohort retention (last 6 months)" Icon={Users} hidePeriod>
      <p className="an-section-hint">
        Groups customers by the month they placed their first ever
        order ("cohort"). Each row tracks how many of that cohort came
        back N months later. M0 = the month they joined (always 100%),
        M1 = next month, etc. Reading a row across shows whether your
        repeat-customer rate fades or holds steady over time.
      </p>
      {loading ? <Skeleton height={200} /> :
        !data?.cohorts?.length ? <p className="an-empty">Need at least 2 months of orders to compute cohorts.</p> : (
          <div className="an-tile an-cohort-wrap">
            <table className="an-cohort">
              <thead>
                <tr>
                  <th>Cohort</th>
                  <th className="an-table-num">Size</th>
                  {Array.from({ length: data.months }, (_, i) => (
                    <th key={i} className="an-cohort-h">M{i}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.cohorts.map(c => (
                  <tr key={c.cohort}>
                    <td>{c.cohort}</td>
                    <td className="an-table-num">{c.size}</td>
                    {c.values.map((v, i) => {
                      // Quantize intensity into 6 tiers so the colour
                      // lives in CSS (one class per tier) instead of an
                      // inline rgba string. Easier to theme + matches
                      // GitHub-style heatmap conventions.
                      let tier = 'empty';
                      if (v.pct != null) {
                        if (v.pct === 0)       tier = 't0';
                        else if (v.pct <= 20)  tier = 't1';
                        else if (v.pct <= 40)  tier = 't2';
                        else if (v.pct <= 60)  tier = 't3';
                        else if (v.pct <= 80)  tier = 't4';
                        else                   tier = 't5';
                      }
                      return (
                        <td key={i} className={`an-cohort-cell an-cohort-cell--${tier}`}>
                          {v.pct != null ? `${v.pct.toFixed(0)}%` : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </SectionShell>
  );
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 10 — Returns analysis
// ════════════════════════════════════════════════════════════════════════
const REASON_LABEL = {
  damaged: 'Damaged', wrong_item: 'Wrong item', not_as_described: 'Not as described',
  changed_mind: 'Changed mind', arrived_late: 'Arrived late',
  quality_issue: 'Quality issue', other: 'Other',
};
function ReturnsSection({ projectId }) {
  const [period, setPeriod] = useState('1mo');
  const { data, loading } = useSectionData('/api/analytics/returns', period, projectId);
  return (
    <SectionShell title="Returns analysis" Icon={ArrowUUpLeft}
      periodValue={period} onPeriodChange={setPeriod}>
      {loading || !data ? <Skeleton height={240} /> : (
        <div className="an-ret-grid">
          <div className="an-ret-cell">
            <span className="an-ret-stat-label">Return rate</span>
            <span className="an-ret-stat-value">{data.return_rate_pct.toFixed(1)}%</span>
            <span className="an-ret-stat-sub">
              {data.total_returns} of {data.total_delivered} delivered
            </span>
          </div>
          <div className="an-ret-cell">
            <span className="an-ret-stat-label">Avg refund processing</span>
            <span className="an-ret-stat-value">{fmtDays(data.median_processing_days)}</span>
            <span className="an-ret-stat-sub">median requested → refunded</span>
          </div>
          <div className="an-ret-cell an-ret-cell--wide">
            <h3 className="an-mini-title">Top return reasons</h3>
            {data.reasons.length === 0 ? <p className="an-mini-empty">None this period.</p> : (
              <HorizontalBars
                data={data.reasons.map(r => ({ label: REASON_LABEL[r.reason] || r.reason, count: r.count }))}
                valueKey="count" labelKey="label" formatValue={(v) => `${v}`} />
            )}
          </div>
          <div className="an-ret-cell an-ret-cell--wide">
            <h3 className="an-mini-title">Products with highest return rate</h3>
            {data.top_products.length === 0 ? <p className="an-mini-empty">No data yet.</p> : (
              <table className="an-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="an-table-num">Sold</th>
                    <th className="an-table-num">Returned</th>
                    <th className="an-table-num">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_products.slice(0, 8).map(p => (
                    <tr key={p.id}>
                      <td>{p.title}</td>
                      <td className="an-table-num">{p.sold}</td>
                      <td className="an-table-num">{p.returned}</td>
                      <td className="an-table-num"><b>{p.return_rate_pct.toFixed(1)}%</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </SectionShell>
  );
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 11 — Reviews quality
// ════════════════════════════════════════════════════════════════════════
function ReviewsSection({ projectId }) {
  const [period, setPeriod] = useState('1mo');
  const { data, loading } = useSectionData('/api/analytics/reviews-quality', period, projectId);
  return (
    <SectionShell title="Reviews & ratings" Icon={Star}
      periodValue={period} onPeriodChange={setPeriod}>
      {loading || !data ? <Skeleton height={240} /> : (
        <div className="an-rev-grid">
          <div className="an-rev-cell">
            <span className="an-rev-rating">★ {data.avg_rating.toFixed(2)}</span>
            <span className="an-rev-count">{data.total_reviews} review{data.total_reviews === 1 ? '' : 's'}</span>
          </div>
          <div className="an-rev-cell an-rev-cell--wide">
            <h3 className="an-mini-title">Rating distribution</h3>
            {[5, 4, 3, 2, 1].map(rating => {
              const row = data.distribution.find(d => d.rating === rating);
              const n = row?.count || 0;
              const pct = data.total_reviews ? (n / data.total_reviews * 100) : 0;
              return (
                <div key={rating} className="an-rev-bar-row">
                  <span className="an-rev-bar-label">{rating} ★</span>
                  <div className="an-bar-track"><div className="an-bar-fill" style={{ width: `${pct}%` }} /></div>
                  <span className="an-rev-bar-pct">{pct.toFixed(0)}% ({n})</span>
                </div>
              );
            })}
          </div>
          <div className="an-rev-cell">
            <h3 className="an-mini-title">Top-rated products</h3>
            {data.top_rated.length === 0 ? <p className="an-mini-empty">No reviews yet.</p> : (
              <ul className="an-mini-list">
                {data.top_rated.slice(0, 5).map(p => (
                  <li key={p.id} className="an-mini-row">
                    <span className="an-mini-name">{p.title}</span>
                    <span className="an-mini-val">★ {p.avg.toFixed(2)} · {p.reviews}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="an-rev-cell">
            <h3 className="an-mini-title">Needs attention (avg &lt; 3.5)</h3>
            {data.needs_attention.length === 0 ? (
              <p className="an-mini-empty">All products rated well 🎉</p>
            ) : (
              <ul className="an-mini-list">
                {data.needs_attention.slice(0, 5).map(p => (
                  <li key={p.id} className="an-mini-row">
                    <Warning size={12} className="an-mini-warn" />
                    <span className="an-mini-name">{p.title}</span>
                    <span className="an-mini-val">★ {p.avg.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </SectionShell>
  );
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 12 — Bookings analytics
// ════════════════════════════════════════════════════════════════════════
function BookingsSection({ projectId }) {
  const [period, setPeriod] = useState('1mo');
  const { data, loading } = useSectionData('/api/analytics/bookings', period, projectId);
  return (
    <SectionShell title="Bookings" Icon={CalendarBlank}
      periodValue={period} onPeriodChange={setPeriod}>
      {loading || !data ? <Skeleton height={240} /> :
        data.total === 0 ? (
          <p className="an-empty">No bookings in this period.</p>
        ) : (
          <div className="an-bk-grid">
            <Kpi label="Total bookings" value={fmtInt(data.total)} />
            <Kpi label="Completed"      value={fmtInt(data.completed)} />
            <Kpi label="No-show rate"   value={`${data.no_show_rate_pct.toFixed(1)}%`}    inverse />
            <Kpi label="Cancellation"   value={`${data.cancellation_rate_pct.toFixed(1)}%`} inverse />
            <div className="an-bk-cell an-bk-cell--wide">
              <h3 className="an-mini-title">Cassa by service</h3>
              {data.cassa_by_service.length === 0 ? <p className="an-mini-empty">No completed bookings.</p> :
                <HorizontalBars data={data.cassa_by_service.map(s => ({ service: s.service, cassa: s.cassa }))}
                  valueKey="cassa" labelKey="service" formatValue={fmtMoney} />}
            </div>
            <div className="an-bk-cell an-bk-cell--wide">
              <h3 className="an-mini-title">Cassa by staff</h3>
              {data.cassa_by_staff.length === 0 ? <p className="an-mini-empty">No staff with completed bookings.</p> :
                <HorizontalBars data={data.cassa_by_staff.map(s => ({
                  name: `${s.name}${s.commission_pct ? ` · ${s.commission_pct}%` : ''}`,
                  cassa: s.cassa,
                }))} valueKey="cassa" labelKey="name" formatValue={fmtMoney} />}
            </div>
          </div>
        )}
    </SectionShell>
  );
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 12.a — Traffic sources (Direct / Organic / Social / Referral / UTM)
// ════════════════════════════════════════════════════════════════════════
function TrafficSourcesSection({ projectId }) {
  const [period, setPeriod] = useState('1mo');
  const { data, loading } = useSectionData('/api/analytics/traffic-sources', period, projectId);
  return (
    <SectionShell title="Traffic sources" Icon={Globe}
      periodValue={period} onPeriodChange={setPeriod}>
      <p className="an-section-hint">
        Where your visitors come from. Source breakdown buckets them
        into 4 channels: direct (typed URL or bookmark), organic
        (Google/Yandex search), social (FB/IG/X), referral (any other
        external site). Top referrers — exact domains that linked to
        you. Numbers = unique visitors; bar width = share of total
        traffic.
      </p>
      {loading || !data ? <Skeleton height={200} /> : (
        <div className="an-traffic-grid">
          <div className="an-traffic-cell">
            <h3 className="an-mini-title">Source breakdown</h3>
            {data.sources.length === 0 ? <p className="an-mini-empty">No traffic yet.</p> :
              <HorizontalBars data={data.sources} valueKey="visitors" labelKey="source"
                mode="share" formatValue={(v) => `${v}`} />}
          </div>
          <div className="an-traffic-cell">
            <h3 className="an-mini-title">Top referrers</h3>
            {data.referrers.length === 0 ? <p className="an-mini-empty">No external referrers.</p> :
              <HorizontalBars data={data.referrers} valueKey="visitors" labelKey="host"
                mode="share" formatValue={(v) => `${v}`} />}
          </div>
          {data.campaigns.length > 0 && (
            <div className="an-traffic-cell an-traffic-cell--wide">
              <h3 className="an-mini-title">UTM campaigns</h3>
              <table className="an-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Medium</th>
                    <th>Campaign</th>
                    <th className="an-table-num">Visitors</th>
                  </tr>
                </thead>
                <tbody>
                  {data.campaigns.map((c, i) => (
                    <tr key={i}>
                      <td>{c.utm_source || '—'}</td>
                      <td>{c.utm_medium || '—'}</td>
                      <td>{c.utm_campaign || '—'}</td>
                      <td className="an-table-num">{c.visitors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </SectionShell>
  );
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 12.b — Device + browser breakdown
// ════════════════════════════════════════════════════════════════════════
function DevicesSection({ projectId }) {
  const [period, setPeriod] = useState('1mo');
  const { data, loading } = useSectionData('/api/analytics/devices', period, projectId);
  return (
    <SectionShell title="Devices & browsers" Icon={DeviceMobile}
      periodValue={period} onPeriodChange={setPeriod}>
      <p className="an-section-hint">
        What your visitors browse on. Number = unique people (deduped
        by IP); bar = share of the total. If mobile dominates
        but your design is desktop-first, that's a UX gap to close. NB:
        same person on the same machine in Chrome + Edge counts twice
        — browsers don't share session cookies cross-app.
      </p>
      {loading || !data ? <Skeleton height={160} /> : (
        <div className="an-traffic-grid">
          <div className="an-traffic-cell">
            <h3 className="an-mini-title">Device type</h3>
            {data.devices.length === 0 ? <p className="an-mini-empty">No data.</p> :
              <HorizontalBars data={data.devices} valueKey="visitors" labelKey="device"
                mode="share" formatValue={(v) => `${v}`} />}
          </div>
          <div className="an-traffic-cell">
            <h3 className="an-mini-title">Browser</h3>
            {data.browsers.length === 0 ? <p className="an-mini-empty">No data.</p> :
              <HorizontalBars data={data.browsers} valueKey="visitors" labelKey="browser"
                mode="share" formatValue={(v) => `${v}`} />}
          </div>
        </div>
      )}
    </SectionShell>
  );
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 12.c — Countries
// ════════════════════════════════════════════════════════════════════════
function CountriesSection({ projectId }) {
  const [period, setPeriod] = useState('1mo');
  const { data, loading } = useSectionData('/api/analytics/countries', period, projectId);
  return (
    <SectionShell title="Top countries" Icon={Globe}
      periodValue={period} onPeriodChange={setPeriod}>
      {loading || !data ? <Skeleton height={200} /> :
        data.length === 0 ? <p className="an-empty">No country data yet. Pre-2026-05 visits show as "Unknown" — only newer rows are enriched.</p> : (
          <div className="an-tile">
          <table className="an-table">
            <thead>
              <tr>
                <th>Country</th>
                <th className="an-table-num">Code</th>
                <th className="an-table-num">Visitors</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c, i) => (
                <tr key={i}>
                  <td>{c.name}</td>
                  <td className="an-table-num"><code>{c.code}</code></td>
                  <td className="an-table-num">{c.visitors}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
    </SectionShell>
  );
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 12.d — Search insights
// ════════════════════════════════════════════════════════════════════════
function SearchInsightsSection({ projectId }) {
  const [period, setPeriod] = useState('1mo');
  const { data, loading } = useSectionData('/api/analytics/search-insights', period, projectId);
  return (
    <SectionShell title="Search insights" Icon={MagnifyingGlass}
      periodValue={period} onPeriodChange={setPeriod}>
      {loading || !data ? <Skeleton height={200} /> : (
        <div className="an-search-grid">
          <Kpi label="Total searches"      value={fmtInt(data.total_searches)} />
          <Kpi label="Zero-result queries" value={fmtInt(data.zero_result_searches)} inverse />
          <div className="an-search-cell an-search-cell--wide">
            <h3 className="an-mini-title">Top searches</h3>
            {data.top.length === 0 ? <p className="an-mini-empty">No searches yet.</p> : (
              <table className="an-table">
                <thead>
                  <tr>
                    <th>Query</th>
                    <th className="an-table-num">Searches</th>
                    <th className="an-table-num">Avg results</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top.slice(0, 10).map((q, i) => (
                    <tr key={i}>
                      <td><code>{q.query}</code></td>
                      <td className="an-table-num">{q.searches}</td>
                      <td className="an-table-num">{q.avg_results}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {data.zero.length > 0 && (
            <div className="an-search-cell an-search-cell--wide">
              <h3 className="an-mini-title">Zero-result queries (catalog gaps)</h3>
              <table className="an-table">
                <thead>
                  <tr>
                    <th>Query</th>
                    <th className="an-table-num">Searches</th>
                  </tr>
                </thead>
                <tbody>
                  {data.zero.slice(0, 10).map((q, i) => (
                    <tr key={i}>
                      <td><code>{q.query}</code></td>
                      <td className="an-table-num">{q.searches}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </SectionShell>
  );
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 12.e — Goals progress widget
// ════════════════════════════════════════════════════════════════════════
function GoalsWidgetSection({ projectId }) {
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    fetch(`${API_BASE}/api/goals?project_id=${projectId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setData)
      .finally(() => setLoading(false));
  }, [projectId]);

  const active = useMemo(() => data.filter(g => g.is_active).slice(0, 6), [data]);
  return (
    <SectionShell title="Targets progress" Icon={Target} hidePeriod>
      {loading ? <Skeleton height={180} /> :
        active.length === 0 ? (
          <p className="an-empty">
            No active targets. Set them on the <a href="goals" className="an-link">Targets page</a>.
          </p>
        ) : (
          <div className="an-goals-list">
            {active.map(g => {
              const p = g.progress || { current: 0, target: 1 };
              const pct = Math.min(100, (p.current / Math.max(p.target, 1)) * 100);
              return (
                <div key={g.id} className={`an-goal-row an-goal-row--${g.status}`}>
                  <div className="an-goal-head">
                    <span className="an-goal-name">🎯 {g.name}</span>
                    <span className="an-goal-pct">{pct.toFixed(0)}%</span>
                  </div>
                  <div className="an-bar-track">
                    <div className={`an-bar-fill an-goal-fill--${g.status}`}
                         style={{ width: `${Math.max(2, pct)}%` }} />
                  </div>
                  <span className="an-goal-meta">
                    {p.current.toFixed(0)} / {p.target.toFixed(0)} target ·{' '}
                    <b>{g.status.replace('_', ' ')}</b>
                  </span>
                </div>
              );
            })}
          </div>
        )}
    </SectionShell>
  );
}


// ════════════════════════════════════════════════════════════════════════
// SECTION — Margin analysis (Product → Variation → SKU hierarchy)
// ════════════════════════════════════════════════════════════════════════
// Margin colour tier — accent (default = healthy) and red (< 20 % = thin
// or loss). Green tier was removed; the design language across the page
// uses only blue accent + red as the alarm colour.
const marginTone = (pct) => {
  if (pct == null) return '';     // no sales — rendered as "—", neutral
  return pct < 20 ? ' an-margin-pct--bad' : '';
};
const MARGIN_COLS = '2.4fr 90px 1.1fr 1.1fr 1.1fr 110px';

// Small thumbnail at depth=0 inside MarginNameCell. Falls back to a
// neutral circle when the product / variation has no image.
function MarginThumb({ src }) {
  return src
    ? <img src={src} alt="" className="po-tree-avatar" />
    : <span className="po-tree-avatar-fallback" />;
}

// Name cell with tree indentation + chevron — same shape Discounts uses.
function MarginNameCell({ depth = 0, chevron, onChevron, icon, children }) {
  const padLeft = 8 + depth * 24;
  return (
    <span className="po-tree-name-cell" style={{ paddingLeft: padLeft }}>
      {chevron ? (
        <button type="button" className="po-tree-chevron"
          onClick={(e) => { e.stopPropagation(); onChevron?.(); }}>
          {chevron === 'open' ? <CaretDown weight="bold" /> : <CaretRight weight="bold" />}
        </button>
      ) : (
        <span className="po-tree-chevron-spacer" />
      )}
      {icon && <span className="po-tree-icon">{icon}</span>}
      {children}
    </span>
  );
}

function MarginSection({ projectId }) {
  const [period, setPeriod] = useState('1mo');
  const { data, loading } = useSectionData('/api/analytics/margin', period, projectId);
  const [expanded,    setExpanded]    = useState({});  // product_id → bool
  const [expandedVar, setExpandedVar] = useState({});  // variation_id → bool
  const toggleProd = (id) => setExpanded(prev    => ({ ...prev, [id]: !prev[id] }));
  const toggleVar  = (id) => setExpandedVar(prev => ({ ...prev, [id]: !prev[id] }));
  // Export full hierarchy flat — one row per SKU with parent product /
  // variation names denormalised. Merchant gets a spreadsheet they can
  // pivot in Excel without losing the tree relationship.
  const exportCsv = () => {
    if (!data?.products?.length) return;
    const flat = [];
    for (const p of data.products) {
      for (const v of (p.variations || [])) {
        for (const s of (v.skus || [])) {
          flat.push({
            product:    p.title,
            variation:  v.name,
            sku:        s.name,
            sku_code:   s.sku_code,
            units:      s.units,
            revenue:    s.revenue,
            cost:       s.cogs,
            profit:     s.profit,
            margin_pct: s.margin_pct,
          });
        }
      }
    }
    downloadCSV(
      `margin-${period}-${new Date().toISOString().slice(0,10)}.csv`,
      flat,
      [
        { key: 'product',    label: 'Product' },
        { key: 'variation',  label: 'Variation' },
        { key: 'sku',        label: 'SKU' },
        { key: 'sku_code',   label: 'SKU code' },
        { key: 'units',      label: 'Units' },
        { key: 'revenue',    label: 'Revenue', format: v => (+v || 0).toFixed(2) },
        { key: 'cost',       label: 'Cost',    format: v => (+v || 0).toFixed(2) },
        { key: 'profit',     label: 'Profit',  format: v => (+v || 0).toFixed(2) },
        { key: 'margin_pct', label: 'Margin %', format: v => v == null ? '' : (+v).toFixed(1) },
      ]
    );
  };
  return (
    <SectionShell title="Margin analysis" Icon={Percent}
      periodValue={period} onPeriodChange={setPeriod}
      headerControls={<CsvButton onClick={exportCsv} disabled={!data?.products?.length} />}>
      <p className="an-section-hint">
        Gross profit margin = (Revenue − Cost) / Revenue × 100%. Cost
        comes from each SKU's cost_price field on the product page.
        Click a product to expand variations, then a variation to see
        per-SKU breakdown. Margins under 20% render in red — the line
        is too thin to absorb shipping or returns without going
        negative. Unsold SKUs show a dash for margin.
      </p>
      {loading || !data ? <Skeleton height={240} /> :
        !data.products?.length ? (
          <p className="an-empty">No sales yet for this period.</p>
        ) : (
          <>
            <div className="an-margin-totals">
              <Kpi label="Total revenue" value={fmtMoney(data.total_revenue)} />
              <Kpi label="Total cost"    value={fmtMoney(data.total_cogs)} inverse />
              <Kpi label="Gross profit"  value={fmtMoney(data.total_profit)} />
              <Kpi label="Avg margin"
                   value={data.total_margin_pct == null ? '—'
                          : `${data.total_margin_pct.toFixed(1)}%`} />
            </div>
            <div className="po-set-table">
              <div className="po-set-row po-set-row--head"
                   style={{ gridTemplateColumns: MARGIN_COLS }}>
                <span>Product · Variation · SKU</span>
                <span style={{ textAlign: 'right' }}>Units</span>
                <span style={{ textAlign: 'right' }}>Revenue</span>
                <span style={{ textAlign: 'right' }}>Cost</span>
                <span style={{ textAlign: 'right' }}>Profit</span>
                <span style={{ textAlign: 'right' }}>Margin</span>
              </div>
              {data.products.map(p => {
                const isOpen = !!expanded[p.id];
                return (
                  <Fragment key={p.id}>
                    <PoListRow className="po-tree-row"
                      style={{ gridTemplateColumns: MARGIN_COLS }}
                      onClick={() => toggleProd(p.id)}>
                      <MarginNameCell depth={0}
                        chevron={isOpen ? 'open' : 'closed'}
                        onChevron={() => toggleProd(p.id)}
                        icon={<MarginThumb src={p.image} />}>
                        <span className="po-set-strong">{p.title}</span>
                        <span className="po-set-note po-tree-meta">
                          · {p.variations.length} variation{p.variations.length === 1 ? '' : 's'}
                        </span>
                      </MarginNameCell>
                      <span className="an-margin-numcell">{fmtInt(p.units)}</span>
                      <span className="an-margin-numcell">{fmtMoney(p.revenue)}</span>
                      <span className="an-margin-numcell">{fmtMoney(p.cogs)}</span>
                      <span className="an-margin-numcell">{fmtMoney(p.profit)}</span>
                      <span className={`an-margin-numcell an-margin-pct${marginTone(p.margin_pct)}`}>
                        {p.margin_pct == null ? '—' : <b>{p.margin_pct.toFixed(1)}%</b>}
                      </span>
                    </PoListRow>

                    {isOpen && p.variations.map(v => {
                      const vKey  = `${p.id}-${v.id}`;
                      const vOpen = !!expandedVar[vKey];
                      return (
                        <Fragment key={v.id}>
                          <PoListRow className="po-tree-row"
                            style={{ gridTemplateColumns: MARGIN_COLS }}
                            onClick={() => toggleVar(vKey)}>
                            <MarginNameCell depth={1}
                              chevron={vOpen ? 'open' : 'closed'}
                              onChevron={() => toggleVar(vKey)}
                              icon={<MarginThumb src={v.image} />}>
                              <span className="po-set-strong">{v.name}</span>
                              <span className="po-set-note po-tree-meta">
                                · {v.skus.length} SKU{v.skus.length === 1 ? '' : 's'}
                              </span>
                            </MarginNameCell>
                            <span className="an-margin-numcell">{fmtInt(v.units)}</span>
                            <span className="an-margin-numcell">{fmtMoney(v.revenue)}</span>
                            <span className="an-margin-numcell">{fmtMoney(v.cogs)}</span>
                            <span className="an-margin-numcell">{fmtMoney(v.profit)}</span>
                            <span className={`an-margin-numcell an-margin-pct${marginTone(v.margin_pct)}`}>
                              {v.margin_pct == null ? '—' : `${v.margin_pct.toFixed(1)}%`}
                            </span>
                          </PoListRow>

                          {vOpen && v.skus.map(s => (
                            <PoListRow key={s.id} className="po-tree-row"
                              style={{ gridTemplateColumns: MARGIN_COLS }}>
                              <MarginNameCell depth={2}
                                icon={<Cube className="po-disc-cell--muted" />}>
                                <span>{s.name}</span>
                                {s.sku_code && (
                                  <span className="po-set-note po-tree-meta">· {s.sku_code}</span>
                                )}
                              </MarginNameCell>
                              <span className="an-margin-numcell">{fmtInt(s.units)}</span>
                              <span className="an-margin-numcell">{fmtMoney(s.revenue)}</span>
                              <span className="an-margin-numcell">{fmtMoney(s.cogs)}</span>
                              <span className="an-margin-numcell">{fmtMoney(s.profit)}</span>
                              <span className={`an-margin-numcell an-margin-pct${marginTone(s.margin_pct)}`}>
                                {s.margin_pct == null ? '—' : `${s.margin_pct.toFixed(1)}%`}
                              </span>
                            </PoListRow>
                          ))}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}
            </div>
          </>
        )}
    </SectionShell>
  );
}


// ════════════════════════════════════════════════════════════════════════
// SECTION 13 — Inventory health
// ════════════════════════════════════════════════════════════════════════
function InventorySection({ projectId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    fetch(`${API_BASE}/api/analytics/inventory-health?project_id=${projectId}`,
          { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(j => setData(j))
      .finally(() => setLoading(false));
  }, [projectId]);
  return (
    <SectionShell title="Inventory health" Icon={Package} hidePeriod>
      {loading || !data ? <Skeleton height={140} /> : (
        <div className="an-tile an-inv-grid">
          <div className="an-inv-bar-track">
            {/* Three rounded pills sized by their data value via flex-grow
                so the proportions track {oos, low, healthy} and the gap
                between them is fixed regardless of distribution. Empty
                buckets are skipped so the gap doesn't render as a phantom
                tick. */}
            {data.oos > 0 && (
              <div className="an-inv-bar-pill an-inv-bar-pill--oos"
                   style={{ flex: data.oos }} />
            )}
            {data.low > 0 && (
              <div className="an-inv-bar-pill an-inv-bar-pill--low"
                   style={{ flex: data.low }} />
            )}
            {data.healthy > 0 && (
              <div className="an-inv-bar-pill an-inv-bar-pill--healthy"
                   style={{ flex: data.healthy }} />
            )}
          </div>
          <div className="an-inv-legend">
            <span><span className="an-inv-dot an-inv-dot--oos" />OOS · {data.oos}</span>
            <span><span className="an-inv-dot an-inv-dot--low" />Low · {data.low}</span>
            <span><span className="an-inv-dot an-inv-dot--healthy" />Healthy · {data.healthy}</span>
          </div>
        </div>
      )}
    </SectionShell>
  );
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 14 — Promo codes performance
// ════════════════════════════════════════════════════════════════════════
function PromoSection({ projectId }) {
  const [period, setPeriod] = useState('1mo');
  const { data, loading } = useSectionData('/api/analytics/promo-performance', period, projectId);
  return (
    <SectionShell title="Promo codes performance" Icon={Tag}
      periodValue={period} onPeriodChange={setPeriod}>
      {loading || !data ? <Skeleton height={200} /> : (
        <div className="an-promo-wrap">
          <div className="an-promo-summary">
            <Kpi label="Total revenue"      value={fmtMoney(data.total_revenue)} />
            <Kpi label="Discount given"     value={fmtMoney(data.total_discount_given)} inverse />
            <Kpi label="Discount share"     value={`${data.discount_share_pct.toFixed(1)}%`} inverse />
          </div>
          {data.codes.length === 0 ? <p className="an-empty">No promo codes redeemed.</p> : (
            <div className="an-tile">
            <table className="an-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th className="an-table-num">Used</th>
                  <th className="an-table-num">Revenue</th>
                  <th className="an-table-num">Discount</th>
                  <th className="an-table-num">Avg order</th>
                </tr>
              </thead>
              <tbody>
                {data.codes.map(c => (
                  <tr key={c.code}>
                    <td><code>{c.code}</code></td>
                    <td className="an-table-num">{c.used}</td>
                    <td className="an-table-num">{fmtMoney(c.revenue)}</td>
                    <td className="an-table-num">{fmtMoney(c.discount_total)}</td>
                    <td className="an-table-num">{fmtMoney(c.avg_order)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}
    </SectionShell>
  );
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 15 — Operations
// ════════════════════════════════════════════════════════════════════════
function OperationsSection({ projectId }) {
  const [period, setPeriod] = useState('1mo');
  const { data, loading } = useSectionData('/api/analytics/operations', period, projectId);
  return (
    <SectionShell title="Operations" Icon={GearSix}
      periodValue={period} onPeriodChange={setPeriod}>
      <p className="an-section-hint">
        Operational SLA — how fast your fulfilment + checkout work.
        Order → shipped: median time from order placed to status
        moving to shipped (your warehouse speed). Shipped → delivered:
        courier transit time. Cart → paid: how long shoppers hesitate
        between adding an item and paying — long values hint at price
        doubts. Abandoned rate: % of carts that never converted.
        Dashes (—) mean we have no data yet for that metric in this
        period.
      </p>
      {loading || !data ? <Skeleton height={140} /> : (
        <div className="an-ops-grid">
          <Kpi label="Order → shipped"     value={fmtDaysAdaptive(data.median_processing_days)} />
          <Kpi label="Shipped → delivered" value={fmtDaysAdaptive(data.median_shipping_days)} />
          <Kpi label="Cart → paid (median)"  value={fmtHoursAdaptive(data.median_cart_to_paid_hours)} />
          <Kpi label="Abandoned rate"  value={`${data.abandoned_rate_pct.toFixed(1)}%`}
            inverse delta={null} />
        </div>
      )}
    </SectionShell>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Main page — stacks all sections vertically
// ════════════════════════════════════════════════════════════════════════
export default function Analytics() {
  const { projectId, project } = useOutletContext();
  // Project currency drives money formatting across all sections. Set
  // once at mount and on any project switch (different store = different
  // currency). The module-level setter avoids prop-drilling through
  // ~20 child components.
  useEffect(() => {
    if (project?.currency) setAnalyticsCurrency(project.currency);
  }, [project?.currency]);
  // Top-level period is shared by Overview only; everything else has its own.
  const [topPeriod, setTopPeriod] = useState('1mo');
  // Eager (above-fold) vs lazy (below-fold) split. Only the first four
  // sections fetch on mount — the rest defer until scrolled into view
  // (IntersectionObserver in LazySection). This caps the initial parallel-
  // fetch fan-out from 22 → 4-5, which is well under the pool size of 20
  // and well within what FastAPI can answer concurrently. The user sees
  // skeletons that turn into real content as they scroll.
  return (
    <>
      <h1 className="crm-page-title">Analytics</h1>
      <div className="an-page">
        <OverviewSection         projectId={projectId} period={topPeriod} setPeriod={setTopPeriod} />
        <RevenueOverTimeSection  projectId={projectId} />
        <RevenueByCategorySection projectId={projectId} />
        <FunnelSection           projectId={projectId} />
        {/* Margin analysis right after the funnel — most important
            profitability metric for the merchant, no point burying it. */}
        <LazySection minHeight={320}><MarginSection           projectId={projectId} /></LazySection>
        <LazySection minHeight={260}><FunnelDynamicsSection   projectId={projectId} /></LazySection>
        <LazySection minHeight={320}><HeatmapSection          projectId={projectId} /></LazySection>
        <LazySection minHeight={360}><PopularProductsSection  projectId={projectId} /></LazySection>
        <LazySection minHeight={360}><CustomerSection         projectId={projectId} /></LazySection>
        <LazySection minHeight={280}><CohortRetentionSection  projectId={projectId} /></LazySection>
        <LazySection minHeight={300}><ReturnsSection          projectId={projectId} /></LazySection>
        <LazySection minHeight={300}><ReviewsSection          projectId={projectId} /></LazySection>
        <LazySection minHeight={280}><BookingsSection         projectId={projectId} /></LazySection>
        <LazySection minHeight={240}><TrafficSourcesSection   projectId={projectId} /></LazySection>
        <LazySection minHeight={220}><DevicesSection          projectId={projectId} /></LazySection>
        <LazySection minHeight={240}><CountriesSection        projectId={projectId} /></LazySection>
        <LazySection minHeight={260}><SearchInsightsSection   projectId={projectId} /></LazySection>
        <LazySection minHeight={220}><GoalsWidgetSection      projectId={projectId} /></LazySection>
        <LazySection minHeight={180}><InventorySection        projectId={projectId} /></LazySection>
        <LazySection minHeight={260}><PromoSection            projectId={projectId} /></LazySection>
        <LazySection minHeight={180}><OperationsSection       projectId={projectId} /></LazySection>
      </div>
    </>
  );
}
