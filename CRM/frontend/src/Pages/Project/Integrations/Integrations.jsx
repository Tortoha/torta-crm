import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Storefront, ListBullets, MagnifyingGlass,
  CaretRight, CaretDown, ArrowClockwise, CheckCircle,
} from '@phosphor-icons/react';
import { createPortal } from 'react-dom';
import { API_BASE } from '../../../api.js';
import { InteractiveSection } from '../../../Utils/InteractiveSection.js';
import { CONNECTORS, CONNECTOR_CATEGORIES } from './connectors.js';
import ConnectorIcon from './ConnectorIcon.jsx';
import ConnectorModal from './ConnectorModal.jsx';

// Tilt config — copied 1:1 from Authentication.jsx ROW_TILT.
const ROW_TILT = {
  maxAngleX: 8, maxAngleY: 3, lerp: 0.05, lerpOut: 0.07,
  scale: 1.052, perspective: 900,
  gloss: { opacity: 0.10, spread: 40 },
};
import '../../../Style/Authentication.css';
import '../../../Style/Organization.css';
import '../../../Style/Products.css';
import '../../../Style/Integrations.css';

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

// ── Browse tab ────────────────────────────────────────────────────────
// Visual pattern copied 1:1 from Authentication.jsx ProviderRow:
//   .auth-providers-list flex column, rows share top/bottom rounding,
//   thin separators between, hover lifts to rounded pill.

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

function ComingSoonRow({ connector, first, last }) {
  const cls = [
    'auth-provider-row',
    'auth-provider-row--disabled',
    first && 'auth-provider-row--first',
    last  && 'auth-provider-row--last',
  ].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <div className="auth-provider-icon-wrap auth-provider-icon-wrap--dim">
        <ConnectorIcon icon={connector.icon} />
      </div>
      <span className="auth-provider-name">{connector.name}</span>
      <span className="auth-provider-desc">{connector.description}</span>
      <span className="auth-badge-disabled">Coming soon</span>
      <CaretRight className="auth-provider-chevron" />
    </div>
  );
}

function BrowseTab({ subscriptions, onPick }) {
  const [search, setSearch] = useState('');
  const subsByType = useMemo(() => {
    const m = {};
    for (const s of subscriptions) (m[s.type] = m[s.type] || []).push(s);
    return m;
  }, [subscriptions]);

  const q = search.toLowerCase();
  const filtered = q
    ? CONNECTORS.filter(c => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))
    : CONNECTORS;

  // Click on installed → open edit modal for the (first) subscription so users
  // can reconfigure or delete. Click on not-installed → open install modal.
  const handlePick = (type) => {
    const subs = subsByType[type] || [];
    if (subs.length > 0) onPick(type, subs[0]);
    else onPick(type, null);
  };

  return (
    <>
      <div className="int-toolbar">
        <div className="org-search-wrap" style={{ flex: 1, maxWidth: 360 }}>
          <MagnifyingGlass className="org-search-icon" />
          <input className="org-search-input" placeholder="Search integrations…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {CONNECTOR_CATEGORIES.map(cat => {
        const list = filtered.filter(c => c.category === cat.key);
        if (!list.length) return null;
        // Sort: available first, then coming-soon (matches Authentication ordering of configurable→disabled).
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
                  ? <ComingSoonRow key={c.type} connector={c} first={first} last={last} />
                  : <AvailableRow key={c.type} connector={c}
                      installedCount={(subsByType[c.type] || []).length}
                      first={first} last={last}
                      onClick={() => handlePick(c.type)} />;
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}

// Status dot is shared with the Logs tab. Active tab + ActiveRow were dropped —
// installed connectors are managed inline from the Browse list (clicking an
// "Installed" row opens the edit modal directly).

function StatusDot({ status }) {
  const cls = status === 'success' ? 'int-dot--ok'
    : status === 'failed' ? 'int-dot--err'
    : 'int-dot--idle';
  return <span className={`int-dot ${cls}`} />;
}

// ── Logs tab ──────────────────────────────────────────────────────────

function LogsTab({ projectId }) {
  const pq = `?project_id=${projectId}`;
  const [rows, setRows]   = useState([]);
  const [open, setOpen]   = useState(null);     // expanded delivery id
  const [detail, setDetail] = useState({});     // {id: full detail row}
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

// ── Page ─────────────────────────────────────────────────────────────

export default function Integrations() {
  const { projectId } = useOutletContext();
  const pq = `?project_id=${projectId}`;
  const [tab,           setTab]           = useState('browse');
  const [subscriptions, setSubscriptions] = useState([]);
  const [modal,         setModal]         = useState(null);  // { type, existing }
  const [toast,         setToast]         = useState('');
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

  const onPickConnector = async (type, existing) => {
    if (!existing) {
      setModal({ type, existing: null });
      return;
    }
    // Re-fetch full row (including secret) for editing
    const res = await fetch(`${API_BASE}/api/integrations/${existing.id}${pq}`, { credentials: 'include' });
    if (res.ok) {
      const full = await res.json();
      setModal({ type: full.type, existing: full });
    }
  };

  return (
    <>
      {/* Sticky tab switcher — same pattern as Authentication.jsx */}
      <div className="auth-tab-wrapper">
        <TabSwitcher tab={tab} setTab={setTab} />
      </div>

      <div className="auth-page int-page">
        <h1 className="crm-page-title">Integrations</h1>
        <p className="auth-page-subtitle">
          Connect external tools to receive events from your store. The marketplace
          ships with Slack, Discord and Custom Webhook today; more are added on demand.
        </p>

        {tab === 'browse' && (
          <BrowseTab subscriptions={subscriptions} onPick={onPickConnector} />
        )}
        {tab === 'logs' && <LogsTab projectId={projectId} />}

        {modal && (
          <ConnectorModal
            projectId={projectId}
            connectorType={modal.type}
            existing={modal.existing}
            onClose={() => setModal(null)}
            onSaved={() => { showToast(modal.existing ? 'Saved' : 'Installed'); load(); }}
            onDeleted={() => { setModal(null); showToast('Deleted'); load(); }} />
        )}

        {toast && createPortal(
          <div className="auth-toast">{toast}</div>,
          document.body
        )}
      </div>
    </>
  );
}
