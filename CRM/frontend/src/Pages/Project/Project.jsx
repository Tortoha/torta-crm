import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Copy, Check, CaretDown,
  Envelope, Package, CurrencyDollar, ArrowRight,
  CheckCircle, WarningCircle, Circle, CalendarCheck, Package as PackageIcon, ShoppingBag, Pulse,
  ChatCircle, Warning, Info, ArrowUUpLeft, Warehouse,
} from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { InteractiveSection } from '../../Utils/InteractiveSection.js';
import { PoListRow } from '../../Utils/PoListRow.jsx';
import { formatMoney } from '../../Utils/currency.js';
import '../../Style/Project.css';

// ── Status badges ──────────────────────────────────────────────
// Covers both store-order statuses AND booking statuses so the merged
// Recent feed renders a correct badge for either kind.
const STATUS_META = {
  new:       { key: 'new',       cls: 'pov-order-badge--new'       },
  confirmed: { key: 'confirmed', cls: 'pov-order-badge--confirmed'  },
  shipped:   { key: 'shipped',   cls: 'pov-order-badge--shipped'    },
  delivered: { key: 'delivered', cls: 'pov-order-badge--delivered'  },
  cancelled: { key: 'cancelled', cls: 'pov-order-badge--cancelled'  },
  refunded:  { key: 'refunded',  cls: 'pov-order-badge--refunded'   },
  // Booking statuses
  pending:   { key: 'pending',   cls: 'pov-order-badge--new'       },
  completed: { key: 'completed', cls: 'pov-order-badge--delivered'  },
  no_show:   { key: 'noShow',    cls: 'pov-order-badge--cancelled'  },
};

function StatusBadge({ status }) {
  const { t } = useTranslation();
  const m = STATUS_META[status];
  const label = m ? t(`project.overview.status.${m.key}`) : status;
  return <span className={`pov-order-badge ${m?.cls ?? ''}`}>{label}</span>;
}

// ── Health status dots (Supabase-style) ────────────────────────
const HEALTH_ICON = {
  ok:   { Comp: CheckCircle,  cls: 'pov-health-dot--ok'   },
  warn: { Comp: WarningCircle, cls: 'pov-health-dot--warn' },
  info: { Comp: Circle,       cls: 'pov-health-dot--info' },
};

// ── Copy Keys button — Header-style dropdown ──────────────────

const COPY_ITEMS = [
  { key: 'pub', labelKey: 'publicKey',      hintKey: 'publicKeyHint'  },
  { key: 'pk',  labelKey: 'publishableKey', hintKey: 'publishableKeyHint'  },
];

const BTN_TILT = {
  maxAngle: 24, lerp: 0.07, lerpOut: 0.07,
  scale: 1.062, perspective: 900,
  gloss: { opacity: 0.14, spread: 60 },
};

function CopyKeys({ apiKey, publishableKey, secretKey }) {
  const { t } = useTranslation();
  // Secret key only shows for owners (backend sends it to owners only).
  const items = secretKey
    ? [...COPY_ITEMS, { key: 'sk', labelKey: 'secretKey', hintKey: 'secretKeyHint' }]
    : COPY_ITEMS;
  const [open,    setOpen]    = useState(false);
  const [copied,  setCopied]  = useState(null);
  const [toast,   setToast]   = useState('');
  const [hovered, setHovered] = useState(null);

  const wrapRef  = useRef(null);
  const indRef   = useRef(null);
  const itemRefs = useRef({});
  const timerRef = useRef(null);

  const { ref: btnRef, glossRef: btnGlossRef, handlers: btnHandlers } = InteractiveSection(BTN_TILT, open);

  // ── Dynamic Block indicator ───────────────────────────────
  useLayoutEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el  = hovered ? itemRefs.current[hovered] : null;
      if (!ind) return;
      if (!el) { ind.style.opacity = '0'; return; }
      ind.style.opacity   = '1';
      ind.style.transform = `translateY(${el.offsetTop}px)`;
      ind.style.height    = `${el.offsetHeight}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [hovered]);

  // ── Close on outside click ────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Copy action ───────────────────────────────────────────
  const copy = (key, label, value) => {
    navigator.clipboard.writeText(value || '');
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
    setToast(t('project.overview.keyCopied', { label }));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(''), 3200);
    setOpen(false);
  };

  const values = { pub: apiKey ?? '', pk: publishableKey ?? '', sk: secretKey ?? '' };
  const masked = {
    pub: apiKey ?? '—',
    pk:  '•'.repeat(12) + (publishableKey ?? '').slice(-6),
    sk:  '•'.repeat(12) + (secretKey ?? '').slice(-6),
  };

  return (
    <div className="pov-copykeys" ref={wrapRef}>
      <button
        ref={btnRef}
        className="pov-copykeys-btn"
        onClick={() => setOpen(v => !v)}
        {...btnHandlers}
      >
        <div ref={btnGlossRef} className="pov-copykeys-btn-gloss" />
        <span className="pov-copykeys-btn-content">
          <Copy className="pov-copykeys-btn-icon" />
          {t('project.overview.copyKeys')}
          <CaretDown className={`pov-copykeys-caret${open ? ' pov-copykeys-caret--open' : ''}`} />
        </span>
      </button>

      {/* Always rendered — toggled via CSS class like Header switcher */}
      <div
        className={`pov-copykeys-drop${open ? ' pov-copykeys-drop--open' : ''}`}
        onMouseLeave={() => setHovered(null)}
      >
        <div className="pov-ck-items">
          {/* Dynamic Block indicator */}
          <div className="pov-ck-ind" ref={indRef} />

          {items.map(({ key, labelKey, hintKey }) => {
            const label = t(`project.overview.${labelKey}`);
            return (
            <button
              key={key}
              ref={el => { if (el) itemRefs.current[key] = el; else delete itemRefs.current[key]; }}
              className={`pov-ck-item${hovered === key ? ' pov-ck-item--hov' : ''}`}
              onClick={() => copy(key, label, values[key])}
              onMouseEnter={() => setHovered(key)}
              type="button"
            >
              <span className="pov-ck-icon">
                {copied === key ? <Check weight="bold" /> : <Copy />}
              </span>
              <span className="pov-ck-info">
                <span className="pov-ck-label">
                  {label}
                  <span className="pov-ck-hint">{t(`project.overview.${hintKey}`)}</span>
                </span>
                <span className="pov-ck-value">{masked[key]}</span>
              </span>
            </button>
            );
          })}
        </div>
      </div>

      {toast && createPortal(
        <div className="pov-toast">{toast}</div>,
        document.body,
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────

const fmtMoney = (v, currency) => v == null ? '—'
  : formatMoney(v, currency || 'USD', { decimals: 0 });

const fmtDate = (ts) => ts
  ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  : '';

// ── Status card (Supabase-style health panel) ──────────────────
function StatusCard({ status }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Where each subsystem links to when clicked.
  const ROUTES = {
    url_config: 'authentication',
    auth:       'authentication',
    alerts:     'alerts',
    inventory:  'products/inventory',
    analytics:  'revenue',
  };
  const overall  = status?.overall;
  const warnings = status?.warnings ?? 0;

  // Health rows carry stable keys from the backend; localise here.
  const detailFor = (c) => {
    if (c.key === 'auth' && (c.methods?.length || c.oauthCount)) {
      const names = (c.methods || []).map(m => t(`project.overview.health.method.${m}`));
      if (c.oauthCount > 0) names.push(t('project.overview.health.oauthCount', { count: c.oauthCount }));
      return names.join(' · ');
    }
    if (c.key === 'inventory' && (c.oos || c.low)) {
      const parts = [];
      if (c.oos > 0) parts.push(t('project.overview.health.outOfStock', { count: c.oos }));
      if (c.low > 0) parts.push(t('project.overview.health.lowStock', { count: c.low }));
      return parts.join(' · ');
    }
    return c.detailKey ? t(`project.overview.health.${c.detailKey}`, c.detailParams || {}) : '';
  };

  return (
    <div className="pov-health">
      {/* Header pill — squared accent icon matches the widget tiles below;
          status pill on the right (mirrors Recent Activity header). */}
      <div className="pov-health-header">
        <div className="pov-health-icon"><Pulse weight="regular" /></div>
        <span className="pov-health-title">{t('project.overview.projectHealth')}</span>
        <span className={`pov-health-pill ${
          status == null ? 'pov-health-pill--loading'
          : overall === 'warning' ? 'pov-health-pill--warn'
          : 'pov-health-pill--ok'}`}>
          {status == null ? '…'
            : overall === 'warning'
              ? t('project.overview.warnings', { count: warnings })
              : t('project.overview.healthy')}
        </span>
      </div>

      {status == null ? (
        <div className="pov-health-loading">{t('project.overview.checkingSubsystems')}</div>
      ) : (
        <div className="po-set-table pov-health-table">
          {status.checks.map(c => {
            const meta = HEALTH_ICON[c.status] ?? HEALTH_ICON.info;
            const Icon = meta.Comp;
            return (
              <PoListRow key={c.key} className="pov-health-row"
                onClick={() => ROUTES[c.key] && navigate(ROUTES[c.key])}>
                <Icon className={`pov-health-dot ${meta.cls}`} weight="fill" />
                <span className="pov-health-label">{t(`project.overview.health.label.${c.labelKey}`)}</span>
                <span className={`pov-health-detail ${c.status === 'warn' ? 'pov-health-detail--warn' : ''}`}>
                  {detailFor(c)}
                </span>
              </PoListRow>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Widget tile (InteractiveSection tilt + gloss) ──────────────
// Copied verbatim from the Dashboard org cards (Pages/Dashboard/Dashboard.jsx
// TILT) so the widgets get the exact same tilt feel + hover shadow.
const WIDGET_TILT = {
  maxAngle: 18, lerp: 0.05, lerpOut: 0.07,
  scale: 1.05, perspective: 700,
  gloss: { opacity: 0.18, spread: 60 },
};

function PovWidget({ icon, label, status, statusClass = 'pov-widget-status--none', onClick, pill }) {
  const { ref, glossRef, handlers } = InteractiveSection(WIDGET_TILT, false);
  return (
    <button ref={ref} className="pov-widget" onClick={onClick} {...handlers}>
      <div ref={glossRef} className="pov-widget-gloss" />
      <div className="pov-widget-icon">{icon}</div>
      <div className="pov-widget-info">
        <span className="pov-widget-label">{label}</span>
        <span className={`pov-widget-status ${statusClass}`}>{status}</span>
      </div>
      {pill}
      <ArrowRight className="pov-widget-arrow" weight="bold" />
    </button>
  );
}

// ── Action Center — operational "what to do now" queue ─────────
const ACTION_ICON = {
  fulfill:  PackageIcon,
  returns:  ArrowUUpLeft,
  bookings: CalendarCheck,
  restock:  Warehouse,
  messages: ChatCircle,
};

// One tile = one InteractiveSection hook (can't call hooks inside .map()).
function ActionTile({ action, navigate }) {
  const { t } = useTranslation();
  const { ref, glossRef, handlers } = InteractiveSection(WIDGET_TILT, false);
  const Icon = ACTION_ICON[action.key] ?? Circle;
  const has  = action.count > 0;
  return (
    <button ref={ref} type="button"
      className={`pov-action-tile${has ? ' pov-action-tile--active' : ''}`}
      onClick={() => action.route && navigate(action.route)}
      {...handlers}>
      <div ref={glossRef} className="pov-action-gloss" />
      <div className="pov-action-top">
        <div className="pov-action-icon"><Icon weight="regular" /></div>
        <span className="pov-action-count">{action.count}</span>
      </div>
      <span className="pov-action-label">{t(`project.overview.actions.${action.key}`)}</span>
    </button>
  );
}

function ActionCenter({ actions, navigate }) {
  const { t } = useTranslation();
  if (!actions) return null;
  return (
    <section className="pov-section">
      <div className="pov-section-head">
        <span className="pov-section-title">{t('project.overview.needsAttention')}</span>
      </div>
      <div className="pov-action-grid">
        {actions.map(a => (
          <ActionTile key={a.key} action={a} navigate={navigate} />
        ))}
      </div>
    </section>
  );
}

// ── Store Advisor — Supabase-style fixable-issue cards ─────────
const ADVISOR_ICON = {
  critical: { Comp: WarningCircle, cls: 'pov-adv-icon--critical' },
  warning:  { Comp: Warning,       cls: 'pov-adv-icon--warning'  },
  info:     { Comp: Info,          cls: 'pov-adv-icon--info'     },
};

function StoreAdvisor({ advisor, navigate }) {
  const { t } = useTranslation();
  if (!advisor) return null;
  const n = advisor.length;
  return (
    <section className="pov-section">
      <div className="pov-section-head">
        <span className="pov-section-title">{t('project.overview.advisor')}</span>
        <span className={`pov-adv-pill ${n === 0 ? 'pov-adv-pill--ok' : 'pov-adv-pill--has'}`}>
          {n === 0 ? t('project.overview.allClear') : t('project.overview.suggestions', { count: n })}
        </span>
      </div>
      {n === 0 ? (
        <div className="pov-adv-empty">{t('project.overview.advisorEmpty')}</div>
      ) : (
        <div className="po-set-table pov-adv-table">
          {advisor.map(a => {
            const meta = ADVISOR_ICON[a.severity] ?? ADVISOR_ICON.info;
            const Icon = meta.Comp;
            return (
              <PoListRow key={a.key} className="pov-adv-row"
                onClick={() => a.route && navigate(a.route)}>
                <Icon className={`pov-adv-icon ${meta.cls}`} weight="fill" />
                <span className="pov-adv-text">
                  <span className="pov-adv-title">{t(`project.overview.advisorItems.${a.key}.title`, a.params || {})}</span>
                  <span className="pov-adv-detail">{t(`project.overview.advisorItems.${a.key}.detail`, a.params || {})}</span>
                </span>
                <ArrowRight className="pov-adv-arrow" weight="bold" />
              </PoListRow>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Project Overview ───────────────────────────────────────────

function Project() {
  const { t } = useTranslation();
  const { projectId, project: ctxProject } = useOutletContext();
  const navigate = useNavigate();
  const pq = `?project_id=${projectId}`;

  const [emailDomain,   setEmailDomain]   = useState(undefined);
  const [health,        setHealth]        = useState(null);
  const [stats,         setStats]         = useState(null);
  const [extra,         setExtra]         = useState(null);

  const sseRef       = useRef(null);
  const prevCountRef = useRef(-1);
  const prevIdRef    = useRef(-1);

  // ── Fetch data ───────────────────────────────────────────
  // ONE round-trip to /overview-bundle returns all 4 sections (email_domain,
  // orders_stats, overview_status, overview_extra). Previously this fired
  // 4 separate fetches in parallel; on Fly the threadpool serialised them
  // because every endpoint independently ran require_page_auto + Depends
  // (get_current_user). The bundle pays that cost once, then fans out
  // into the 4 setState calls — same screen, ~450 ms less network spent
  // (RTT KZ → fra ≈ 150 ms × 3 saved hops) + fewer connection slots used.
  useEffect(() => {
    fetch(`${API_BASE}/api/projects/${projectId}/overview-bundle`,
          { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(bundle => {
        if (!bundle) {
          setEmailDomain(null); setStats(null); setHealth(null); setExtra(null);
          return;
        }
        setEmailDomain(bundle.email_domain    ?? null);
        setStats      (bundle.orders_stats    ?? null);
        setHealth     (bundle.overview_status ?? null);
        setExtra      (bundle.overview_extra  ?? null);
      })
      .catch(() => {
        setEmailDomain(null); setStats(null); setHealth(null); setExtra(null);
      });
  }, [projectId]);

  // ── SSE — live new-order updates ─────────────────────────
  // Defer the EventSource handshake by 800 ms so it doesn't compete with
  // the initial-paint fetches for the same network sockets. SSE only keeps
  // the "N new" pill in sync; missing the first 800 ms of new orders is
  // invisible to the operator and saves real wall-clock time on the page.
  useEffect(() => {
    prevCountRef.current = -1;
    prevIdRef.current    = -1;
    let es = null;
    const timerId = setTimeout(() => {
      es = new EventSource(
        `${API_BASE}/api/orders/stream${pq}`,
        { withCredentials: true },
      );
      sseRef.current = es;
      es.onmessage = (e) => {
        try {
          const d      = JSON.parse(e.data);
          const count  = d.new_count;
          const lastId = d.last_id ?? 0;
          const isInit = prevCountRef.current === -1;
          const newOrder = !isInit && lastId > prevIdRef.current;
          const countChanged = !isInit && count !== prevCountRef.current;
          if (newOrder || countChanged) {
            fetch(`${API_BASE}/api/orders/stats${pq}`, { credentials: 'include' })
              .then(r => (r.ok ? r.json() : null))
              .then(s => { if (s) setStats(s); })
              .catch(() => {});
          } else if (!isInit) {
            setStats(prev => prev
              ? { ...prev, new_count: count }
              : { new_count: count, today_orders: 0, today_revenue: 0, recent: [] });
          }
          prevCountRef.current = count;
          prevIdRef.current    = lastId;
        } catch { /* ignore */ }
      };
    }, 800);
    return () => {
      clearTimeout(timerId);
      if (es) es.close();
    };
  }, [projectId]);

  // ── Derived ──────────────────────────────────────────────
  // Backend returns dkim_ok for the verified flag — Email is "Enabled" only
  // once DKIM passes (a custom domain row alone isn't enough to send mail).
  const emailVerified   = emailDomain?.dkim_ok;
  const emailConfigured = emailDomain?.domain && !emailDomain?.dkim_ok;
  const newCount        = stats?.new_count ?? 0;
  const currency        = stats?.currency || ctxProject?.currency || 'USD';
  // Plan label = the org's real subscription tier (ctxProject.plan_slug),
  // capitalised (free → Free, pro → Pro). Falls back to Free if absent.
  const plan            = ctxProject?.plan_slug || 'free';
  const planLabel       = plan.charAt(0).toUpperCase() + plan.slice(1);

  return (
    <div className="pov-page">
    <div className="pov-body">

      {/* ── Left column: title + keys + status + widgets ── */}
      <div className="pov-left">
        <h1 className="crm-page-title">{ctxProject?.name ?? t('project.overview.fallbackName')}</h1>

        <CopyKeys
          apiKey={ctxProject?.api_key}
          publishableKey={ctxProject?.publishable_key}
          secretKey={ctxProject?.secret_key}
        />

        <StatusCard status={health} />

        <div className="pov-widget-grid">

          {/* Customer Email Login — "Enabled" once DKIM verified */}
          <PovWidget
            icon={<Envelope weight="regular" />}
            label={t('project.overview.emailSignin')}
            statusClass={emailVerified ? 'pov-widget-status--ok'
              : emailConfigured ? 'pov-widget-status--warn'
              : 'pov-widget-status--none'}
            status={emailDomain === undefined ? '…'
              : emailVerified   ? t('project.overview.enabled')
              : emailConfigured ? t('project.overview.pendingDns')
              : t('project.overview.notConfigured')}
            onClick={() => navigate('authentication')} />

          {/* Subscription plan — clicks through to org Billing page where
              the actual upgrade/cancel UI lives. */}
          <PovWidget
            icon={<ShoppingBag weight="regular" />}
            label={t('project.overview.plan')}
            statusClass="pov-widget-status--plan"
            status={planLabel}
            onClick={() => ctxProject?.org_slug && navigate(`/org/${ctxProject.org_slug}/billing`)} />

          {/* Orders — count includes physical + digital + service bookings */}
          <PovWidget
            icon={<PackageIcon weight="regular" />}
            label={t('project.overview.orders')}
            status={stats === null ? '…' : t('project.overview.ordersToday', { count: stats.today_orders ?? 0 })}
            pill={newCount > 0 ? <span className="pov-new-pill">{t('project.overview.newPill', { count: newCount })}</span> : null}
            onClick={() => navigate('orders')} />

          {/* Revenue — sums products + bookings for today */}
          <PovWidget
            icon={<CurrencyDollar weight="regular" />}
            label={t('project.overview.todaysRevenue')}
            status={stats === null ? '…' : fmtMoney(stats.today_revenue, currency)}
            onClick={() => navigate('revenue')} />

        </div>
      </div>

      {/* ── Right column: recent activity (orders + bookings) ── */}
      <div className="pov-right">
        <div className="pov-recent">
          <div className="pov-recent-header">
            <span className="pov-recent-title">{t('project.overview.recentActivity')}</span>
            {newCount > 0 && <span className="pov-recent-new">{t('project.overview.newPill', { count: newCount })}</span>}
            <div className="pov-recent-actions">
              <button className="pov-recent-all" onClick={() => navigate('orders')}>
                {t('project.overview.ordersLink')} <ArrowRight weight="bold" />
              </button>
              <button className="pov-recent-all" onClick={() => navigate('booking')}>
                {t('project.overview.bookingsLink')} <ArrowRight weight="bold" />
              </button>
            </div>
          </div>

          {stats === null ? (
            <div className="pov-recent-empty">{t('project.overview.loading')}</div>
          ) : !stats.recent?.length ? (
            <div className="pov-recent-empty">{t('project.overview.noActivity')}</div>
          ) : (
            <div className="po-set-table pov-recent-table">
              {stats.recent.map(item => {
                const isBooking = item.kind === 'booking';
                return (
                  <PoListRow
                    key={`${item.kind}-${item.id}`}
                    className="pov-recent-row"
                    onClick={() => navigate(isBooking ? 'booking' : 'orders')}>
                    <span className="pov-recent-kind">
                      {isBooking
                        ? <CalendarCheck weight="regular" />
                        : <PackageIcon weight="regular" />}
                    </span>
                    <span className="pov-recent-cell pov-recent-cell--name">
                      <span className="pov-recent-name">{item.name}</span>
                      <span className="pov-recent-sub">
                        {isBooking ? (item.detail || t('project.overview.booking')) : t('project.overview.orderNumber', { id: item.id })}
                      </span>
                    </span>
                    <span className="pov-recent-cell pov-recent-cell--date">
                      {fmtDate(item.created_at)}
                    </span>
                    <span className="pov-recent-cell pov-recent-cell--status">
                      <StatusBadge status={item.status} />
                    </span>
                    <span className="pov-recent-cell pov-recent-cell--amount">
                      {fmtMoney(item.amount, item.currency)}
                    </span>
                  </PoListRow>
                );
              })}
            </div>
          )}
        </div>
      </div>

    </div>

    {/* ── Below the fold: operational queue + advisor ── */}
    <ActionCenter actions={extra?.actions} navigate={navigate} />
    <StoreAdvisor advisor={extra?.advisor} navigate={navigate} />

    </div>
  );
}

export default Project;
