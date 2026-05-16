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

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  ChartLine, Users, MapPin, Star, ArrowUUpLeft,
  CalendarBlank, Package, Warning, Tag, GearSix, Funnel,
  DeviceMobile, Globe, MagnifyingGlass, Target,
  Eye, ShoppingCart, PlusCircle, CheckCircle,
} from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { Combobox } from './Booking/BookingCreateModal.jsx';
// Organization.css carries the .org-sort-toggle styles we reuse for the
// Day/Week/Month granularity picker inside Revenue-over-time.
// Products.css is required for the Combobox dropdown (.cat-filter-dropdown,
// .cat-filter-item, .cat-filter-indicator) — without it the period menu
// renders unstyled and invisibly (no position:fixed / z-index).
import '../../Style/Organization.css';
import '../../Style/Products.css';
import '../../Style/Analytics.css';

// ── Period codes — match _date_range_for_period in CRM backend ───────────
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
];
// Same codes as a plain array so we can step forward/back when the user
// zooms the chart with Ctrl+wheel — +1 = wider window (zoom out), −1 =
// narrower window (zoom in). Kept in sync with PERIOD_OPTIONS above.
const PERIOD_ORDER = PERIOD_OPTIONS.map(o => o.value);

// ── Reusable section shell ───────────────────────────────────────────────
// Section visual: flat heading (like Products page groups — "Physical [5]")
// + optional period picker on the right. NO outer card wrapper — sections
// blend into the page background; only the inner cells (KPIs, mini-lists,
// tables) are white tiles with shadow. The `Icon` prop is accepted but
// intentionally ignored — design called for plain text headings.
function SectionShell({ title, periodValue, onPeriodChange, hidePeriod, headerControls, children }) {
  return (
    <section className="an-section">
      <header className="an-section-head">
        <h2 className="an-section-title">{title}</h2>
        <div className="an-section-controls">
          {headerControls /* extra filter chips (e.g. Day/Week/Month for charts) */}
          {!hidePeriod && (
            <div className="an-section-period">
              <Combobox value={periodValue} options={PERIOD_OPTIONS} onChange={onPeriodChange} />
            </div>
          )}
        </div>
      </header>
      <div className="an-section-body">{children}</div>
    </section>
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
const fmtMoney = (n) => `$${(+n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtInt   = (n) => (+n || 0).toLocaleString('en-US');
const fmtPct   = (n, signed) => {
  if (n == null) return '—';
  const v = +n;
  const sign = signed && v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
};
const fmtDate  = (s) => s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
const fmtDays  = (n) => n == null ? '—' : `${(+n).toFixed(1)} d`;

// Tone helper — green for "good" (revenue ↑, conversion ↑) vs "bad" (returns ↑).
const deltaTone = (n, inverse = false) => {
  if (n == null || n === 0) return '';
  const positive = inverse ? n < 0 : n > 0;
  return positive ? ' an-delta--up' : ' an-delta--down';
};

// ── Inline SVG line chart ────────────────────────────────────────────────
// Two-series smooth-curve chart with:
//  • Catmull-Rom → cubic Bezier interpolation for soft curves
//  • Y-axis labels on the RIGHT side (matches finance-tracker convention)
//  • X-axis date labels at the bottom (auto-thinned for long series)
//  • Hover crosshair + tooltip bubble with date + value
//  • Ctrl/Cmd + wheel zoom → calls `onZoom(±1)` to step period up/down
//  • Drag to pan → calls `onPan(±1)` after threshold
// The chart container should set its own height via CSS; we use a fixed
// viewBox (1200×360) and `preserveAspectRatio: none` so width fills the
// parent and the curve stays visually proportional.
function LineChart({
  current = [], previous = [],
  height = 320, valueKey = 'revenue', dateKey = 'bucket',
  formatValue = (v) => `$${Math.round(v).toLocaleString('en-US')}`,
  onZoom, onPan,
}) {
  const w = 1200, h = height;
  const pad = { l: 24, r: 72, t: 28, b: 38 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;

  const [hover, setHover] = useState(null);   // index of nearest current point
  const [dragX, setDragX] = useState(null);   // pan-drag start clientX

  const allVals = [...current, ...previous].map(d => +d[valueKey] || 0);
  const maxRaw = Math.max(1, ...allVals);
  const minRaw = Math.min(0, ...allVals);
  // Pad y-range by 10% on top so the highest point doesn't kiss the ceiling.
  const max = maxRaw + (maxRaw - minRaw) * 0.1;
  const min = minRaw;

  const xScale = (i, len) => pad.l + (i / Math.max(1, len - 1)) * innerW;
  const yScale = (v) => {
    const range = max - min || 1;
    return pad.t + innerH * (1 - (v - min) / range);
  };

  // Catmull-Rom → Bezier conversion with control-point clamping. Each
  // segment uses neighbours for tangent computation; ends mirror their
  // nearest interior point. Control points get clamped to the chart's
  // visible y range so a zero→spike→zero pattern (e.g. one sale day
  // surrounded by empty days) doesn't make the curve dip below the
  // baseline or shoot above the ceiling. Without clamping, Catmull-Rom
  // produces visible undershoot on either side of any tall spike.
  const yTop = pad.t;
  const yBot = pad.t + innerH;
  const clampY = (y) => Math.max(yTop, Math.min(yBot, y));
  const smoothPath = (rows) => {
    if (rows.length < 2) {
      if (rows.length === 1) {
        const x = xScale(0, 1), y = yScale(+rows[0][valueKey] || 0);
        return `M${x},${y}`;
      }
      return '';
    }
    const pts = rows.map((d, i) => [xScale(i, rows.length), yScale(+d[valueKey] || 0)]);
    let path = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
      const cp1y = clampY(p1[1] + (p2[1] - p0[1]) / 6);
      const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
      const cp2y = clampY(p2[1] - (p3[1] - p1[1]) / 6);
      path += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2[0]},${p2[1]}`;
    }
    return path;
  };

  // Pretty Y-axis tick values — produce 5 evenly spaced ticks.
  const tickCount = 5;
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const v = max - ((max - min) * i) / (tickCount - 1);
    return { v, y: pad.t + (innerH * i) / (tickCount - 1) };
  });

  // X-axis tick density — never more than ~8 labels so they don't overlap.
  const labelStep = Math.max(1, Math.ceil(current.length / 8));
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

  // ── Event handlers ──
  // Pan is a "swipe gesture": user presses, drags any direction, then
  // releases. We only fire onPan ONCE on release based on total deltaX
  // sign and magnitude. Previously we fired on every 60px during drag
  // which caused the chart to refetch + re-render mid-drag → cursor
  // jittered, hover tooltip flickered, period switched multiple times
  // before the user could see what happened. One step per gesture is
  // far calmer and matches how trading-chart UIs behave (e.g. TradingView).
  const PAN_THRESHOLD_PX = 80;
  const handleMouseMove = (e) => {
    if (!current.length) return;
    // Suppress hover updates during an active drag — tooltip jumping
    // around at the cursor while the user is panning is visual noise.
    if (dragX != null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xInViewBox = ((e.clientX - rect.left) / rect.width) * w;
    const rel = (xInViewBox - pad.l) / innerW;
    const idx = Math.round(rel * (current.length - 1));
    if (idx >= 0 && idx < current.length) setHover(idx);
    else setHover(null);
  };
  const handleMouseLeave = () => { setHover(null); setDragX(null); };
  const handleMouseDown  = (e) => { if (onPan) { setDragX(e.clientX); setHover(null); } };
  const handleMouseUp    = (e) => {
    if (dragX != null && onPan) {
      const delta = e.clientX - dragX;
      if (Math.abs(delta) >= PAN_THRESHOLD_PX) {
        // Drag right (positive delta) → show earlier dates → onPan(-1)
        // Drag left  (negative delta) → show later  dates → onPan(+1)
        onPan(delta > 0 ? -1 : 1);
      }
    }
    setDragX(null);
  };
  const handleWheel = (e) => {
    // Ctrl+wheel (or Cmd on macOS) zooms — wheel up = zoom in (narrower
    // period), wheel down = zoom out (wider period). No modifier → leave
    // wheel for normal page scrolling.
    if (!onZoom || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    onZoom(e.deltaY > 0 ? +1 : -1);
  };

  // Hover data for the tooltip
  const hoverPt = hover != null && current[hover] ? {
    x: xScale(hover, current.length),
    y: yScale(+current[hover][valueKey] || 0),
    val: +current[hover][valueKey] || 0,
    date: current[hover][dateKey],
  } : null;

  return (
    <svg className="an-chart" viewBox={`0 0 ${w} ${h}`}
         preserveAspectRatio="none"
         onMouseMove={handleMouseMove}
         onMouseLeave={handleMouseLeave}
         onMouseDown={handleMouseDown}
         onMouseUp={handleMouseUp}
         onWheel={handleWheel}
         style={{ height: `${h}px`,
                  cursor: dragX != null ? 'grabbing' : (onPan ? 'grab' : 'default'),
                  touchAction: 'pan-y',
                  userSelect: 'none' }}>
      {/* Y grid lines + labels (right side) */}
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={pad.l} x2={w - pad.r} y1={t.y} y2={t.y}
                stroke="#eef0f3" strokeWidth="1" />
          <text x={w - pad.r + 8} y={t.y + 4} textAnchor="start"
                fontSize="11" fill="#9a9aa0" fontFamily="inherit">
            {fmtY(t.v)}
          </text>
        </g>
      ))}

      {/* X axis labels (bottom) */}
      {current.map((d, i) => {
        if (i % labelStep !== 0 && i !== current.length - 1) return null;
        return (
          <text key={`x-${i}`}
                x={xScale(i, current.length)} y={h - 14}
                textAnchor="middle" fontSize="11" fill="#9a9aa0"
                fontFamily="inherit">
            {fmtX(d[dateKey])}
          </text>
        );
      })}

      {/* Previous period — dashed faded */}
      {previous.length > 0 && (
        <path d={smoothPath(previous)} fill="none"
              stroke="#9a9aa0" strokeWidth="1.5" strokeDasharray="4 4"
              opacity="0.7" />
      )}

      {/* Current period — solid accent */}
      <path d={smoothPath(current)} fill="none"
            stroke="var(--accent)" strokeWidth="2.6"
            strokeLinecap="round" strokeLinejoin="round" />

      {/* Hover crosshair + dot + tooltip */}
      {hoverPt && (
        <g>
          <line x1={hoverPt.x} x2={hoverPt.x} y1={pad.t} y2={h - pad.b}
                stroke="#c7c7cc" strokeWidth="1" strokeDasharray="3 3" />
          <circle cx={hoverPt.x} cy={hoverPt.y} r="6"
                  fill="var(--accent)" stroke="#fff" strokeWidth="2" />
          {/* Bubble with value */}
          {(() => {
            const valStr = formatValue(hoverPt.val);
            // Approximate bubble width — 7px per char + 16px padding.
            const bw = Math.max(60, valStr.length * 7 + 16);
            const bx = Math.max(pad.l, Math.min(w - pad.r - bw, hoverPt.x - bw / 2));
            const by = Math.max(pad.t, hoverPt.y - 38);
            return (
              <>
                <rect x={bx} y={by} width={bw} height="24" rx="6"
                      fill="var(--accent)" />
                <text x={bx + bw / 2} y={by + 16} textAnchor="middle"
                      fontSize="12" fontWeight="600" fill="#fff"
                      fontFamily="inherit">
                  {valStr}
                </text>
              </>
            );
          })()}
          {/* Date label above tooltip */}
          <text x={hoverPt.x} y={Math.max(pad.t - 6, hoverPt.y - 44)}
                textAnchor="middle" fontSize="11" fill="var(--muted)"
                fontFamily="inherit">
            {fmtXFull(hoverPt.date)}
          </text>
        </g>
      )}
    </svg>
  );
}

// ── Inline SVG horizontal bar (stacked or simple) ────────────────────────
function HorizontalBars({ data, valueKey = 'revenue', labelKey = 'category', max, formatValue }) {
  const fmt = formatValue || ((v) => v.toLocaleString('en-US'));
  const computedMax = max || Math.max(1, ...data.map(d => +d[valueKey] || 0));
  return (
    <div className="an-bars">
      {data.map((d, i) => {
        const v = +d[valueKey] || 0;
        const pct = computedMax ? (v / computedMax) * 100 : 0;
        return (
          <div key={i} className="an-bar-row">
            <span className="an-bar-label">{d[labelKey] || '—'}</span>
            <div className="an-bar-track">
              <div className="an-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="an-bar-value">{fmt(v)}</span>
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
      periodValue={period} onPeriodChange={setPeriod}>
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

function RevenueOverTimeSection({ projectId }) {
  const [period, setPeriod] = useState('1mo');
  const [gran,   setGran]   = useState('day');
  // useSectionData appends ?project_id=…&period=… automatically; for this
  // endpoint we need an extra `granularity` query param so we go through
  // the bypass helper instead.
  const fixedData = useFixedFetch(`/api/analytics/revenue-over-time?project_id=${projectId}&period=${period}&granularity=${gran}`);
  const d = fixedData.data;
  // Day / Week / Month is also a filter, so it lives in the section header
  // next to the period combobox. Visually matches the Products page sort-
  // toggle (.org-sort-toggle) — same pill container + sliding accent pill
  // indicator following the active selection.
  const segmented = (
    <GranularitySegmented value={gran} onChange={setGran} />
  );
  // Chart-driven period control. Ctrl/Cmd+wheel + drag-pan inside the
  // LineChart call these — they step through PERIOD_ORDER so the period
  // combobox visibly reflects the zoom level. Both end-of-range steps
  // are no-ops (we silently clamp instead of wrapping around).
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
        {fixedData.loading || !d ? <Skeleton height={240} /> : (
          d.current.length === 0
            ? <p className="an-empty">No orders in this period.</p>
            : <LineChart current={d.current} previous={d.previous}
                valueKey="revenue" onZoom={stepPeriod} onPan={stepPeriod} />
        )}
      </div>
    </SectionShell>
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
        <div className="an-multi-chart">
          <SmallSeries title="Visit → ATC" series={data} valueKey="visit_to_atc" suffix="%" />
          <SmallSeries title="ATC → Paid"  series={data} valueKey="atc_to_paid"  suffix="%" />
          <SmallSeries title="Overall"     series={data} valueKey="overall"      suffix="%" />
        </div>
      )}
    </SectionShell>
  );
}
function SmallSeries({ title, series, valueKey, suffix }) {
  const max = Math.max(1, ...series.map(d => +d[valueKey] || 0));
  const w = 240, h = 90, pad = 6;
  const path = series.map((d, i) => {
    const x = pad + (i / Math.max(1, series.length - 1)) * (w - pad * 2);
    const y = h - pad - ((+d[valueKey] || 0) / max) * (h - pad * 2);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const latest = series[series.length - 1]?.[valueKey] ?? 0;
  return (
    <div className="an-small-series">
      <span className="an-small-series-title">{title}</span>
      <span className="an-small-series-value">{(+latest).toFixed(1)}{suffix}</span>
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
        <div className="an-tile an-heatmap-wrap">
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
                  const intensity = v / max;
                  return (
                    <div key={`${dow}-${h}`} className="an-heatmap-cell"
                         title={`${DOW_LABELS[dow]} ${h}:00 — ${v} order${v === 1 ? '' : 's'}`}
                         style={{
                           background: v === 0
                             ? 'rgba(0,0,0,0.04)'
                             : `rgba(0,113,227,${0.12 + intensity * 0.78})`,
                         }} />
                  );
                })}
              </Fragment>
            ))}
          </div>
          <div className="an-heatmap-legend">
            <span>Less</span>
            <div className="an-heatmap-gradient" />
            <span>More</span>
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
  const types     = useSectionData('/api/analytics/customer-types', period, projectId);
  const top       = useSectionData('/api/analytics/top-customers',  period, projectId);
  const geo       = useSectionData('/api/analytics/geographic',     period, projectId);
  return (
    <SectionShell title="Customers" Icon={Users}
      periodValue={period} onPeriodChange={setPeriod}>
      <div className="an-cust-grid">
        {/* New vs returning */}
        <div className="an-cust-cell an-cust-cell--wide">
          <h3 className="an-mini-title">New vs returning customers</h3>
          {types.loading ? <Skeleton height={180} /> :
            !types.data?.length ? <p className="an-empty">No orders yet.</p> :
            <NewReturningChart data={types.data} />}
        </div>
        {/* Top customers */}
        <div className="an-cust-cell">
          <h3 className="an-mini-title">Top customers</h3>
          {top.loading ? <Skeleton height={180} /> :
            !top.data?.length ? <p className="an-mini-empty">No customers yet.</p> : (
              <table className="an-table">
                <thead>
                  <tr><th>Customer</th><th>Orders</th><th>Spent</th></tr>
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
            !geo.data?.length ? <p className="an-mini-empty">No shipping data.</p> : (
              <table className="an-table">
                <thead>
                  <tr><th>City</th><th>Orders</th><th>Revenue</th></tr>
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
function NewReturningChart({ data }) {
  // Stacked bars per day — new on top of returning. Simple SVG.
  const w = 720, h = 200, pad = { l: 24, r: 8, t: 8, b: 22 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const max = Math.max(1, ...data.map(d => (d.new || 0) + (d.returning || 0)));
  const bw = innerW / Math.max(1, data.length);
  return (
    <div className="an-cust-chart">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="an-chart">
        {data.map((d, i) => {
          const total = (d.new || 0) + (d.returning || 0);
          const x = pad.l + i * bw;
          const ret_h = ((d.returning || 0) / max) * innerH;
          const new_h = ((d.new || 0) / max) * innerH;
          const ret_y = pad.t + innerH - ret_h;
          const new_y = ret_y - new_h;
          return (
            <g key={i}>
              <rect x={x + 1} y={ret_y} width={Math.max(1, bw - 2)} height={ret_h}
                fill="var(--accent)" opacity="0.45" />
              <rect x={x + 1} y={new_y} width={Math.max(1, bw - 2)} height={new_h}
                fill="var(--accent)" />
            </g>
          );
        })}
      </svg>
      <div className="an-legend">
        <span className="an-legend-dot an-legend-dot--new" /> New
        <span className="an-legend-dot an-legend-dot--ret" /> Returning
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
      {loading ? <Skeleton height={200} /> :
        !data?.cohorts?.length ? <p className="an-empty">Need at least 2 months of orders to compute cohorts.</p> : (
          <div className="an-tile an-cohort-wrap">
            <table className="an-cohort">
              <thead>
                <tr>
                  <th>Cohort</th>
                  <th>Size</th>
                  {Array.from({ length: data.months }, (_, i) => (
                    <th key={i}>M{i}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.cohorts.map(c => (
                  <tr key={c.cohort}>
                    <td>{c.cohort}</td>
                    <td className="an-table-num">{c.size}</td>
                    {c.values.map((v, i) => (
                      <td key={i} className="an-cohort-cell"
                          style={{
                            background: v.pct == null ? 'transparent'
                              : `rgba(0,113,227,${0.08 + (v.pct / 100) * 0.65})`,
                            color: v.pct != null && v.pct > 40 ? '#fff' : 'inherit',
                          }}>
                        {v.pct != null ? `${v.pct.toFixed(0)}%` : '—'}
                      </td>
                    ))}
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
                <thead><tr><th>Product</th><th>Sold</th><th>Returned</th><th>Rate</th></tr></thead>
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
      {loading || !data ? <Skeleton height={200} /> : (
        <div className="an-traffic-grid">
          <div className="an-traffic-cell">
            <h3 className="an-mini-title">Source breakdown</h3>
            {data.sources.length === 0 ? <p className="an-mini-empty">No traffic yet.</p> :
              <HorizontalBars data={data.sources} valueKey="visitors" labelKey="source"
                formatValue={(v) => `${v}`} />}
          </div>
          <div className="an-traffic-cell">
            <h3 className="an-mini-title">Top referrers</h3>
            {data.referrers.length === 0 ? <p className="an-mini-empty">No external referrers.</p> :
              <HorizontalBars data={data.referrers} valueKey="visitors" labelKey="host"
                formatValue={(v) => `${v}`} />}
          </div>
          {data.campaigns.length > 0 && (
            <div className="an-traffic-cell an-traffic-cell--wide">
              <h3 className="an-mini-title">UTM campaigns</h3>
              <table className="an-table">
                <thead>
                  <tr><th>Source</th><th>Medium</th><th>Campaign</th><th>Visitors</th></tr>
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
      {loading || !data ? <Skeleton height={160} /> : (
        <div className="an-traffic-grid">
          <div className="an-traffic-cell">
            <h3 className="an-mini-title">Device type</h3>
            {data.devices.length === 0 ? <p className="an-mini-empty">No data.</p> :
              <HorizontalBars data={data.devices} valueKey="visitors" labelKey="device"
                formatValue={(v) => `${v}`} />}
          </div>
          <div className="an-traffic-cell">
            <h3 className="an-mini-title">Browser</h3>
            {data.browsers.length === 0 ? <p className="an-mini-empty">No data.</p> :
              <HorizontalBars data={data.browsers} valueKey="visitors" labelKey="browser"
                formatValue={(v) => `${v}`} />}
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
            <thead><tr><th>Country</th><th>Code</th><th>Visitors</th></tr></thead>
            <tbody>
              {data.map((c, i) => (
                <tr key={i}>
                  <td>{c.name}</td>
                  <td><code>{c.code}</code></td>
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
                <thead><tr><th>Query</th><th>Searches</th><th>Avg results</th></tr></thead>
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
                <thead><tr><th>Query</th><th>Searches</th></tr></thead>
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
            No active targets. Set them on the <a href="goals" style={{ color: 'var(--accent)' }}>Targets page</a>.
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
          <div className="an-inv-bar">
            {(() => {
              const total = data.total || 1;
              const oos = (data.oos / total) * 100;
              const low = (data.low / total) * 100;
              const healthy = (data.healthy / total) * 100;
              return (
                <div className="an-inv-bar-track">
                  <div className="an-inv-bar-oos"     style={{ width: `${oos}%` }}      title={`OOS: ${data.oos}`} />
                  <div className="an-inv-bar-low"     style={{ width: `${low}%` }}      title={`Low: ${data.low}`} />
                  <div className="an-inv-bar-healthy" style={{ width: `${healthy}%` }} title={`Healthy: ${data.healthy}`} />
                </div>
              );
            })()}
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
                <tr><th>Code</th><th>Used</th><th>Revenue</th><th>Discount</th><th>Avg order</th></tr>
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
      {loading || !data ? <Skeleton height={140} /> : (
        <div className="an-ops-grid">
          <Kpi label="Order → shipped"    value={fmtDays(data.median_processing_days)} />
          <Kpi label="Shipped → delivered" value={fmtDays(data.median_shipping_days)} />
          <Kpi label="Cart → paid (median)" value={
            data.median_cart_to_paid_hours == null ? '—' : `${data.median_cart_to_paid_hours.toFixed(1)} h`
          } />
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
  const { projectId } = useOutletContext();
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
