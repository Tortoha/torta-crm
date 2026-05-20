import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import {
  MagnifyingGlass, X, CaretRight, CaretDown, ArrowsDownUp, Package,
  EnvelopeSimple, Phone, CheckCircle,
} from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { formatMoney } from '../../Utils/currency.js';
import { PoListRow } from '../../Utils/PoListRow.jsx';
import { DynamicBlock } from '../../Utils/DynamicBlock.js';
import '../../Style/Authentication.css';
import '../../Style/Products.css';
import '../../Style/Organization.css';
import '../../Style/Customers.css';

const SORT_OPTIONS = [
  { value: 'recent', label: 'Recent activity' },
  { value: 'spent',  label: 'Top spenders'    },
  { value: 'orders', label: 'Most orders'     },
  { value: 'name',   label: 'Name A–Z'        },
  { value: 'joined', label: 'Newest'          },
];

// Order status badge (mirrors the Orders page palette).
const ORDER_STATUS = {
  new:       'cust-badge--new',
  confirmed: 'cust-badge--confirmed',
  shipped:   'cust-badge--shipped',
  delivered: 'cust-badge--delivered',
  cancelled: 'cust-badge--cancelled',
  refunded:  'cust-badge--refunded',
};
// Payment status colour.
const PAY_STATUS = {
  paid:             'cust-pay--ok',
  manual:           'cust-pay--muted',
  pending:          'cust-pay--warn',
  failed:           'cust-pay--bad',
  refunded:         'cust-pay--warn',
  partial_refunded: 'cust-pay--warn',
};

function initials(name, email) {
  const src = (name || email || '?').trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtShort(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function Avatar({ url, name, email }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return <img className="cust-avatar" src={url} alt="" onError={() => setFailed(true)} />;
  }
  return <span className="cust-avatar cust-avatar--initials">{initials(name, email)}</span>;
}

// ── Sort dropdown ────────────────────────────────────────────
// Mirrors the Products "All Categories" filter (cat-filter-* classes +
// DynamicBlock sliding indicator) for a consistent toolbar control.
function SortDropdown({ value, options, onChange }) {
  const btnRef = useRef(null);
  const [open, setOpen]       = useState(false);
  const [pos, setPos]         = useState(null);
  const [hovered, setHovered] = useState(null);

  const current = hovered ?? value;
  // `open` as resetKey → indicator re-measures when the portal mounts.
  const { indRef, setItemRef } = DynamicBlock(current, open);

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left, width: Math.max(200, r.width) });
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    const onPd  = e => { if (!e.target.closest?.('.cat-filter-dropdown') && !btnRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPd);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPd);
    };
  }, [open]);

  const label = options.find(o => o.value === value)?.label || 'Sort';

  return (
    <>
      <button ref={btnRef} className="cat-filter-btn" type="button"
        onClick={() => setOpen(v => !v)}>
        <ArrowsDownUp className="cat-filter-icon" />
        <span>{label}</span>
        <CaretDown className="cat-filter-caret" weight="bold" />
      </button>
      {open && pos && createPortal(
        <div className="cat-filter-dropdown" style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
          onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
          onMouseLeave={() => setHovered(null)}>
          <div ref={indRef} className="cat-filter-indicator" />
          {options.map(o => (
            <button key={o.value}
              ref={setItemRef(o.value)}
              className={`cat-filter-item${current === o.value ? ' cat-filter-item--current' : ''}`}
              onMouseEnter={() => setHovered(o.value)}
              onClick={() => { onChange(o.value); setOpen(false); }}>
              <span>{o.label}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

// ── Detail modal ─────────────────────────────────────────────
function CustomerModal({ custId, pq, currency, onClose }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/customers/${custId}${pq}`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [custId, pq, onClose]);

  const p   = data?.profile;
  const st  = data?.stats;
  const cur = data?.currency || currency;

  return createPortal(
    <div className="auth-modal-overlay cust-overlay"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal cust-modal" onClick={e => e.stopPropagation()}>
        {loading || !p ? (
          <div className="cust-modal-loading">{loading ? 'Loading…' : 'Customer not found'}</div>
        ) : (
          <>
            <div className="auth-modal-head cust-modal-head">
              <div className="cust-profile">
                <Avatar url={p.avatar_url} name={p.name} email={p.email} />
                <div className="cust-profile-text">
                  <div className="cust-profile-name">
                    {p.name || 'Guest customer'}
                    {p.is_guest && <span className="cust-guest">Guest</span>}
                  </div>
                  <div className="cust-profile-contacts">
                    {p.email && <span><EnvelopeSimple weight="regular" /> {p.email}</span>}
                    {p.phone && <span><Phone weight="regular" /> {p.phone}
                      {p.phone_verified && <CheckCircle weight="fill" className="cust-verified" />}</span>}
                  </div>
                  <div className="cust-profile-meta">
                    Joined {fmtDate(p.created_at)}
                    {p.oauth_provider && ` · via ${p.oauth_provider}`}
                  </div>
                </div>
              </div>
              <button className="auth-modal-close" onClick={onClose} type="button">
                <X className="auth-modal-close-icon" />
              </button>
            </div>

            <div className="auth-modal-body cust-modal-body">
              {/* Stat tiles */}
              <div className="cust-stats">
                <div className="cust-stat">
                  <span className="cust-stat-val">{st.orders}</span>
                  <span className="cust-stat-label">Orders</span>
                </div>
                <div className="cust-stat">
                  <span className="cust-stat-val">{formatMoney(st.total_spent, cur, { decimals: 0 })}</span>
                  <span className="cust-stat-label">Lifetime spend</span>
                </div>
                <div className="cust-stat">
                  <span className="cust-stat-val">{formatMoney(st.avg_order, cur, { decimals: 0 })}</span>
                  <span className="cust-stat-label">Avg order</span>
                </div>
                <div className="cust-stat">
                  <span className="cust-stat-val">{st.returns}</span>
                  <span className="cust-stat-label">Returns</span>
                </div>
              </div>

              {/* Order history */}
              <div className="cust-section-label">Order history</div>
              {data.orders.length === 0 ? (
                <div className="crm-placeholder">No orders yet.</div>
              ) : (
                <div className="cust-orders">
                  {data.orders.map(o => (
                    <div className="cust-order" key={o.id}>
                      <span className="cust-order-icon"><Package weight="regular" /></span>
                      <span className="cust-order-main">
                        <span className="cust-order-id">Order #{o.id}</span>
                        <span className="cust-order-sub">
                          {fmtShort(o.created_at)} · {o.items_count} item{o.items_count === 1 ? '' : 's'}
                          {o.payment_provider && ` · ${o.payment_provider}`}
                          {o.payment_method && ` (${o.payment_method})`}
                        </span>
                      </span>
                      <span className={`cust-pay ${PAY_STATUS[o.payment_status] || 'cust-pay--muted'}`}>
                        {o.payment_status || '—'}
                      </span>
                      <span className={`cust-badge ${ORDER_STATUS[o.status] || ''}`}>{o.status}</span>
                      <span className="cust-order-amount">
                        {formatMoney(o.total_amount, o.payment_currency || cur)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

// ── Customers list page ──────────────────────────────────────
export default function Customers() {
  const { projectId, project } = useOutletContext();
  const pq = `?project_id=${projectId}`;
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [sort, setSort]       = useState('recent');
  const [currency, setCurrency] = useState(project?.currency || 'USD');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      setLoading(true);
      fetch(`${API_BASE}/api/customers${pq}&search=${encodeURIComponent(search)}&sort=${sort}&limit=100`,
        { credentials: 'include' })
        .then(r => (r.ok ? r.json() : { items: [] }))
        .then(d => {
          if (!alive) return;
          setItems(d.items || []);
          if (d.currency) setCurrency(d.currency);
        })
        .finally(() => { if (alive) setLoading(false); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [projectId, search, sort]);

  return (
    <>
      <h1 className="crm-page-title">Customers</h1>
      <p className="po-block-hint">
        Everyone who signed up or placed an order. Click a customer to see their full
        order history and how they paid.
      </p>

      <div className="org-toolbar">
        <div className="org-search-wrap">
          <MagnifyingGlass className="org-search-icon" />
          <input className="org-search-input" placeholder="Search name, email, phone…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="org-toolbar-right">
          <SortDropdown value={sort} options={SORT_OPTIONS} onChange={setSort} />
        </div>
      </div>

      {loading ? (
        <div className="crm-placeholder">Loading…</div>
      ) : items.length === 0 ? (
        <div className="crm-placeholder">{search ? 'No customers match your search.' : 'No customers yet.'}</div>
      ) : (
        <div className="po-set-table">
          <div className="po-set-row po-set-row--head cust-row">
            <span>Customer</span><span>Orders</span><span>Spent</span><span>Last order</span><span></span>
          </div>
          {items.map(c => (
            <PoListRow key={c.id} className="cust-row cust-row--clickable"
              onClick={() => setSelected(c.id)}>
              <span className="cust-cell-main">
                <Avatar url={c.avatar_url} name={c.name} email={c.email} />
                <span className="cust-id">
                  <span className="cust-name">
                    {c.name || 'Guest'}
                    {c.is_guest && <span className="cust-guest">Guest</span>}
                  </span>
                  <span className="cust-sub">{c.email || c.phone || '—'}</span>
                </span>
              </span>
              <span className="cust-cell">{c.order_count}</span>
              <span className="cust-cell cust-spent">{formatMoney(c.total_spent, currency, { decimals: 0 })}</span>
              <span className="cust-cell cust-muted">{fmtShort(c.last_order_at) || '—'}</span>
              <span className="cust-cell cust-chevron"><CaretRight weight="bold" /></span>
            </PoListRow>
          ))}
        </div>
      )}

      {selected && (
        <CustomerModal custId={selected} pq={pq} currency={currency}
          onClose={() => setSelected(null)} />
      )}
    </>
  );
}
