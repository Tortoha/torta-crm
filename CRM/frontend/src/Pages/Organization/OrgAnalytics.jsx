// Organization Analytics — rolls every project in the org into one view.
// Each section owns its OWN period control (same UX as the project Analytics
// page), reusing that page's SectionShell. Revenue over time reuses the
// project's scrollable LineChart with the SAME chunked + lazy-load pattern,
// backed by GET /api/orgs/{id}/revenue-over-time — so panning into the past
// fetches older history instead of dead-ending at the visible window.
// Each project keeps its own currency; the backend FX-converts revenue into
// the org's display currency so totals + comparison are apples-to-apples.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TrendUp, Percent, Warning, Buildings } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { formatMoney } from '../../Utils/currency.js';
import { useOrgPlan } from '../../Utils/useOrgPlan.js';
import UpgradePlaque from '../../Elements/UpgradePlaque.jsx';
// Reuse the project-Analytics primitives so the org page matches it 1:1:
// per-section period shell, the pannable chart, the Day/Week/Month toggle,
// and the chart-zoom math. setAnalyticsCurrency points the chart's Y-axis +
// tooltip at the org's display currency.
import {
  LineChart, GranularitySegmented, SectionShell, setAnalyticsCurrency,
  periodToViewportBuckets, CHUNK_DAYS, GRAN_DAYS,
  isCustomPeriod, parseCustomPeriod,
} from '../Project/Analytics.jsx';
import '../../Style/Organization.css';
import '../../Style/Products.css';      // Combobox dropdown styles
import '../../Style/Analytics.css';

// Zoom scale for Ctrl/Cmd+wheel on the chart — same code order as the
// SectionShell period dropdown (custom range is a launcher, not a step).
const ZOOM_ORDER = ['1d', '3d', '1w', '2w', '1mo', '2mo', 'season', 'halfyear', '1y', '2y'];

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

// Period-scoped fetch of the org analytics rollup. Each section calls this
// with its own `period`, so the three sections refresh independently.
function useOrgAnalytics(orgId, period) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    setLoading(true);
    fetch(`${API_BASE}/api/orgs/${orgId}/analytics?period=${encodeURIComponent(period)}`,
          { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive) { setData(d); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [orgId, period]);
  return { data, loading };
}

// ── Section 1: Overview KPIs ──────────────────────────────────────────
function OverviewSection({ orgId }) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState('1mo');
  const { data, loading } = useOrgAnalytics(orgId, period);
  const ccy = data?.currency || 'USD';
  const money = useMemo(() => (v) => formatMoney(v, ccy, { decimals: 0 }), [ccy]);
  const cur   = data?.totals?.current || {};
  const delta = data?.totals?.delta || {};
  return (
    <SectionShell title={t('org.analytics.overview.title')} periodValue={period} onPeriodChange={setPeriod}>
      {data?.mixed_currencies && (
        <span className="oa-mixed-badge" style={{ marginBottom: 12 }}
          title={t('org.analytics.overview.mixedCurrenciesTitle')}>
          <Warning weight="fill" /> {t('org.analytics.overview.mixedCurrencies', { ccy })}
        </span>
      )}
      {loading || !data ? (
        <div className="crm-placeholder">{t('org.analytics.loading')}</div>
      ) : (
        <div className="an-kpi-grid">
          <Kpi label={t('org.analytics.overview.revenue')}    value={money(cur.revenue)}                     delta={delta.revenue} />
          <Kpi label={t('org.analytics.overview.orders')}     value={fmtInt(cur.orders)}                     delta={delta.orders} />
          <Kpi label={t('org.analytics.overview.avgOrder')}   value={money(cur.aov)}                         delta={delta.aov} />
          <Kpi label={t('org.analytics.overview.conversion')} value={`${(cur.conversion || 0).toFixed(1)}%`} delta={delta.conversion} />
          <Kpi label={t('org.analytics.overview.visitors')}   value={fmtInt(cur.visitors)}                   delta={delta.visitors} />
          <Kpi label={t('org.analytics.overview.customers')}  value={fmtInt(cur.customers)}                  delta={delta.customers} />
        </div>
      )}
    </SectionShell>
  );
}

// ── Section 2: Revenue over time ──────────────────────────────────────
// Mirrors the project RevenueOverTimeSection: `period` is a pure visual zoom
// (drives viewportBuckets), `gran` buckets Day/Week/Month, and data is fetched
// in chunks — the initial fetch brings the most-recent window, `handleLoadMore`
// prepends older chunks as the user pans left, and an auto-fill effect widens
// the data to cover a wide zoom. This is what makes the chart scrollable.
function RevenueSection({ orgId }) {
  const { t } = useTranslation();
  const [period, setPeriod]           = useState('1mo');
  const [gran, setGran]               = useState('day');
  const [data, setData]               = useState([]);
  const [oldestOrder, setOldestOrder] = useState(null);
  const [ccy, setCcy]                 = useState('USD');
  const [loading, setLoading]         = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Custom range = a closed window: fetch the fixed dates, disable lazy-load.
  const customRange = isCustomPeriod(period) ? parseCustomPeriod(period) : null;

  // Initial / reset fetch — re-fires on (orgId, gran, period) change.
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setLoading(true);
    setData([]);
    setOldestOrder(null);
    let url = `${API_BASE}/api/orgs/${orgId}/revenue-over-time?granularity=${gran}`;
    if (customRange) {
      url += `&from=${encodeURIComponent(`${customRange.from}T00:00:00Z`)}`
           + `&to=${encodeURIComponent(`${customRange.to}T23:59:59Z`)}`;
    }
    fetch(url, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (cancelled || !j) return;
        setData(j.buckets || []);
        setOldestOrder(j.oldest_order || null);
        if (j.currency) setCcy(j.currency);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orgId, gran, period]); // eslint-disable-line react-hooks/exhaustive-deps

  // Custom range: viewport fits the entire fetched window (no scrolling).
  const viewportBuckets = customRange
    ? Math.max(1, data.length || 30)
    : periodToViewportBuckets(period, gran);

  const handleLoadMore = useCallback(() => {
    if (customRange) return;
    if (loadingMore || loading || data.length === 0) return;
    const earliestISO = data[0].bucket;
    const earliestDate = new Date(earliestISO);
    if (oldestOrder && earliestDate <= new Date(oldestOrder)) return;
    setLoadingMore(true);
    const granDays   = GRAN_DAYS[gran] || 1;
    const baseChunk  = CHUNK_DAYS[gran] || 60;
    const targetBkts = viewportBuckets + 30;       // viewport + headroom buffer
    const gap        = Math.max(0, targetBkts - data.length);
    const chunkDays  = Math.max(baseChunk, gap * granDays);
    const fromDate   = new Date(earliestDate.getTime() - chunkDays * 86400 * 1000);
    fetch(`${API_BASE}/api/orgs/${orgId}/revenue-over-time?granularity=${gran}`
      + `&from=${encodeURIComponent(fromDate.toISOString())}`
      + `&to=${encodeURIComponent(earliestISO)}`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!j) return;
        const newer = j.buckets || [];
        if (newer.length === 0) { if (j.oldest_order) setOldestOrder(j.oldest_order); return; }
        setData(prev => {
          const lastNewISO = newer[newer.length - 1].bucket;
          const tail = prev.filter(b => b.bucket > lastNewISO);
          return [...newer, ...tail];
        });
        if (j.oldest_order) setOldestOrder(j.oldest_order);
      })
      .finally(() => setLoadingMore(false));
  }, [orgId, gran, data, oldestOrder, loadingMore, loading, viewportBuckets, customRange]);

  // Auto-fill viewport when a wider zoom needs more buckets than are loaded
  // (drag can't trigger lazy-load when data ≤ viewport — nothing to scroll).
  useEffect(() => {
    if (loading || loadingMore || data.length === 0) return;
    if (data.length >= viewportBuckets + 30) return;
    if (oldestOrder && new Date(data[0].bucket) <= new Date(oldestOrder)) return;
    handleLoadMore();
  }, [loading, loadingMore, data.length, viewportBuckets, oldestOrder, handleLoadMore]);

  const stepPeriod = (delta) => {
    const i = ZOOM_ORDER.indexOf(period);
    if (i === -1) return;            // custom range — wheel-zoom is a no-op
    const next = Math.max(0, Math.min(ZOOM_ORDER.length - 1, i + delta));
    if (next !== i) setPeriod(ZOOM_ORDER[next]);
  };

  // Point the shared LineChart's Y-axis + tooltip formatter at the org currency.
  setAnalyticsCurrency(ccy);

  return (
    <SectionShell title={t('org.analytics.revenue.title')} periodValue={period} onPeriodChange={setPeriod}
      headerControls={<GranularitySegmented value={gran} onChange={setGran} />}>
      <div className="an-tile">
        {loading ? <div className="crm-placeholder">{t('org.analytics.loading')}</div>
          : data.length === 0
            ? <p className="an-empty">{t('org.analytics.revenue.empty')}</p>
            : <LineChart data={data} viewportBuckets={viewportBuckets} valueKey="revenue"
                onZoom={stepPeriod} onLoadMore={handleLoadMore} loadingMore={loadingMore} />}
      </div>
    </SectionShell>
  );
}

// ── Section 3: Project comparison ─────────────────────────────────────
function ComparisonSection({ orgId }) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState('1mo');
  const { data, loading } = useOrgAnalytics(orgId, period);
  const ccy = data?.currency || 'USD';
  const money      = useMemo(() => (v) => formatMoney(v, ccy, { decimals: 0 }), [ccy]);
  const moneyExact = useMemo(() => (v) => formatMoney(v, ccy), [ccy]);
  const projects = data?.projects || [];
  const maxRev = Math.max(...projects.map(p => p.revenue), 1);
  const topEarner = projects.find(p => p.revenue > 0) || null;
  const withMargin = projects.filter(p => p.margin_pct != null);
  const topMargin = withMargin.length
    ? withMargin.reduce((a, b) => (b.margin_pct > a.margin_pct ? b : a))
    : null;

  return (
    <SectionShell title={t('org.analytics.comparison.title')} periodValue={period} onPeriodChange={setPeriod}>
      {loading || !data ? (
        <div className="crm-placeholder">{t('org.analytics.loading')}</div>
      ) : projects.length === 0 ? (
        <div className="crm-placeholder">{t('org.analytics.comparison.noProjects')}</div>
      ) : (
        <>
          {/* Highlight cards */}
          <div className="oa-highlights">
            <div className="oa-highlight">
              <span className="oa-highlight-icon oa-highlight-icon--earn"><TrendUp weight="regular" /></span>
              <span className="oa-highlight-text">
                <span className="oa-highlight-label">{t('org.analytics.comparison.topEarner')}</span>
                <span className="oa-highlight-name">{topEarner ? topEarner.name : '—'}</span>
                <span className="oa-highlight-val">{topEarner ? moneyExact(topEarner.revenue) : '—'}</span>
              </span>
            </div>
            <div className="oa-highlight">
              <span className="oa-highlight-icon oa-highlight-icon--margin"><Percent weight="regular" /></span>
              <span className="oa-highlight-text">
                <span className="oa-highlight-label">{t('org.analytics.comparison.highestMargin')}</span>
                <span className="oa-highlight-name">{topMargin ? topMargin.name : '—'}</span>
                <span className="oa-highlight-val">{topMargin ? `${topMargin.margin_pct}%` : '—'}</span>
              </span>
            </div>
            <div className="oa-highlight">
              <span className="oa-highlight-icon oa-highlight-icon--count"><Buildings weight="regular" /></span>
              <span className="oa-highlight-text">
                <span className="oa-highlight-label">{t('org.analytics.comparison.activeProjects')}</span>
                <span className="oa-highlight-name">{t('org.analytics.comparison.total', { count: projects.length })}</span>
                <span className="oa-highlight-val">{t('org.analytics.comparison.withSales', { count: projects.filter(p => p.revenue > 0).length })}</span>
              </span>
            </div>
          </div>

          {/* Leaderboard */}
          <div className="oa-table">
            <div className="oa-row oa-row--head">
              <span>{t('org.analytics.comparison.table.project')}</span>
              <span className="oa-num">{t('org.analytics.comparison.table.revenue')}</span>
              <span className="oa-num">{t('org.analytics.comparison.table.orders')}</span>
              <span className="oa-num">{t('org.analytics.comparison.table.avgOrder')}</span>
              <span className="oa-num">{t('org.analytics.comparison.table.margin')}</span>
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
              <h3 className="an-mini-title">{t('org.analytics.comparison.revenueByProject')}</h3>
              <BarList max={maxRev}
                rows={projects.map(p => ({ label: p.name, value: p.revenue, text: moneyExact(p.revenue) }))} />
            </div>
            <div className="an-tile">
              <h3 className="an-mini-title">{t('org.analytics.comparison.marginByProject')}</h3>
              <BarList max={100} tone="margin"
                rows={projects.map(p => ({ label: p.name, value: p.margin_pct || 0,
                  text: p.margin_pct == null ? '—' : `${p.margin_pct}%` }))} />
            </div>
          </div>
        </>
      )}
    </SectionShell>
  );
}

export default function OrgAnalytics() {
  const { t } = useTranslation();
  const { org } = useOutletContext();
  const orgId = org?.id;
  // Cross-organization analytics is a paid feature — Free orgs see the plaque.
  const { isFree, loading: planLoading } = useOrgPlan(orgId);
  return (
    <>
      <h1 className="crm-page-title">{t('org.analytics.title')}</h1>
      {orgId && !planLoading && isFree ? (
        <UpgradePlaque
          featureName={t('upgrade.crossOrg', { defaultValue: 'cross-organization analytics' })}
          to={org?.slug ? `/org/${org.slug}/billing` : '/pricing'} />
      ) : (
        <div className="an-page">
          <OverviewSection orgId={orgId} />
          <RevenueSection orgId={orgId} />
          <ComparisonSection orgId={orgId} />
        </div>
      )}
    </>
  );
}
