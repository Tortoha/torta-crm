// Admin Analytics — visual parity with CRM Pages/Project/Analytics.jsx
// (same .crm-page-title + .an-section + .an-section-head + .an-kpi-grid +
// .an-kpi classes so the copied Analytics.css applies untouched).
//
// Sections (each in its own .an-section card):
//   1) Overview KPIs — Users / Orgs / Projects / Orders 24h / MRR
//   2) Signups over time — SVG line chart with a per-section period selector
//   3) Subscription plans — bar list
//   4) Top countries — flag list
// Period selector mirrors CRM's pill segmented control (.an-gran-* classes).

import { useEffect, useState, useRef, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  ChartLine, UsersThree, Buildings, Package, Receipt, Globe, Wallet,
  Pulse, FunnelSimple,
} from '@phosphor-icons/react';
import { API_BASE } from '../api.js';
import '../Style/Analytics.css';
import '../Style/Logs.css';
import { LineChart } from '../Utils/LineChart.jsx';
import { useRealtimePoll } from '../Utils/useRealtimePoll.js';

const PERIODS = [
  { value: '7d',  label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All time' },
];

// Fallback labels only — the real name + price now come from the backend
// (crm_subscription_plans), so MRR never desyncs when pricing changes.
const PLAN_LABEL = { free: 'Free', standard: 'Standard', plus: 'Plus', pro: 'Pro', max: 'Max' };

// ── Section wrapper — mirrors CRM SectionShell shape ─────────────────
// Same .an-section / .an-section-head / .an-section-title classes the
// CRM Analytics.css styles. Period selector is a pill segmented control
// (same .an-gran-* classes CRM uses for Day/Week/Month).
function Section({ title, Icon, period, onPeriodChange, hidePeriod, live, children }) {
  return (
    <section className="an-section">
      <header className="an-section-head">
        <h2 className="an-section-title">
          {Icon && <Icon className="an-section-icon" weight="bold" />}
          {title}
        </h2>
        <div className="an-section-controls">
          {live && (
            <span className="an-live" title="Refreshes automatically every 15s">
              <span className="an-live-dot" />Live
            </span>
          )}
          {!hidePeriod && (
            <PeriodSegmented value={period} onChange={onPeriodChange} />
          )}
        </div>
      </header>
      <div className="an-section-body">{children}</div>
    </section>
  );
}

function PeriodSegmented({ value, onChange }) {
  const indRef  = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);
  const cur = hovered ?? value;
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el  = cur ? btnRefs.current[cur] : null;
      if (!ind) return;
      if (!el)  { ind.style.opacity = '0'; return; }
      ind.style.opacity   = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width     = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [cur, value]);
  return (
    <div className="an-gran-pill" onMouseLeave={() => setHovered(null)}>
      <div ref={indRef} className="an-gran-ind" />
      {PERIODS.map(p => (
        <button
          key={p.value}
          ref={el => { btnRefs.current[p.value] = el; }}
          className={`an-gran-btn${value === p.value ? ' an-gran-btn--active' : ''}`}
          onMouseEnter={() => setHovered(p.value)}
          onClick={() => onChange(p.value)}
          type="button"
        >{p.label}</button>
      ))}
    </div>
  );
}

// ── KPI card — exact copy of CRM Kpi() (line 980) ──────────────────────
function Kpi({ label, value, sub }) {
  return (
    <div className="an-kpi">
      <span className="an-kpi-label">{label}</span>
      <span className="an-kpi-value">{value}</span>
      {sub && <span className="an-kpi-sub">{sub}</span>}
    </div>
  );
}

// ── Signups chart — thin wrapper around the VERBATIM CRM "Revenue over time"
// LineChart (Utils/LineChart.jsx), so it's pixel-identical (draggable pan,
// gridlines, smoothed line, hover crosshair + tooltip). Backend returns a
// gap-filled daily series; we just feed it in with signups/day keys.
function SignupsChart({ data }) {
  if (!data?.length) {
    return <div className="an-chart-empty">No data for this period.</div>;
  }
  const vpb = Math.max(7, Math.min(data.length, 60));
  return (
    <LineChart
      data={data}
      valueKey="signups"
      dateKey="day"
      height={300}
      viewportBuckets={vpb}
      formatValue={(v) => `${Math.round(+v || 0)} signup${Math.round(+v || 0) === 1 ? '' : 's'}`}
    />
  );
}

// ── Active-users-over-time chart (same LineChart as signups) ───────────
function ActiveChart({ data }) {
  if (!data?.length) return <div className="an-chart-empty">No data for this period.</div>;
  const vpb = Math.max(7, Math.min(data.length, 60));
  return (
    <LineChart
      data={data}
      valueKey="actives"
      dateKey="day"
      height={300}
      viewportBuckets={vpb}
      formatValue={(v) => `${Math.round(+v || 0)} active`}
    />
  );
}

// ── Sales funnel — stage bars with stage-to-stage conversion % ─────────
function FunnelView({ stages }) {
  if (!stages?.length) return <div className="an-chart-empty">No data.</div>;
  // Scale bars to the LARGEST stage (normally "visited"), so the funnel still
  // renders sanely when the top stage has no data yet (visited = 0).
  const top = Math.max(1, ...stages.map(s => Number(s.value || 0)));
  return (
    <div className="an-funnel">
      {stages.map((s, i) => {
        const v = Number(s.value || 0);
        const widthPct = Math.max(3, Math.min(100, Math.round((v / top) * 100)));
        const prev = i > 0 ? Number(stages[i - 1].value || 0) : null;
        const conv = (prev && prev > 0) ? Math.round((v / prev) * 100) : null;
        return (
          <div key={s.key} className="an-funnel-row">
            <div className="an-funnel-head">
              <span className="an-funnel-label">{s.label}</span>
              <span className="an-funnel-value">
                {v.toLocaleString()}
                {conv != null && <span className="an-funnel-conv"> · {conv}%</span>}
              </span>
            </div>
            <div className="an-funnel-track">
              <div className="an-funnel-fill" style={{ width: `${widthPct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Bar list (subscription plans) ──────────────────────────────────────
function BarList({ rows }) {
  if (!rows?.length) return <div className="an-chart-empty">No data.</div>;
  const total = rows.reduce((s, x) => s + Number(x.value || 0), 0) || 1;
  return (
    <div className="an-bar-list">
      {rows.map(r => {
        const pct = Math.round((Number(r.value) / total) * 100);
        return (
          <div key={r.key} className="an-bar-row">
            <div className="an-bar-label">
              <span>{r.label}</span>
              <span className="an-bar-meta">{r.value} ({pct}%)</span>
            </div>
            <div className="an-bar-track">
              <div className="an-bar-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Country list with flag emoji ───────────────────────────────────────
function countryFlag(code) {
  if (!code || code.length !== 2 || !/^[A-Z]{2}$/.test(code)) return '🌍';
  const A = 0x1F1E6;
  return String.fromCodePoint(A + (code.charCodeAt(0) - 65)) +
         String.fromCodePoint(A + (code.charCodeAt(1) - 65));
}
function CountryList({ rows }) {
  if (!rows?.length) return <div className="an-chart-empty">No data.</div>;
  return (
    <div className="an-country-list">
      {rows.map(r => (
        <div key={r.country} className="an-country-row">
          <span className="an-country-flag">{r.country === 'XX' ? '🌍' : countryFlag(r.country)}</span>
          <span className="an-country-code">{r.country === 'XX' ? 'Unknown' : r.country}</span>
          <span className="an-country-count">{r.users}</span>
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  Page
// ════════════════════════════════════════════════════════════════════════
export default function Analytics() {
  const [period, setPeriod] = useState('30d');
  const [data, setData]     = useState(null);
  const [err, setErr]       = useState('');
  // Monotonic request token: only the most recent fetch applies its result, so
  // a slow background poll can't clobber a freshly-switched period.
  const reqRef = useRef(0);
  // silent=false → period switch: clear to show "Loading…".
  // silent=true  → background poll: swap data in place, keep last-good on error
  // so "Online now" / funnel / engagement stay live with no flicker.
  const load = (silent = false) => {
    const myReq = ++reqRef.current;
    if (!silent) { setData(null); setErr(''); }
    fetch(`${API_BASE}/api/admin/stats?period=${period}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => { if (reqRef.current === myReq) { setData(d); setErr(''); } })
      .catch(e => { if (reqRef.current === myReq && !silent) setErr(String(e)); });
  };
  useEffect(() => { load(false); }, [period]);
  useRealtimePoll(() => load(true));

  const totals     = data?.totals || {};
  const plans      = data?.plans  || [];
  const countries  = data?.countries || [];
  const series     = data?.signups_series || [];
  const engagement = data?.engagement || {};
  const funnel     = data?.funnel || [];
  const activeSrs  = data?.active_series || [];

  // MRR = Σ (orgs on a plan × that plan's monthly price). Price comes from the
  // backend (real crm_subscription_plans.price_usd), so it never goes stale.
  const mrr = useMemo(
    () => plans.reduce((s, p) => s + (Number(p.org_count) || 0) * (Number(p.price_usd) || 0), 0),
    [plans]
  );

  const planRows = plans.map(p => ({
    key: p.plan_code,
    label: p.plan_name || PLAN_LABEL[p.plan_code] || p.plan_code,
    value: Number(p.org_count) || 0,
  }));

  const usersTotal = Number(totals.users_total) || 0;
  const activeRate = usersTotal ? Math.round(((Number(engagement.wau) || 0) / usersTotal) * 100) : 0;
  const noVisits   = funnel.length > 0 && Number(funnel[0]?.value || 0) === 0;

  return (
    <>
      <h1 className="crm-page-title">Analytics</h1>

      {err && <div className="an-section"><div className="an-section-body">Failed to load: {err}</div></div>}

      {/* SECTION 1 — Overview KPIs */}
      <Section title="Overview" Icon={ChartLine} period={period} onPeriodChange={setPeriod}>
        {!data ? <div className="an-chart-empty">Loading…</div> : (
          <div className="an-kpi-grid">
            <Kpi label="Total users"      value={totals.users_total ?? 0}
                 sub={`${totals.users_banned ?? 0} banned · ${totals.admins ?? 0} admins`} />
            <Kpi label="Organizations"    value={totals.orgs_total ?? 0}
                 sub={`${totals.projects_total ?? 0} projects (${totals.projects_active ?? 0} active)`} />
            <Kpi label="Orders (24h)"     value={totals.orders_24h ?? 0}
                 sub={`${totals.orders_total ?? 0} all-time`} />
            <Kpi label="MRR estimate"     value={`$${mrr.toLocaleString()}`}
                 sub="Sum of (orgs × plan price)" />
          </div>
        )}
      </Section>

      {/* SECTION — Engagement (live + active + churn) */}
      <Section title="Engagement" Icon={Pulse} hidePeriod live>
        {!data ? <div className="an-chart-empty">Loading…</div> : (
          <div className="an-kpi-grid">
            <Kpi label="Online now" value={engagement.online_now ?? 0}
                 sub="live in the CRM right now" />
            <Kpi label="Active / week (WAU)" value={engagement.wau ?? 0}
                 sub={`${activeRate}% of users · ${engagement.dau ?? 0} today`} />
            <Kpi label="Active / month (MAU)" value={engagement.mau ?? 0}
                 sub={`${engagement.ever_active ?? 0} ever signed in`} />
            <Kpi label="Churned" value={engagement.churned ?? 0}
                 sub="signed in once, silent 30d+" />
          </div>
        )}
      </Section>

      {/* SECTION — Sales funnel */}
      <Section title="Sales funnel" Icon={FunnelSimple} hidePeriod>
        {!data ? <div className="an-chart-empty">Loading…</div> : (
          <>
            <FunnelView stages={funnel} />
            {noVisits && (
              <p className="an-funnel-hint">
                Visit tracking just shipped — the “Visited” step fills as traffic
                arrives (one count per visitor per day, anonymous).
              </p>
            )}
          </>
        )}
      </Section>

      {/* SECTION 2 — Signups over time chart */}
      <Section title="Signups over time" Icon={UsersThree} hidePeriod>
        {!data ? <div className="an-chart-empty">Loading…</div> : (
          <SignupsChart data={series} />
        )}
      </Section>

      {/* SECTION — Active users over time (distinct daily logins) */}
      <Section title="Active users over time" Icon={ChartLine} period={period} onPeriodChange={setPeriod}>
        {!data ? <div className="an-chart-empty">Loading…</div> : (
          <ActiveChart data={activeSrs} />
        )}
      </Section>

      {/* SECTIONS 3+4 side-by-side — Plans + Countries */}
      <div className="an-row-2col">
        <Section title="Subscription plans" Icon={Wallet} hidePeriod>
          {!data ? <div className="an-chart-empty">Loading…</div> : <BarList rows={planRows} />}
        </Section>

        <Section title="Top countries" Icon={Globe} hidePeriod>
          {!data ? <div className="an-chart-empty">Loading…</div> : <CountryList rows={countries} />}
        </Section>
      </div>
    </>
  );
}
