import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { CaretUp, CaretDown } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';

const PERIODS = [
  { key: '7d',   label: 'Last 7 days'  },
  { key: '30d',  label: 'Last 30 days' },
  { key: '90d',  label: 'Last 90 days' },
  { key: 'year', label: 'Last year'    },
];

// Project Analytics page. KPI cards + revenue chart + funnel + top products + inventory health.
// Replaces the old Revenue placeholder. All data is fetched in parallel from /api/analytics/* endpoints.
export default function Revenue() {
  const { projectId } = useOutletContext();
  const [period, setPeriod] = useState('30d');
  const [overview,  setOverview]  = useState(null);
  const [funnel,    setFunnel]    = useState(null);
  const [topByRev,  setTopByRev]  = useState([]);
  const [topByMrg,  setTopByMrg]  = useState([]);
  const [invHealth, setInvHealth] = useState(null);
  const [loading,   setLoading]   = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const pq = `?project_id=${projectId}&period=${period}`;
    try {
      const [ov, fn, tr, tm, ih] = await Promise.all([
        fetch(`${API_BASE}/api/analytics/overview${pq}`,       { credentials: 'include' }).then(r => r.ok ? r.json() : null),
        fetch(`${API_BASE}/api/analytics/funnel${pq}`,         { credentials: 'include' }).then(r => r.ok ? r.json() : null),
        fetch(`${API_BASE}/api/analytics/top-products${pq}&by=revenue&limit=10`, { credentials: 'include' }).then(r => r.ok ? r.json() : []),
        fetch(`${API_BASE}/api/analytics/top-products${pq}&by=margin&limit=10`,  { credentials: 'include' }).then(r => r.ok ? r.json() : []),
        fetch(`${API_BASE}/api/analytics/inventory-health?project_id=${projectId}`, { credentials: 'include' }).then(r => r.ok ? r.json() : null),
      ]);
      setOverview(ov); setFunnel(fn);
      setTopByRev(Array.isArray(tr) ? tr : []);
      setTopByMrg(Array.isArray(tm) ? tm : []);
      setInvHealth(ih);
    } finally { setLoading(false); }
  }, [projectId, period]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <h1 className="crm-page-title">Analytics</h1>

      <div className="crm-section" style={{ marginBottom: 16 }}>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {loading && <div className="crm-placeholder">Loading…</div>}

      {!loading && overview && (
        <>
          {/* KPI cards row */}
          <div className="kpi-grid">
            <KpiCard label="Revenue"   value={`$${overview.current.revenue.toFixed(2)}`}   delta={overview.delta.revenue} />
            <KpiCard label="Orders"    value={overview.current.orders}                     delta={overview.delta.orders} />
            <KpiCard label="AOV"       value={`$${overview.current.aov.toFixed(2)}`}       delta={overview.delta.aov} />
            <KpiCard label="Visitors"  value={overview.current.visitors}                   delta={overview.delta.visitors} />
            <KpiCard label="Conversion" value={`${overview.current.conversion.toFixed(2)}%`} delta={overview.delta.conversion} />
          </div>

          {/* Revenue chart */}
          <div className="crm-section" style={{ marginBottom: 16 }}>
            <h3 className="crm-section-title" style={{ marginBottom: 12 }}>Revenue over time</h3>
            <RevenueChart series={overview.series || []} />
          </div>
        </>
      )}

      {!loading && funnel && (
        <div className="crm-section" style={{ marginBottom: 16 }}>
          <h3 className="crm-section-title" style={{ marginBottom: 12 }}>Conversion funnel</h3>
          <Funnel data={funnel} />
        </div>
      )}

      {!loading && (
        <div className="kpi-grid kpi-grid--2col">
          <div className="crm-section">
            <h3 className="crm-section-title" style={{ marginBottom: 12 }}>Top by revenue</h3>
            <TopList rows={topByRev} unit="revenue" />
          </div>
          <div className="crm-section">
            <h3 className="crm-section-title" style={{ marginBottom: 12 }}>Top by margin</h3>
            <TopList rows={topByMrg} unit="margin" />
          </div>
        </div>
      )}

      {!loading && invHealth && (
        <div className="crm-section" style={{ marginTop: 16 }}>
          <h3 className="crm-section-title" style={{ marginBottom: 12 }}>Inventory health</h3>
          <InventoryHealth data={invHealth} />
        </div>
      )}
    </>
  );
}

// ── PeriodPicker (pill row, mirrors Authentication tab switcher) ─

function PeriodPicker({ value, onChange }) {
  const indRef = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);
  const curKey = hovered ?? value;

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el  = btnRefs.current[curKey];
      if (!ind || !el) return;
      ind.style.opacity   = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width     = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [curKey, value]);

  return (
    <div className="org-sort-toggle" onMouseLeave={() => setHovered(null)}>
      <div ref={indRef} className="org-sort-indicator" />
      {PERIODS.map(({ key, label }) => (
        <button key={key} ref={el => { btnRefs.current[key] = el; }}
          className={`org-sort-btn${curKey === key ? ' org-sort-btn--current' : ''}`}
          onMouseEnter={() => setHovered(key)}
          onClick={() => onChange(key)} type="button">
          {label}
        </button>
      ))}
    </div>
  );
}

function KpiCard({ label, value, delta }) {
  const sign = delta == null ? '' : delta > 0 ? '+' : '';
  const cls  = delta == null ? '' : delta >= 0 ? 'kpi-delta--up' : 'kpi-delta--down';
  return (
    <div className="kpi-card">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {delta != null && (
        <span className={`kpi-delta ${cls}`}>
          {delta >= 0 ? <CaretUp weight="bold" /> : <CaretDown weight="bold" />}
          {sign}{Math.abs(delta).toFixed(1)}%
        </span>
      )}
    </div>
  );
}

function RevenueChart({ series }) {
  // Lightweight inline SVG line chart — no chart-lib dependency for the diploma demo. Y-axis auto-scales to max.
  const W = 800, H = 220, P = { top: 16, right: 16, bottom: 24, left: 40 };
  if (!series.length) return <p className="crm-placeholder">No orders yet for this period.</p>;
  const max = Math.max(1, ...series.map(s => s.revenue));
  const xW = W - P.left - P.right;
  const yH = H - P.top - P.bottom;
  const xs = (i) => P.left + (series.length === 1 ? xW / 2 : (i / (series.length - 1)) * xW);
  const ys = (v) => P.top + yH - (v / max) * yH;

  const points = series.map((s, i) => `${xs(i)},${ys(s.revenue)}`).join(' ');
  const area = `M ${xs(0)},${P.top + yH} L ${points.split(' ').join(' L ')} L ${xs(series.length - 1)},${P.top + yH} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 220 }}>
      <defs>
        <linearGradient id="rev-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#0071E3" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#0071E3" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#rev-area)" />
      <polyline points={points} fill="none" stroke="#0071E3" strokeWidth="2" />
      {series.map((s, i) => (
        <circle key={i} cx={xs(i)} cy={ys(s.revenue)} r="3" fill="#0071E3" />
      ))}
      {/* Y axis labels (max / 0). */}
      <text x={P.left - 6} y={P.top + 4} fontSize="11" fill="#888" textAnchor="end">${max.toFixed(0)}</text>
      <text x={P.left - 6} y={P.top + yH} fontSize="11" fill="#888" textAnchor="end">$0</text>
    </svg>
  );
}

function Funnel({ data }) {
  // Funnel visualised as horizontal bar list with drop-off %.
  const stages = [
    { key: 'visitors',      label: 'Visitors',      v: data.visitors },
    { key: 'product_views', label: 'Product views', v: data.product_views },
    { key: 'atc',           label: 'Added to cart', v: data.atc },
    { key: 'paid',          label: 'Paid',          v: data.paid },
  ];
  const max = Math.max(1, ...stages.map(s => s.v));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].v : null;
        const drop = prev && prev > 0 ? ((prev - s.v) / prev * 100) : null;
        const w = (s.v / max) * 100;
        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 140, fontSize: 13 }}>{s.label}</span>
            <div style={{ flex: 1, background: 'rgba(0,113,227,0.08)', borderRadius: 999, height: 22, position: 'relative' }}>
              <div style={{ width: `${w}%`, background: 'var(--accent)', height: '100%', borderRadius: 999, transition: 'width 0.3s ease' }} />
              <span style={{ position: 'absolute', top: 2, right: 8, fontSize: 12, color: '#fff', fontWeight: 600 }}>{s.v.toLocaleString()}</span>
            </div>
            {drop != null && (
              <span style={{ width: 80, fontSize: 12, color: drop > 0 ? '#d93025' : 'var(--accent)', textAlign: 'right' }}>
                −{drop.toFixed(1)}%
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TopList({ rows, unit }) {
  if (!rows.length) return <p className="crm-placeholder">No data yet.</p>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((p, i) => (
        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 8px', borderRadius: 12, background: 'var(--bg)' }}>
          <span style={{ width: 18, color: 'var(--muted)', fontSize: 12 }}>{i + 1}.</span>
          <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>${p[unit].toFixed(2)}</span>
          <span style={{ fontSize: 11, color: 'var(--muted)', width: 60, textAlign: 'right' }}>{p.units} sold</span>
        </div>
      ))}
    </div>
  );
}

function InventoryHealth({ data }) {
  const total = Math.max(1, data.total);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
      <div style={{ display: 'flex', height: 32, borderRadius: 999, overflow: 'hidden', flex: 1 }}>
        <div title={`Out of stock: ${data.oos}`}     style={{ background: '#d93025', width: `${data.oos     / total * 100}%` }} />
        <div title={`Low stock: ${data.low}`}        style={{ background: '#f4a300', width: `${data.low     / total * 100}%` }} />
        <div title={`Healthy: ${data.healthy}`}      style={{ background: 'var(--accent)', width: `${data.healthy / total * 100}%` }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 180 }}>
        <span style={{ fontSize: 12 }}><span style={{ display: 'inline-block', width: 10, height: 10, background: '#d93025', borderRadius: 4, marginRight: 6 }} />Out of stock: <b>{data.oos}</b></span>
        <span style={{ fontSize: 12 }}><span style={{ display: 'inline-block', width: 10, height: 10, background: '#f4a300', borderRadius: 4, marginRight: 6 }} />Low stock: <b>{data.low}</b></span>
        <span style={{ fontSize: 12 }}><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--accent)', borderRadius: 4, marginRight: 6 }} />Healthy: <b>{data.healthy}</b></span>
      </div>
    </div>
  );
}
