// Static, faithful mock of the CRM Analytics page (light theme only).
// KPI tiles + a smoothed revenue area chart + a sales funnel.
// Mirrors Pages/Project/Analytics.jsx; positive deltas are accent-blue (no green).

import { Eye, ShoppingCart, PlusCircle, CheckCircle } from '@phosphor-icons/react';

const KPIS = [
  { label: 'Revenue',    value: '$48,210', delta: '+12.4%', up: true },
  { label: 'Orders',     value: '1,284',   delta: '+8.1%',  up: true },
  { label: 'Avg order',  value: '$37.55',  delta: '+3.9%',  up: true },
  { label: 'Conversion', value: '6.5%',    delta: '+0.7%',  up: true },
  { label: 'Visitors',   value: '41,900',  delta: '+15.2%', up: true },
  { label: 'Customers',  value: '912',     delta: '−2.3%',  up: false },
];

const SERIES = [1240, 1890, 1560, 2210, 1980, 2670, 2450, 3120, 2890, 3540, 3310, 4180];

const FUNNEL = [
  { Icon: Eye,          label: 'Site visits',   count: '4,820', pct: 100.0, drop: null },
  { Icon: ShoppingCart, label: 'Product views', count: '3,140', pct: 65.1,  drop: '−35%' },
  { Icon: PlusCircle,   label: 'Added to cart',  count: '1,072', pct: 22.2,  drop: '−66%' },
  { Icon: CheckCircle,  label: 'Paid orders',    count: '312',   pct: 6.5,   drop: '−71%' },
];

const W = 1072, H = 240, PADT = 18, PADB = 30, PADL = 6, PADR = 6;

function chartPaths() {
  const max = Math.max(...SERIES), min = Math.min(...SERIES);
  const xs = (i) => PADL + (i / (SERIES.length - 1)) * (W - PADL - PADR);
  const ys = (v) => PADT + (1 - (v - min) / (max - min)) * (H - PADT - PADB);
  const pts = SERIES.map((v, i) => [xs(i), ys(v)]);
  let line = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    line += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  const area = `${line} L ${xs(SERIES.length - 1)} ${H - PADB} L ${xs(0)} ${H - PADB} Z`;
  const dot = pts[pts.length - 1];
  return { line, area, dot };
}

export default function MockAnalytics() {
  const { line, area, dot } = chartPaths();
  const gridY = [0, 1, 2, 3, 4].map((i) => PADT + (i / 4) * (H - PADT - PADB));

  return (
    <div className="mk-an">
      <div className="mk-an-secthead"><span className="mk-an-stitle">Overview</span><span className="mk-an-period">Last 30 days</span></div>
      <div className="mk-an-kpis">
        {KPIS.map((k) => (
          <div key={k.label} className="mk-an-kpi">
            <span className="mk-an-klabel">{k.label}</span>
            <span className="mk-an-kvalue">{k.value}</span>
            <span className={`mk-an-delta${k.up ? '' : ' mk-an-delta--down'}`}>{k.delta}</span>
          </div>
        ))}
      </div>

      <div className="mk-an-secthead"><span className="mk-an-stitle">Revenue over time</span><span className="mk-an-period">Weekly</span></div>
      <div className="mk-an-chart">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="240" preserveAspectRatio="none">
          <defs>
            <linearGradient id="mkAnFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0071E3" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#0071E3" stopOpacity="0" />
            </linearGradient>
          </defs>
          {gridY.map((y, i) => (
            <line key={i} x1={PADL} y1={y} x2={W - PADR} y2={y} stroke="var(--mk-grid)" strokeWidth="1" />
          ))}
          <path d={area} fill="url(#mkAnFill)" />
          <path d={line} fill="none" stroke="#0071E3" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={dot[0]} cy={dot[1]} r="5.5" fill="#0071E3" stroke="var(--mk-card)" strokeWidth="2.5" />
        </svg>
      </div>

      <div className="mk-an-secthead"><span className="mk-an-stitle">Sales funnel</span></div>
      <div className="mk-an-funnel">
        {FUNNEL.map((f) => (
          <div key={f.label} className="mk-an-frow">
            <span className="mk-an-flabel"><f.Icon weight="bold" /> {f.label}</span>
            <span className="mk-an-fcount">{f.count}</span>
            <span className="mk-an-ftrack"><span className="mk-an-ffill" style={{ width: `${f.pct}%` }} /></span>
            <span className="mk-an-fpct">{f.pct.toFixed(1)}%{f.drop && <em className="mk-an-fdrop">{f.drop}</em>}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
