import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Storefront, ListBullets, MagnifyingGlass,
  CaretRight, CaretDown, CaretUp, ArrowClockwise, CheckCircle, Bell,
} from '@phosphor-icons/react';
import { createPortal } from 'react-dom';
import { API_BASE } from '../../../api.js';
import { InteractiveSection } from '../../../Utils/InteractiveSection.js';
import {
  CONNECTORS, CONNECTOR_CATEGORIES, CONNECTOR_COUNTRIES,
} from './connectors.js';
import ConnectorIcon from './ConnectorIcon.jsx';
import ConnectorModal from './ConnectorModal.jsx';
import AccountingExportModal from './AccountingExportModal.jsx';
import RequestIntegrationModal from './RequestIntegrationModal.jsx';
import { Combobox } from '../Booking/BookingCreateModal.jsx';

import '../../../Style/Authentication.css';
import '../../../Style/Organization.css';
import '../../../Style/Products.css';
import '../../../Style/Integrations.css';

// Tilt config — copied 1:1 from Authentication.jsx ROW_TILT.
const ROW_TILT = {
  maxAngleX: 8, maxAngleY: 3, lerp: 0.05, lerpOut: 0.07,
  scale: 1.052, perspective: 900,
  gloss: { opacity: 0.10, spread: 40 },
};

// ── Tab switcher (mirror of Authentication's auth-tab-switcher) ────────

function TabSwitcher({ tab, setTab }) {
  const indRef  = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);
  const curTab = hovered ?? tab;

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el  = btnRefs.current[curTab];
      if (!ind || !el) return;
      ind.style.opacity   = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width     = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [curTab, tab]);

  const TABS = [
    { key: 'browse', label: 'Browse', Icon: Storefront },
    { key: 'logs',   label: 'Logs',   Icon: ListBullets },
  ];

  return (
    <div className="auth-tab-switcher" onMouseLeave={() => setHovered(null)}>
      <div ref={indRef} className="auth-tab-indicator" />
      {TABS.map(({ key, label, Icon }) => (
        <button key={key} ref={el => { btnRefs.current[key] = el; }}
          className={`auth-tab-btn${curTab === key ? ' auth-tab-btn--active' : ''}`}
          onMouseEnter={() => setHovered(key)}
          onClick={() => setTab(key)} type="button">
          <Icon className="auth-tab-icon" />
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Available row (installable) ────────────────────────────────────────
// Matches the Authentication.jsx ProviderRow visual; tilt + gloss; click to
// open the per-kind modal.

function AvailableRow({ connector, installedCount, onClick, first, last }) {
  const { ref, glossRef, handlers } = InteractiveSection(ROW_TILT, false);
  const cls = [
    'auth-provider-row',
    first && 'auth-provider-row--first',
    last  && 'auth-provider-row--last',
  ].filter(Boolean).join(' ');
  return (
    <div ref={ref} className={cls} onClick={onClick} {...handlers}>
      <div ref={glossRef} className="auth-provider-gloss" />
      <div className="auth-provider-icon-wrap">
        <ConnectorIcon icon={connector.icon} />
      </div>
      <span className="auth-provider-name">{connector.name}</span>
      <span className="auth-provider-desc">{connector.description}</span>
      {installedCount > 0
        ? <span className="auth-badge-enabled">
            <CheckCircle weight="fill" size={11} /> Installed{installedCount > 1 ? ` ×${installedCount}` : ''}
          </span>
        : <span className="auth-badge-disabled">Not installed</span>}
      <CaretRight className="auth-provider-chevron" />
    </div>
  );
}

// ── Coming-soon row (expandable) ───────────────────────────────────────
// Click to flip a feature panel open; second click opens the request modal.

function ComingSoonRow({ connector, first, last, onRequest }) {
  const [open, setOpen] = useState(false);
  const cls = [
    'auth-provider-row',
    'int-soon-row',
    first && 'auth-provider-row--first',
    last  && !open && 'auth-provider-row--last',
  ].filter(Boolean).join(' ');
  return (
    <div className={`int-soon-wrap${open ? ' int-soon-wrap--open' : ''}`}>
      <div className={cls} onClick={() => setOpen(o => !o)}>
        <div className="auth-provider-icon-wrap auth-provider-icon-wrap--dim">
          <ConnectorIcon icon={connector.icon} />
        </div>
        <span className="auth-provider-name int-soon-name">{connector.name}</span>
        <span className="auth-provider-desc">{connector.description}</span>
        <span className="auth-badge-disabled">Coming soon</span>
        {open
          ? <CaretUp className="auth-provider-chevron" />
          : <CaretDown className="auth-provider-chevron" />}
      </div>
      {open && (
        <div className={`int-soon-panel${last ? ' int-soon-panel--last' : ''}`}>
          {connector.features?.length > 0 && (
            <>
              <div className="int-soon-panel-title">Planned features</div>
              <ul className="int-soon-feature-list">
                {connector.features.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </>
          )}
          <button type="button" className="auth-btn-check int-notify-btn"
            onClick={(e) => { e.stopPropagation(); onRequest(connector); }}>
            <Bell size={14} weight="bold" /> Notify me when ready
          </button>
        </div>
      )}
    </div>
  );
}

// ── Browse tab ─────────────────────────────────────────────────────────

function BrowseTab({ subscriptions, onPick, onRequest }) {
  const [search, setSearch]   = useState('');
  const [country, setCountry] = useState('all');

  const subsByType = useMemo(() => {
    const m = {};
    for (const s of subscriptions) (m[s.type] = m[s.type] || []).push(s);
    return m;
  }, [subscriptions]);

  const q = search.toLowerCase();
  const filtered = CONNECTORS.filter(c => {
    if (country !== 'all' && c.country !== country && c.country !== 'global') return false;
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q);
  });

  return (
    <>
      <div className="int-toolbar">
        <div className="org-search-wrap" style={{ flex: 1, maxWidth: 360 }}>
          <MagnifyingGlass className="org-search-icon" />
          <input className="org-search-input" placeholder="Search integrations…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="int-region-combo">
          <Combobox value={country} searchable
            options={CONNECTOR_COUNTRIES.map(c => ({ value: c.key, label: c.label }))}
            onChange={setCountry} />
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="int-empty int-empty--small">
          <p>No integrations match your filters.</p>
        </div>
      )}

      {CONNECTOR_CATEGORIES.map(cat => {
        const list = filtered.filter(c => c.category === cat.key);
        if (!list.length) return null;
        // Sort: available first, then coming-soon — same ordering as Authentication.
        const ordered = [...list].sort((a, b) =>
          (a.available === false) - (b.available === false));
        return (
          <section key={cat.key} className="int-cat">
            <h3 className="int-cat-title">{cat.label}</h3>
            <div className="auth-providers-list">
              {ordered.map((c, idx) => {
                const first = idx === 0;
                const last  = idx === ordered.length - 1;
                return c.available === false
                  ? <ComingSoonRow key={c.type} connector={c} first={first} last={last}
                      onRequest={onRequest} />
                  : <AvailableRow key={c.type} connector={c}
                      installedCount={(subsByType[c.type] || []).length}
                      first={first} last={last}
                      onClick={() => onPick(c, (subsByType[c.type] || [])[0])} />;
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}

// Shared status dot for the Logs tab.

function StatusDot({ status }) {
  const cls = status === 'success' ? 'int-dot--ok'
    : status === 'failed' ? 'int-dot--err'
    : 'int-dot--idle';
  return <span className={`int-dot ${cls}`} />;
}

// ── Logs tab ───────────────────────────────────────────────────────────

function LogsTab({ projectId }) {
  const pq = `?project_id=${projectId}`;
  const [rows, setRows]   = useState([]);
  const [open, setOpen]   = useState(null);
  const [detail, setDetail] = useState({});
  const [busy, setBusy]   = useState(true);
  const [filter, setFilter] = useState({ status: '', event: '' });

  const load = useCallback(async () => {
    setBusy(true);
    const params = new URLSearchParams({ project_id: String(projectId), limit: '200' });
    if (filter.status) params.set('status', filter.status);
    if (filter.event)  params.set('event',  filter.event);
    const res = await fetch(`${API_BASE}/api/integrations/deliveries?${params}`, { credentials: 'include' });
    const data = res.ok ? await res.json() : [];
    setRows(Array.isArray(data) ? data : []);
    setBusy(false);
  }, [projectId, filter.status, filter.event]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (id) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    if (!detail[id]) {
      const res = await fetch(`${API_BASE}/api/integrations/deliveries/${id}${pq}`, { credentials: 'include' });
      if (res.ok) {
        const d = await res.json();
        setDetail(prev => ({ ...prev, [id]: d }));
      }
    }
  };

  const retry = async (id) => {
    setBusy(true);
    await fetch(`${API_BASE}/api/integrations/deliveries/${id}/retry${pq}`, {
      method: 'POST', credentials: 'include',
    });
    await load();
  };

  const fmtTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60)     return `${Math.floor(diff)}s ago`;
    if (diff < 3600)   return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400)  return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleString();
  };

  return (
    <>
      <div className="int-toolbar">
        <select className="int-filter-sel" value={filter.status}
          onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}>
          <option value="">All statuses</option>
          <option value="success">Success only</option>
          <option value="failed">Failed only</option>
        </select>
        <input className="org-search-input int-filter-input"
          placeholder="Filter by event (e.g. order.paid)…"
          value={filter.event}
          onChange={e => setFilter(f => ({ ...f, event: e.target.value }))} />
        <button className="auth-btn-check" onClick={load} type="button" disabled={busy}>
          <ArrowClockwise size={14} /> Refresh
        </button>
      </div>

      <div className="int-logs-table">
        <div className="int-logs-head">
          <span>Time</span><span>Event</span><span>Connector</span>
          <span>Status</span><span>HTTP</span><span>Duration</span><span />
        </div>
        {busy && rows.length === 0 && <p className="crm-placeholder">Loading…</p>}
        {!busy && rows.length === 0 && (
          <div className="int-empty int-empty--small">
            <p>No deliveries yet. Trigger an event (e.g. place a test order) or click "Test send" on an integration.</p>
          </div>
        )}
        {rows.map(r => (
          <div key={r.id} className="int-logs-row-wrap">
            <div className={`int-logs-row int-logs-row--${r.status}`}
              onClick={() => toggle(r.id)}>
              <span>{fmtTime(r.created_at)}</span>
              <code className="int-logs-event">{r.event}</code>
              <span>{r.sub_name || r.sub_type || '—'}</span>
              <span className="int-logs-status">
                <StatusDot status={r.status} />
                {r.status}
              </span>
              <span className="int-logs-http">{r.http_code ?? '—'}</span>
              <span>{r.duration_ms != null ? `${r.duration_ms} ms` : '—'}</span>
              <span><CaretDown size={12} weight="bold"
                style={{ transform: open === r.id ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} /></span>
            </div>
            {open === r.id && (
              <div className="int-logs-detail">
                <div className="int-logs-detail-grid">
                  <div>
                    <div className="int-logs-detail-label">Payload</div>
                    <pre className="int-logs-pre">
                      {detail[r.id]
                        ? JSON.stringify(detail[r.id].payload, null, 2)
                        : 'Loading…'}
                    </pre>
                  </div>
                  <div>
                    <div className="int-logs-detail-label">Response body</div>
                    <pre className="int-logs-pre">
                      {(detail[r.id]?.response_body) || '(empty)'}
                    </pre>
                  </div>
                </div>
                {r.status === 'failed' && (
                  <button className="auth-btn-check" onClick={() => retry(r.id)} type="button">
                    <ArrowClockwise size={14} /> Retry
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

// ── Page ───────────────────────────────────────────────────────────────

export default function Integrations() {
  const { projectId } = useOutletContext();
  const pq = `?project_id=${projectId}`;
  const [tab,           setTab]           = useState('browse');
  const [subscriptions, setSubscriptions] = useState([]);
  // Modal routing: at most one of these is non-null at a time.
  // { kind: 'webhook' | 'accounting' | 'request', connector, existing }
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState('');
  const toastRef = useRef(null);

  const showToast = (msg) => {
    setToast(msg);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(''), 3200);
  };

  const load = useCallback(async () => {
    const res = await fetch(`${API_BASE}/api/integrations${pq}`, { credentials: 'include' });
    const data = res.ok ? await res.json() : [];
    setSubscriptions(Array.isArray(data) ? data : []);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // When the user clicks an available connector row.
  const onPickConnector = async (connector, existing) => {
    // Webhook-style + API-connector kinds share the same ConnectorModal —
    // ConnectorModal renders the right field set based on connector.fields meta.
    if (connector.kind === 'webhook' || connector.kind === 'apiconn') {
      if (existing) {
        const res = await fetch(`${API_BASE}/api/integrations/${existing.id}${pq}`, { credentials: 'include' });
        const full = res.ok ? await res.json() : existing;
        setModal({ kind: 'webhook', connector, existing: full });
      } else {
        setModal({ kind: 'webhook', connector, existing: null });
      }
      return;
    }
    // Accounting connectors auto-provision a row on first click so the modal
    // can read/write config from a stable id. We do this server-side via
    // POST /api/integrations and then open AccountingExportModal on the new row.
    if (connector.kind === 'accounting') {
      let sub = existing;
      if (!sub) {
        const res = await fetch(`${API_BASE}/api/integrations${pq}`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: connector.type, name: connector.name,
            url: '', events: [],
            config: { schedule: 'off', include_unpaid: false },
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          showToast(j.detail || 'Could not install');
          return;
        }
        const created = await res.json();
        // Re-fetch full row to populate name/config/url defaults.
        const full = await fetch(`${API_BASE}/api/integrations/${created.id}${pq}`, { credentials: 'include' });
        sub = full.ok ? await full.json() : { id: created.id, type: connector.type };
        await load();
      } else {
        // Always re-fetch a fresh copy on open — captures changes from
        // a background scheduler tick or a parallel admin session.
        const res = await fetch(`${API_BASE}/api/integrations/${existing.id}${pq}`, { credentials: 'include' });
        if (res.ok) sub = await res.json();
      }
      setModal({ kind: 'accounting', connector, existing: sub });
      return;
    }
    // Anything else (analytics/marketing/automation) — should not reach here
    // because we render those as Coming-soon. Defensive no-op.
  };

  const onRequest = (connector) => {
    setModal({ kind: 'request', connector });
  };

  return (
    <>
      <div className="auth-tab-wrapper">
        <TabSwitcher tab={tab} setTab={setTab} />
      </div>

      <div className="auth-page int-page">
        <h1 className="crm-page-title">Integrations</h1>
        <p className="auth-page-subtitle">
          Connect external tools to receive events from your store, or export
          accounting-ready files (1C / Kompra / QuickBooks / Xero / DATEV) on
          demand or on a schedule.
        </p>

        {tab === 'browse' && (
          <BrowseTab subscriptions={subscriptions}
            onPick={onPickConnector}
            onRequest={onRequest} />
        )}
        {tab === 'logs' && <LogsTab projectId={projectId} />}

        {modal?.kind === 'webhook' && (
          <ConnectorModal
            projectId={projectId}
            connectorType={modal.connector.type}
            existing={modal.existing}
            onClose={() => setModal(null)}
            onSaved={() => { showToast(modal.existing ? 'Saved' : 'Installed'); load(); }}
            onDeleted={() => { setModal(null); showToast('Deleted'); load(); }} />
        )}

        {modal?.kind === 'accounting' && (
          <AccountingExportModal
            projectId={projectId}
            sub={modal.existing}
            onClose={() => setModal(null)}
            onSaved={() => { load(); }}
            onDeleted={() => { setModal(null); showToast('Deleted'); load(); }}
            onToast={showToast} />
        )}

        {modal?.kind === 'request' && (
          <RequestIntegrationModal
            projectId={projectId}
            connector={modal.connector}
            onClose={() => setModal(null)}
            onSent={() => showToast('Request sent')} />
        )}

        {toast && createPortal(
          <div className="auth-toast">{toast}</div>,
          document.body
        )}
      </div>
    </>
  );
}
