// Org Customers — cross-project customer list.
// Reuses the SortDropdown + Avatar + CustomerModal + helpers from the
// project-level Customers page so the org page LOOKS identical, just with
// an extra Project column and a project filter in the toolbar.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  MagnifyingGlass, CaretRight, CaretDown, Storefront,
} from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { formatMoney } from '../../Utils/currency.js';
import { PoListRow } from '../../Utils/PoListRow.jsx';
import { DynamicBlock } from '../../Utils/DynamicBlock.js';
import {
  SortDropdown, Avatar, CustomerModal, fmtShort,
} from '../Project/Customers.jsx';
import '../../Style/Authentication.css';
import '../../Style/Products.css';
import '../../Style/Organization.css';
import '../../Style/Customers.css';

const SORT_VALUES = ['recent', 'spent', 'orders', 'name', 'joined'];

// ── Project filter — mirrors SortDropdown styling (cat-filter-*) so the
//    toolbar feels uniform. Selecting a project narrows the list to that
//    store's customers; "All projects" clears the filter.
function ProjectFilter({ value, projects, onChange }) {
  const { t } = useTranslation();
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos]   = useState(null);
  const [hov, setHov]   = useState(null);
  const current = hov ?? `p:${value ?? 'all'}`;
  const { indRef, setItemRef } = DynamicBlock(current, open);

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left, width: Math.max(220, r.width) });
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    const onPd  = e => { if (!e.target.closest?.('.cat-filter-dropdown') && !btnRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPd);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPd);
    };
  }, [open]);

  const items = [{ id: 0, name: t('org.customersPage.allProjects') }, ...projects];
  const selected = projects.find(p => p.id === value);
  const label = selected ? selected.name : t('org.customersPage.allProjects');

  return (
    <>
      <button ref={btnRef} className="cat-filter-btn" type="button"
        onClick={() => setOpen(v => !v)}>
        <Storefront weight="duotone" className="cat-filter-icon" />
        <span>{label}</span>
        <CaretDown className="cat-filter-caret" weight="bold" />
      </button>
      {open && pos && createPortal(
        <div className="cat-filter-dropdown" style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
          onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
          onMouseLeave={() => setHov(null)}>
          <div ref={indRef} className="cat-filter-indicator" />
          {items.map(p => {
            const k = `p:${p.id || 'all'}`;
            return (
              <button key={p.id} ref={setItemRef(k)}
                className={`cat-filter-item${current === k ? ' cat-filter-item--current' : ''}`}
                onMouseEnter={() => setHov(k)}
                onClick={() => { onChange(p.id || null); setOpen(false); }}>
                <span>{p.name}</span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}

// ── Org Customers list ──────────────────────────────────────
export default function OrgCustomers() {
  const { t } = useTranslation();
  const { org } = useOutletContext();
  const orgId = org?.id;

  const sortOptions = SORT_VALUES.map(v => ({ value: v, label: t(`orders.customers.sort.${v}`) }));
  const [items,    setItems]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [search,   setSearch]   = useState('');
  const [sort,     setSort]     = useState('recent');
  const [projectId, setProjectId] = useState(null);
  const [projects, setProjects] = useState([]);
  // selected = { custId, projectId, projectApiKey, projectCurrency } — opens the
  // shared CustomerModal which is project-scoped (it fetches per-project order
  // history), so we carry the row's project context with us.
  const [selected, setSelected] = useState(null);

  // Project list for the filter — owner-visible projects in the org.
  useEffect(() => {
    if (!orgId) return;
    fetch(`${API_BASE}/api/orgs/${orgId}/projects`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [orgId]);

  // Debounced search (matches project Customers UX — 250 ms).
  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    const id = setTimeout(() => {
      setLoading(true); setError('');
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      params.set('sort',  sort);
      if (projectId) params.set('project_id', String(projectId));
      params.set('limit', '100');
      fetch(`${API_BASE}/api/orgs/${orgId}/customers?${params}`, { credentials: 'include' })
        .then(r => {
          if (r.status === 403) {
            if (alive) { setError(t('org.customersPage.forbidden')); setItems([]); }
            throw new Error('forbidden');
          }
          if (!r.ok) throw new Error('load_failed');
          return r.json();
        })
        .then(d => { if (alive) setItems(d.items || []); })
        .catch(() => {})
        .finally(() => { if (alive) setLoading(false); });
    }, 250);
    return () => { alive = false; clearTimeout(id); };
  }, [orgId, search, sort, projectId, t]);

  return (
    <>
      <h1 className="crm-page-title">{t('org.customersPage.title')}</h1>
      <p className="po-block-hint">{t('org.customersPage.hint')}</p>

      <div className="org-toolbar">
        <div className="org-search-wrap">
          <MagnifyingGlass className="org-search-icon" />
          <input className="org-search-input" placeholder={t('org.customersPage.searchPlaceholder')}
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="org-toolbar-right">
          <ProjectFilter value={projectId} projects={projects} onChange={setProjectId} />
          <SortDropdown value={sort} options={sortOptions} onChange={setSort} />
        </div>
      </div>

      {error ? (
        <div className="crm-placeholder">{error}</div>
      ) : loading ? (
        <div className="crm-placeholder">{t('org.customersPage.loading')}</div>
      ) : items.length === 0 ? (
        <div className="crm-placeholder">{search ? t('orders.customers.emptySearch') : t('org.customersPage.empty')}</div>
      ) : (
        <div className="po-set-table">
          <div className="po-set-row po-set-row--head cust-row cust-row--org">
            <span>{t('org.customersPage.colCustomer')}</span>
            <span>{t('org.customersPage.colProject')}</span>
            <span>{t('org.customersPage.colOrders')}</span>
            <span>{t('org.customersPage.colSpent')}</span>
            <span>{t('org.customersPage.colLastOrder')}</span>
            <span />
          </div>
          {items.map(c => (
            <PoListRow key={`${c.id}-${c.project_id}`}
              className="cust-row cust-row--org cust-row--clickable"
              onClick={() => setSelected({
                custId: c.id,
                projectId: c.project_id,
                projectApiKey: c.project_api_key,
                projectCurrency: c.project_currency,
              })}>
              <span className="cust-cell-main">
                <Avatar url={c.avatar_url} name={c.name} email={c.email} />
                <span className="cust-id">
                  <span className="cust-name">
                    {c.name || t('orders.customers.guest')}
                    {c.is_guest && <span className="cust-guest">{t('orders.customers.guest')}</span>}
                  </span>
                  <span className="cust-sub">{c.email || c.phone || '—'}</span>
                </span>
              </span>
              <span className="cust-cell">
                <a className="ot-project-link"
                  href={`/project/${c.project_api_key}/customers`}
                  onClick={e => e.stopPropagation()}
                  title={t('org.customersPage.openProjectCustomers', { name: c.project_name })}>
                  <Storefront weight="duotone" />
                  <span className="ot-ellipsis">{c.project_name}</span>
                </a>
              </span>
              <span className="cust-cell">{c.order_count}</span>
              <span className="cust-cell cust-spent">{formatMoney(c.total_spent, c.project_currency, { decimals: 0 })}</span>
              <span className="cust-cell cust-muted">{fmtShort(c.last_order_at) || '—'}</span>
              <span className="cust-cell cust-chevron"><CaretRight weight="bold" /></span>
            </PoListRow>
          ))}
        </div>
      )}

      {selected && (
        <CustomerModal custId={selected.custId}
          pq={`?project_id=${selected.projectId}`}
          currency={selected.projectCurrency}
          onClose={() => setSelected(null)} />
      )}
    </>
  );
}
