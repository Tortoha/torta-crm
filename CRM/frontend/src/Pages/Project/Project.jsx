import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext, useNavigate } from 'react-router-dom';
import {
  Copy, Check, CaretDown,
  Envelope, GoogleLogo, Package, CurrencyDollar, ArrowRight, Key,
} from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { InteractiveSection } from '../../Utils/InteractiveSection.js';
import '../../Style/Project.css';

// ── Status badges ──────────────────────────────────────────────

const STATUS_META = {
  new:       { label: 'New',       cls: 'pov-order-badge--new'       },
  confirmed: { label: 'Confirmed', cls: 'pov-order-badge--confirmed'  },
  shipped:   { label: 'Shipped',   cls: 'pov-order-badge--shipped'    },
  delivered: { label: 'Delivered', cls: 'pov-order-badge--delivered'  },
  cancelled: { label: 'Cancelled', cls: 'pov-order-badge--cancelled'  },
  refunded:  { label: 'Refunded',  cls: 'pov-order-badge--refunded'   },
};

function StatusBadge({ status }) {
  const m = STATUS_META[status] ?? { label: status, cls: '' };
  return <span className={`pov-order-badge ${m.cls}`}>{m.label}</span>;
}

// ── Copy Keys button — Header-style dropdown ──────────────────

const COPY_ITEMS = [
  { key: 'pub', label: 'Public Key',      hint: 'in URL'  },
  { key: 'pk',  label: 'Publishable Key', hint: 'header'  },
];

const BTN_TILT = {
  maxAngle: 24, lerp: 0.07, lerpOut: 0.07,
  scale: 1.062, perspective: 900,
  gloss: { opacity: 0.14, spread: 60 },
};

function CopyKeys({ apiKey, publishableKey }) {
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
    setToast(`${label} copied`);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(''), 3200);
    setOpen(false);
  };

  const values = { pub: apiKey ?? '', pk: publishableKey ?? '' };
  const masked = { pub: apiKey ?? '—', pk: '•'.repeat(12) + (publishableKey ?? '').slice(-6) };

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
          Copy Keys
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

          {COPY_ITEMS.map(({ key, label, hint }) => (
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
                  <span className="pov-ck-hint">{hint}</span>
                </span>
                <span className="pov-ck-value">{masked[key]}</span>
              </span>
            </button>
          ))}
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

const fmtRevenue = (v) => v == null ? '—'
  : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

const fmtDate = (ts) => ts
  ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  : '';

// ── Project Overview ───────────────────────────────────────────

function Project() {
  const { projectId, project: ctxProject } = useOutletContext();
  const navigate = useNavigate();
  const pq = `?project_id=${projectId}`;

  const [emailDomain,   setEmailDomain]   = useState(undefined);
  const [oauthSettings, setOauthSettings] = useState(undefined);
  const [stats,         setStats]         = useState(null);

  const sseRef       = useRef(null);
  const prevCountRef = useRef(-1);
  const prevIdRef    = useRef(-1);

  // ── Fetch data ───────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/email-domain${pq}`,   { credentials: 'include' })
        .then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${API_BASE}/api/oauth-settings${pq}`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${API_BASE}/api/orders/stats${pq}`,   { credentials: 'include' })
        .then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([email, oauth, s]) => {
      setEmailDomain(email);
      setOauthSettings(oauth);
      setStats(s);
    });
  }, [projectId]);

  // ── SSE — live new-order updates ─────────────────────────
  useEffect(() => {
    prevCountRef.current = -1;
    prevIdRef.current    = -1;
    const es = new EventSource(
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
            .then(r => r.ok ? r.json() : null)
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
    return () => es.close();
  }, [projectId]);

  // ── Derived ──────────────────────────────────────────────
  const emailVerified   = emailDomain?.is_verified;
  const emailConfigured = emailDomain?.domain && !emailDomain?.is_verified;
  const oauthEnabled    = oauthSettings?.client_id;
  const newCount        = stats?.new_count ?? 0;

  return (
    <div className="pov-body">

      {/* ── Left column: title + keys + widgets ── */}
      <div className="pov-left">
        <h1 className="crm-page-title">{ctxProject?.name ?? 'Project'}</h1>

        <CopyKeys
          apiKey={ctxProject?.api_key}
          publishableKey={ctxProject?.publishable_key}
        />

        <div className="pov-widget-grid">

          {/* Email Domain */}
          <button className="pov-widget" onClick={() => navigate('authentication')}>
            <div className={`pov-widget-icon ${emailVerified ? 'pov-widget-icon--ok' : 'pov-widget-icon--neutral'}`}>
              <Envelope weight="duotone" />
            </div>
            <div className="pov-widget-info">
              <span className="pov-widget-label">Email Domain</span>
              <span className={`pov-widget-status ${
                emailVerified ? 'pov-widget-status--ok'
                : emailConfigured ? 'pov-widget-status--warn'
                : 'pov-widget-status--none'}`}>
                {emailDomain === undefined ? '…'
                  : emailVerified   ? 'Verified'
                  : emailConfigured ? 'Pending DNS'
                  : 'Not configured'}
              </span>
            </div>
            <ArrowRight className="pov-widget-arrow" weight="bold" />
          </button>

          {/* Google OAuth */}
          <button className="pov-widget" onClick={() => navigate('authentication')}>
            <div className={`pov-widget-icon ${oauthEnabled ? 'pov-widget-icon--ok' : 'pov-widget-icon--neutral'}`}>
              <GoogleLogo weight="duotone" />
            </div>
            <div className="pov-widget-info">
              <span className="pov-widget-label">Google OAuth</span>
              <span className={`pov-widget-status ${oauthEnabled ? 'pov-widget-status--ok' : 'pov-widget-status--none'}`}>
                {oauthSettings === undefined ? '…' : oauthEnabled ? 'Enabled' : 'Not configured'}
              </span>
            </div>
            <ArrowRight className="pov-widget-arrow" weight="bold" />
          </button>

          {/* Orders */}
          <button className="pov-widget" onClick={() => navigate('orders')}>
            <div className="pov-widget-icon pov-widget-icon--neutral">
              <Package weight="duotone" />
            </div>
            <div className="pov-widget-info">
              <span className="pov-widget-label">Orders</span>
              <span className="pov-widget-status pov-widget-status--none">
                {stats === null ? '…' : `${stats.today_orders ?? 0} today`}
              </span>
            </div>
            {newCount > 0 && <span className="pov-new-pill">{newCount} new</span>}
            <ArrowRight className="pov-widget-arrow" weight="bold" />
          </button>

          {/* Revenue */}
          <button className="pov-widget" onClick={() => navigate('revenue')}>
            <div className="pov-widget-icon pov-widget-icon--neutral">
              <CurrencyDollar weight="duotone" />
            </div>
            <div className="pov-widget-info">
              <span className="pov-widget-label">Today's Revenue</span>
              <span className="pov-widget-status pov-widget-status--none">
                {stats === null ? '…' : fmtRevenue(stats.today_revenue)}
              </span>
            </div>
            <ArrowRight className="pov-widget-arrow" weight="bold" />
          </button>

        </div>
      </div>

      {/* ── Right column: recent orders ── */}
      <div className="pov-right">
        <div className="pov-recent">
          <div className="pov-recent-header">
            <span className="pov-recent-title">Recent Orders</span>
            {newCount > 0 && <span className="pov-recent-new">{newCount} new</span>}
            <button className="pov-recent-all" onClick={() => navigate('orders')}>
              View all <ArrowRight weight="bold" />
            </button>
          </div>

          <div className="pov-recent-list">
            {stats === null ? (
              <div className="pov-recent-empty">Loading…</div>
            ) : !stats.recent?.length ? (
              <div className="pov-recent-empty">No orders yet</div>
            ) : stats.recent.map(order => (
              <div key={order.id} className="pov-recent-item" onClick={() => navigate('orders')}>
                <div className="pov-recent-info">
                  <span className="pov-recent-name">
                    {order.customer_name || order.recipient_name}
                  </span>
                  <span className="pov-recent-date">{fmtDate(order.created_at)}</span>
                </div>
                <div className="pov-recent-right">
                  <StatusBadge status={order.status} />
                  <span className="pov-recent-amount">{fmtRevenue(order.total_amount)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}

export default Project;
