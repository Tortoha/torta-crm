// Organization Analytics — rolls every project in the org into one view.
// Reuses the project Analytics design language (an-* section/KPI classes,
// inline-SVG chart, blue accent) and adds cross-project comparison blocks:
// project leaderboard, top-earner / top-margin highlights, revenue & margin
// bars. Each project keeps its own currency; the backend FX-converts revenue
// into the org's display currency so totals + comparison are apples-to-apples.

import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { TrendUp, Percent, Warning, Buildings } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { formatMoney } from '../../Utils/currency.js';
import { Combobox } from '../Project/Booking/BookingCreateModal.jsx';
// Reuse the exact project-Analytics chart (pannable, Day/Week/Month, hover) so
// the org page matches it 1:1. setAnalyticsCurrency points the chart's
// Y-axis + tooltip at the org's display currency.
import { LineChart, GranularitySegmented, setAnalyticsCurrency } from '../Project/Analytics.jsx';
import '../../Style/Organization.css';
import '../../Style/Products.css';      // Combobox dropdown styles
import '../../Style/Analytics.css';

const PERIOD_OPTIONS = [
  { value: '1d',       label: '1 day'           },
  { value: '1w',       label: '1 week'          },
  { value: '1mo',      label: '1 month'         },
  { value: '2mo',      label: '2 months'        },
  { value: 'season',   label: '1 season (3 mo)' },
  { value: 'halfyear', label: 'Half-year'       },
  { value: '1y',       label: '1 year'          },
  { value: '2y',       label: '2 years'         },
];

// ── formatting helpers ───────────────────────────────────────────────
const fmtInt = (n) => new Intl.NumberFormat('en-US').format(Math.round(n || 0));
const fmtPct = (v, signed = false) => {
  if (v == null) return '—';
  const s = signed && v > 0 ? '+' : '';
  return `${s}${(+v).toFixed(1)}%`;
};
const deltaTone = (v, inverse = false) => {
  if (v == null || v === 0) return '';
  const good = inverse ? v < 0 : v > 0;
  return good ? ' an-delta--up' : ' an-delta--down';
};

function Kpi({ label, value, delta, inverse }) {
  return (
    <div className="an-kpi">
      <span className="an-kpi-label">{label}</span>
      <span className="an-kpi-value">{value}</span>
      {delta != null && (
        <span className={`an-delta${deltaTone(delta, inverse)}`}>{fmtPct(delta, true)}</span>
      )}
    </div>
  );
}

// Re-bucket the org's daily revenue series into Day / Week / Month buckets for
// the shared LineChart (which expects [{ bucket, revenue }]).
function bucketSeries(series, gran) {
  if (!series || series.length === 0) return [];
  if (gran === 'day') return series.map(s => ({ bucket: s.day, revenue: s.revenue }));
  const map = new Map();
  for (const s of series) {
    let key;
    if (gran === 'month') {
      key = `${s.day.slice(0, 7)}-01`;
    } else { // week → Monday-anchored
      const d = new Date(`${s.day}T00:00:00Z`);
      const dow = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - dow);
      key = d.toISOString().slice(0, 10);
    }
    map.set(key, (map.get(key) || 0) + s.revenue);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([bucket, revenue]) => ({ bucket, revenue: Math.round(revenue * 100) / 100 }));
}
const VIEWPORT_BUCKETS = { day: 30, week: 16, month: 12 };

// ── horizontal bar list — reuses the project Analytics `an-bars` primitive.
// rows: [{ label, value, text }]; bar width = value / max.
function BarList({ rows, max, tone }) {
  return (
    <div className="an-bars">
      {rows.map((r, i) => (
        <div key={i} className="an-bar-row">
          <span className="an-bar-label" title={r.label}>{r.label}</span>
          <div className="an-bar-track">
            <div className={`an-bar-fill${tone ? ` oa-fill--${tone}` : ''}`}
              style={{ width: `${Math.max(0, Math.min(100, max ? (r.value / max) * 100 : 0))}%` }} />
          </div>
          <span className="an-bar-value">{r.text}</span>
        </div>
      ))}
    </div>
  );
}

export default function OrgAnalytics() {
  const { org } = useOutletContext();
  const orgId = org?.id;
  const [period, setPeriod] = useState('1mo');
  const [gran, setGran] = useState('day');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    setLoading(true);
    fetch(`${API_BASE}/api/orgs/${orgId}/analytics?period=${period}`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive) { setData(d); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [orgId, period]);

  const ccy = data?.currency || 'USD';
  // Point the shared LineChart's Y-axis + tooltip formatter at the org currency.
  setAnalyticsCurrency(ccy);
  const money = useMemo(() => (v) => formatMoney(v, ccy, { decimals: 0 }), [ccy]);
  const moneyExact = useMemo(() => (v) => formatMoney(v, ccy), [ccy]);

  const cur   = data?.totals?.current || {};
  const delta = data?.totals?.delta || {};
  const projects = data?.projects || [];
  const maxRev = Math.max(...projects.map(p => p.revenue), 1);
  const buckets = useMemo(() => bucketSeries(data?.series, gran), [data, gran]);

  // Highlights — top earner + top margin (skip projects with no sales).
  const topEarner = projects.find(p => p.revenue > 0) || null;
  const withMargin = projects.filter(p => p.margin_pct != null);
  const topMargin = withMargin.length
    ? withMargin.reduce((a, b) => (b.margin_pct > a.margin_pct ? b : a))
    : null;

  return (
    <>
      <h1 className="crm-page-title">Analytics</h1>
      <div className="an-page">
      {data?.mixed_currencies && (
        <span className="oa-mixed-badge" title="Projects use different currencies — revenue is FX-converted to the org currency.">
          <Warning weight="fill" /> Mixed currencies → converted to {ccy}
        </span>
      )}

      {/* Overview KPIs */}
      <section className="an-section">
        <header className="an-section-head">
          <h2 className="an-section-title">Overview · all projects</h2>
          <div className="an-section-controls">
            <div className="an-section-period">
              <Combobox value={period} options={PERIOD_OPTIONS} onChange={setPeriod} />
            </div>
          </div>
        </header>
        <div className="an-section-body">
          {loading || !data ? (
            <div className="crm-placeholder">Loading…</div>
          ) : (
            <div className="an-kpi-grid">
              <Kpi label="Revenue"    value={money(cur.revenue)}                 delta={delta.revenue} />
              <Kpi label="Orders"     value={fmtInt(cur.orders)}                 delta={delta.orders} />
              <Kpi label="Avg order"  value={money(cur.aov)}                     delta={delta.aov} />
              <Kpi label="Conversion" value={`${(cur.conversion || 0).toFixed(1)}%`} delta={delta.conversion} />
              <Kpi label="Visitors"   value={fmtInt(cur.visitors)}               delta={delta.visitors} />
              <Kpi label="Customers"  value={fmtInt(cur.customers)}              delta={delta.customers} />
            </div>
          )}
        </div>
      </section>

      {/* Revenue over time — shared project-Analytics LineChart (pannable, Day/Week/Month) */}
      <section className="an-section">
        <header className="an-section-head">
          <h2 className="an-section-title">Revenue over time</h2>
          <div className="an-section-controls">
            <GranularitySegmented value={gran} onChange={setGran} />
          </div>
        </header>
        <div className="an-section-body">
          <div className="an-tile">
            {loading || !data ? <div className="crm-placeholder">Loading…</div>
              : buckets.length === 0
                ? <p className="an-empty">No revenue in this period yet.</p>
                : <LineChart data={buckets} viewportBuckets={VIEWPORT_BUCKETS[gran]} valueKey="revenue" />}
          </div>
        </div>
      </section>

      {/* Cross-project comparison */}
      <section className="an-section">
        <header className="an-section-head">
          <h2 className="an-section-title">Project comparison</h2>
        </header>
        <div className="an-section-body">
          {loading || !data ? (
            <div className="crm-placeholder">Loading…</div>
          ) : projects.length === 0 ? (
            <div className="crm-placeholder">No projects in this organization yet.</div>
          ) : (
            <>
              {/* Highlight cards */}
              <div className="oa-highlights">
                <div className="oa-highlight">
                  <span className="oa-highlight-icon oa-highlight-icon--earn"><TrendUp weight="regular" /></span>
                  <span className="oa-highlight-text">
                    <span className="oa-highlight-label">Top earner</span>
                    <span className="oa-highlight-name">{topEarner ? topEarner.name : '—'}</span>
                    <span className="oa-highlight-val">{topEarner ? moneyExact(topEarner.revenue) : '—'}</span>
                  </span>
                </div>
                <div className="oa-highlight">
                  <span className="oa-highlight-icon oa-highlight-icon--margin"><Percent weight="regular" /></span>
                  <span className="oa-highlight-text">
                    <span className="oa-highlight-label">Highest margin</span>
                    <span className="oa-highlight-name">{topMargin ? topMargin.name : '—'}</span>
                    <span className="oa-highlight-val">{topMargin ? `${topMargin.margin_pct}%` : '—'}</span>
                  </span>
                </div>
                <div className="oa-highlight">
                  <span className="oa-highlight-icon oa-highlight-icon--count"><Buildings weight="regular" /></span>
                  <span className="oa-highlight-text">
                    <span className="oa-highlight-label">Active projects</span>
                    <span className="oa-highlight-name">{projects.length} total</span>
                    <span className="oa-highlight-val">{projects.filter(p => p.revenue > 0).length} with sales</span>
                  </span>
                </div>
              </div>

              {/* Leaderboard */}
              <div className="oa-table">
                <div className="oa-row oa-row--head">
                  <span>Project</span>
                  <span className="oa-num">Revenue</span>
                  <span className="oa-num">Orders</span>
                  <span className="oa-num">Avg order</span>
                  <span className="oa-num">Margin</span>
                </div>
                {projects.map(p => (
                  <div className="oa-row" key={p.id}>
                    <span className="oa-name-text">{p.name}</span>
                    <span className="oa-num oa-strong">{moneyExact(p.revenue)}</span>
                    <span className="oa-num">{fmtInt(p.orders)}</span>
                    <span className="oa-num">{money(p.aov)}</span>
                    <span className="oa-num">{p.margin_pct == null ? '—' : `${p.margin_pct}%`}</span>
                  </div>
                ))}
              </div>

              {/* Revenue & margin bars — project Analytics `an-bars` look */}
              <div className="oa-cols">
                <div className="an-tile">
                  <h3 className="an-mini-title">Revenue by project</h3>
                  <BarList max={maxRev}
                    rows={projects.map(p => ({ label: p.name, value: p.revenue, text: moneyExact(p.revenue) }))} />
                </div>
                <div className="an-tile">
                  <h3 className="an-mini-title">Margin by project</h3>
                  <BarList max={100} tone="margin"
                    rows={projects.map(p => ({ label: p.name, value: p.margin_pct || 0,
                      text: p.margin_pct == null ? '—' : `${p.margin_pct}%` }))} />
                </div>
              </div>
            </>
          )}
        </div>
      </section>
      </div>
    </>
  );
}
