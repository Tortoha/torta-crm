// Admin Logs — same shell as the CRM Targets / Users page: a TabSwitcher
// (auth-tab-*), an .org-toolbar (search + filter pill), and a .po-set-table
// whose rows are PoListRow (InteractiveSection 3D tilt + gloss). 4 tabs:
//   Activity / Logins / Admin audit / Technical.
// Search + filter run client-side over the loaded page (per_page=200).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pulse, SignIn, ShieldCheck, Warning, MagnifyingGlass } from '@phosphor-icons/react';
import { API_BASE } from '../api.js';
import { PoListRow } from '../Utils/PoListRow.jsx';
import '../Style/Authentication.css';
import '../Style/Organization.css';
import '../Style/Products.css';
import '../Style/Targets.css';
import '../Style/Users.css';
import '../Style/Logs.css';

const TABS = [
  { key: 'activity', label: 'Activity',    endpoint: 'activity', Icon: Pulse },
  { key: 'logins',   label: 'Logins',      endpoint: 'logins',   Icon: SignIn },
  { key: 'audit',    label: 'Admin audit', endpoint: 'audit',    Icon: ShieldCheck },
  { key: 'errors',   label: 'Technical',   endpoint: 'errors',   Icon: Warning },
];

const FILTERS = {
  activity: [
    { value: 'all', label: 'All' }, { value: 'signup', label: 'Signups' },
    { value: 'org', label: 'Orgs' }, { value: 'project', label: 'Projects' },
    { value: 'order', label: 'Orders' }, { value: 'ban', label: 'Bans' },
  ],
  logins: [
    { value: 'all', label: 'All' }, { value: 'success', label: 'Success' },
    { value: 'failed', label: 'Failed' },
  ],
  audit: [
    { value: 'all', label: 'All' }, { value: 'ban', label: 'Bans' },
    { value: 'unban', label: 'Unbans' }, { value: 'delete_user', label: 'Deletions' },
  ],
  errors: [
    { value: 'all', label: 'All' }, { value: '5xx', label: '5xx' },
    { value: '4xx', label: '4xx' },
  ],
};

function fmt(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return String(iso); }
}
function flag(code) {
  if (!code || code.length !== 2 || !/^[A-Za-z]{2}$/.test(code)) return '🌍';
  const A = 0x1F1E6; const c = code.toUpperCase();
  return String.fromCodePoint(A + c.charCodeAt(0) - 65) +
         String.fromCodePoint(A + c.charCodeAt(1) - 65);
}
const Tag = ({ kind, children }) =>
  <span className={`lg-tag lg-tag--${kind}`}>{children ?? kind}</span>;

// Per-tab columns: { label, w (grid track), cell, strong?, muted?, ellipsis? }
const COLS = {
  activity: [
    { label: 'When',   w: '1.1fr', cell: r => fmt(r.created_at), muted: true },
    { label: 'Event',  w: '0.8fr', cell: r => <Tag kind={r.kind} /> },
    { label: 'Detail', w: '2.6fr', cell: r => r.title || '—', strong: true, ellipsis: true },
    { label: '',       w: '1.4fr', cell: r => r.meta || '', muted: true, ellipsis: true },
  ],
  logins: [
    { label: 'When',    w: '1.2fr', cell: r => fmt(r.created_at), muted: true },
    { label: 'Email',   w: '2fr',   cell: r => r.email || '—', strong: true, ellipsis: true },
    { label: 'Result',  w: '1fr',   cell: r => r.success ? <Tag kind="ok">success</Tag> : <Tag kind="bad">{r.detail || 'failed'}</Tag> },
    { label: 'Country', w: '0.9fr', cell: r => r.country ? `${flag(r.country)} ${r.country}` : '—', muted: true },
    { label: 'IP',      w: '1.3fr', cell: r => r.ip || '—', muted: true, ellipsis: true },
    { label: 'Method',  w: '0.8fr', cell: r => r.method || '—', muted: true },
  ],
  audit: [
    { label: 'When',   w: '1.2fr', cell: r => fmt(r.created_at), muted: true },
    { label: 'Admin',  w: '1.7fr', cell: r => r.admin_email || (r.admin_id ? `#${r.admin_id}` : '—'), strong: true, ellipsis: true },
    { label: 'Action', w: '1fr',   cell: r => <Tag kind={r.action}>{(r.action || '').replace('_', ' ')}</Tag> },
    { label: 'Target', w: '1.7fr', cell: r => r.target_email || (r.target_user_id ? `#${r.target_user_id}` : '—'), muted: true, ellipsis: true },
    { label: 'Detail', w: '2.2fr', cell: r => r.detail || '—', muted: true, ellipsis: true },
  ],
  errors: [
    { label: 'When',   w: '1.2fr', cell: r => fmt(r.created_at), muted: true },
    { label: 'Status', w: '0.7fr', cell: r => <Tag kind="bad">{r.status}</Tag> },
    { label: 'Method', w: '0.7fr', cell: r => r.method || '', muted: true },
    { label: 'Path',   w: '2.2fr', cell: r => r.path || '—', strong: true, ellipsis: true },
    { label: 'Error',  w: '2.6fr', cell: r => r.error || '—', muted: true, ellipsis: true },
  ],
};

function searchText(it, tab) {
  switch (tab) {
    case 'logins': return `${it.email || ''} ${it.ip || ''} ${it.country || ''} ${it.method || ''} ${it.detail || ''}`.toLowerCase();
    case 'audit':  return `${it.admin_email || ''} ${it.target_email || ''} ${it.action || ''} ${it.detail || ''} ${it.target_user_id || ''}`.toLowerCase();
    case 'errors': return `${it.path || ''} ${it.error || ''} ${it.method || ''} ${it.status || ''}`.toLowerCase();
    default:       return `${it.title || ''} ${it.meta || ''} ${it.kind || ''}`.toLowerCase();
  }
}
function matchesFilter(it, tab, f) {
  if (f === 'all') return true;
  switch (tab) {
    case 'logins': return f === 'success' ? !!it.success : !it.success;
    case 'audit':  return it.action === f;
    case 'errors': return f === '5xx' ? Number(it.status) >= 500 : (Number(it.status) >= 400 && Number(it.status) < 500);
    default:       return it.kind === f;
  }
}

export default function Logs() {
  const [tab,  setTab]  = useState('activity');
  const [page, setPage] = useState(1);
  const [raw,  setRaw]  = useState(null);
  const [err,  setErr]  = useState('');
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');

  // Reset search/filter/page when switching tabs.
  useEffect(() => { setPage(1); setQ(''); setFilter('all'); }, [tab]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr('');
    const ep = (TABS.find(t => t.key === tab) || TABS[0]).endpoint;
    fetch(`${API_BASE}/api/admin/logs/${ep}?page=${page}&per_page=200`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => { if (!cancelled) setRaw(d); })
      .catch(e => { if (!cancelled) setErr(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tab, page]);

  const cols    = COLS[tab];
  const grid    = cols.map(c => c.w).join(' ');
  const filters = FILTERS[tab];
  const items   = raw?.items || [];
  const ql      = q.trim().toLowerCase();

  const filtered = useMemo(
    () => items.filter(it => matchesFilter(it, tab, filter) && (!ql || searchText(it, tab).includes(ql))),
    [items, tab, filter, ql],
  );

  const cellCls = (c) => {
    const cls = ['lg-gi'];
    if (c.strong)   cls.push('po-set-strong');
    if (c.muted)    cls.push('lg-muted');
    if (c.ellipsis) cls.push('lg-cell');
    return cls.join(' ');
  };

  return (
    <>
      <h1 className="crm-page-title">Logs</h1>

      {/* TabBar — same component/classes as the CRM Products page */}
      <TabSwitcher tabs={TABS} activeKey={tab} onPick={setTab} />

      {/* Toolbar — copies the CRM Targets / Users toolbar (search + filter pill) */}
      <div className="org-toolbar">
        <div className="org-search-wrap" style={{ flex: 1, minWidth: 240 }}>
          <MagnifyingGlass className="org-search-icon" />
          <input
            className="org-search-input"
            placeholder="Search logs…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {filters.length > 1 && (
          <div className="org-status-pill">
            {filters.map(opt => (
              <button key={opt.value} type="button"
                className={`org-status-btn${filter === opt.value ? ' org-status-btn--active' : ''}`}
                onClick={() => setFilter(opt.value)}>{opt.label}</button>
            ))}
          </div>
        )}
      </div>

      {err && <div className="crm-placeholder" style={{ color: 'var(--delete)' }}>Failed to load: {err}</div>}
      {loading && !raw && <div className="crm-placeholder">Loading…</div>}
      {raw && filtered.length === 0 && !err && (
        <div className="crm-placeholder">
          {q || filter !== 'all' ? 'No entries match these filters.' : 'No entries yet.'}
        </div>
      )}

      {raw && filtered.length > 0 && (
        <>
          <div className="po-set-table">
            <div className="po-set-row po-set-row--head" style={{ gridTemplateColumns: grid }}>
              {cols.map((c, i) => <span key={i}>{c.label}</span>)}
            </div>
            {filtered.map((r, idx) => (
              <PoListRow key={r.id ?? idx} style={{ gridTemplateColumns: grid }}>
                {cols.map((c, i) => <span key={i} className={cellCls(c)}>{c.cell(r)}</span>)}
              </PoListRow>
            ))}
          </div>

          <div className="adm-pagination">
            <span style={{ color: 'var(--muted)' }}>{filtered.length} shown · page {raw.page}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="crm-submit-btn auth-btn-secondary"
                disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
              <button className="crm-submit-btn auth-btn-secondary"
                disabled={items.length < 200} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ── Tab switcher — copied verbatim from the CRM Products page
// (Pages/Project/Products/Products.jsx). Same auth-tab-* classes + sliding
// indicator following hover → active. onPick receives the tab key.
function TabSwitcher({ tabs, activeKey, onPick }) {
  const indRef  = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);
  const curKey = hovered ?? activeKey;

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
  }, [curKey, activeKey]);

  return (
    <div className="auth-tab-wrapper">
      <div className="auth-tab-switcher" onMouseLeave={() => setHovered(null)}>
        <div ref={indRef} className="auth-tab-indicator" />
        {tabs.map(({ key, label, Icon }) => (
          <button key={key}
            ref={el => { btnRefs.current[key] = el; }}
            className={`auth-tab-btn${curKey === key ? ' auth-tab-btn--active' : ''}`}
            onMouseEnter={() => setHovered(key)}
            onClick={() => onPick(key)}
            type="button">
            <Icon className="auth-tab-icon" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
