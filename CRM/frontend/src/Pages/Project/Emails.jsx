import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Key, Lock, Receipt, CalendarCheck, ShoppingCart, Package,
  ArrowCounterClockwise,
  Plus, PaperPlaneTilt, Trash, Clock,
  MagnifyingGlass, SquaresFour, List,
  DotsThreeOutline, Pencil, PauseCircle, PlayCircle, ArrowLeft,
} from '@phosphor-icons/react';
import { API_BASE, pickError } from '../../api.js';
import HtmlEmailEditor from './HtmlEmailEditor.jsx';
import { missingRequiredVars } from '../../Utils/emailTemplateDefaults.js';
import { useOrgPlan } from '../../Utils/useOrgPlan.js';
import { PoListRow } from '../../Utils/PoListRow.jsx';
import { DateTimePicker } from '../../Utils/DateTimePicker.jsx';
import { TimePicker } from './Booking/BookingCreateModal.jsx';
import UpgradePlaque from '../../Elements/UpgradePlaque.jsx';
import '../../Style/Authentication.css';
import '../../Style/Organization.css';
import '../../Style/Products.css';
import '../../Style/Emails.css';

// `labelKey` / titles resolved via i18n (comms.emails.*) at render time.
const TYPE_TABS = [
  { key: 'verification',       Icon: Key },
  { key: 'password_reset',     Icon: Lock },
  { key: 'order_confirmation', Icon: Receipt },
  { key: 'booking_reminder',   Icon: CalendarCheck },
  { key: 'abandoned_cart',     Icon: ShoppingCart },
  { key: 'restock',            Icon: Package },
];
const EXTRA_TABS = [
  { key: '__broadcasts', Icon: PaperPlaneTilt },
];

function useToast() {
  const [msg, setMsg] = useState('');
  const timer = useRef(null);
  const show = (m) => { setMsg(m); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(''), 3200); };
  const node = msg ? createPortal(<div className="auth-toast">{msg}</div>, document.body) : null;
  return [show, node];
}

export default function Emails() {
  const { t } = useTranslation();
  const { projectId, project } = useOutletContext();
  const [active, setActive] = useState('verification');
  const tabs = [...TYPE_TABS, ...EXTRA_TABS].map(tab => ({
    ...tab, label: t(`comms.emails.tab.${tab.key === '__broadcasts' ? 'broadcasts' : tab.key}`),
  }));
  return (
    <div className="em-page">
      <TabSwitcher tabs={tabs} activeKey={active} onPick={setActive} />
      <h1 className="crm-page-title">{t(`comms.emails.title.${active === '__broadcasts' ? 'broadcasts' : active}`)}</h1>
      {active === '__broadcasts'
        ? <BroadcastsTab projectId={projectId} orgId={project?.org_id} />
        : <TemplateEditor key={active} projectId={projectId} type={active} />}
    </div>
  );
}

function TabSwitcher({ tabs, activeKey, onPick }) {
  const indRef = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);
  const curKey = hovered ?? activeKey;
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current, el = btnRefs.current[curKey];
      if (!ind || !el) return;
      ind.style.opacity = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [curKey, activeKey]);
  return (
    <div className="auth-tab-wrapper">
      <div className="auth-tab-switcher" onMouseLeave={() => setHovered(null)}>
        <div ref={indRef} className="auth-tab-indicator" />
        {tabs.map(({ key, label, Icon }) => (
          <button key={key} ref={el => { btnRefs.current[key] = el; }}
            className={`auth-tab-btn${curKey === key ? ' auth-tab-btn--active' : ''}`}
            onMouseEnter={() => setHovered(key)} onClick={() => onPick(key)} type="button">
            <Icon className="auth-tab-icon" />{label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Transactional template editor ──

function TemplateEditor({ projectId, type }) {
  const { t } = useTranslation();
  const pq = `?project_id=${projectId}`;
  const [data, setData] = useState(null);
  const [val, setVal] = useState({ subject: '', html: '' });
  const [toast, toastNode] = useToast();
  const savedRef = useRef('');

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/api/email-templates/${type}${pq}`, { credentials: 'include' })
      .then(r => r.json()).then(d => {
        if (!alive) return;
        setData(d);
        const v = { subject: d.subject || '', html: d.html || '' };
        setVal(v); savedRef.current = JSON.stringify(v);
      }).catch(() => {});
    return () => { alive = false; };
  }, [type, projectId]);

  const missing = missingRequiredVars(type, val.html, val.subject);

  // Auto-save (debounced). Pauses while a required token is missing so a broken template is never persisted.
  useEffect(() => {
    if (!data) return;
    const cur = JSON.stringify(val);
    if (cur === savedRef.current || missing.length) return;
    const timer = setTimeout(async () => {
      const r = await fetch(`${API_BASE}/api/email-templates/${type}${pq}`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: val.subject, html: val.html }),
      });
      if (r.ok) { savedRef.current = cur; setData(x => (x && !x.is_customized ? { ...x, is_customized: true } : x)); }
    }, 700);
    return () => clearTimeout(timer);
  }, [val, missing.length, data, type, projectId]);

  const reset = async () => {
    if (!window.confirm(t('comms.emails.resetConfirm'))) return;
    const r = await fetch(`${API_BASE}/api/email-templates/${type}/reset${pq}`, { method: 'POST', credentials: 'include' });
    const d = await r.json();
    if (r.ok) {
      const v = { subject: d.subject || '', html: d.html || '' };
      setVal(v); savedRef.current = JSON.stringify(v);
      setData(x => ({ ...x, is_customized: false })); toast(t('comms.emails.resetDone'));
    }
  };

  if (!data) return <div className="em-loading">{t('common.loading')}</div>;
  return (
    <div className="em-tab">
      <HtmlEmailEditor emailType={type} subject={val.subject} html={val.html} projectId={projectId}
        onChange={(next) => setVal(v => ({ ...v, ...next }))}
        headerRight={data.is_customized
          ? <button type="button" className="em-btn-ghost em-btn-danger" onClick={reset}>
              <ArrowCounterClockwise /> {t('comms.emails.resetToDefault')}
            </button>
          : null} />
      {toastNode}
    </div>
  );
}

// ── Broadcasts tab ──

function BroadcastsTab({ projectId, orgId }) {
  const { t } = useTranslation();
  const { isFree, loading: planLoading } = useOrgPlan(orgId);
  const pq = `?project_id=${projectId}`;
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');
  const [view, setView] = useState(() => {
    try { return localStorage.getItem('crm_broadcast_view') === 'grid' ? 'grid' : 'list'; } catch { return 'list'; }
  });
  const [viewHover, setViewHover] = useState(null);
  const setViewPref = (v) => { setView(v); try { localStorage.setItem('crm_broadcast_view', v); } catch {} };
  const curView = viewHover ?? view;
  const [toast, toastNode] = useToast();
  const load = () => fetch(`${API_BASE}/api/email-campaigns${pq}`, { credentials: 'include' })
    .then(r => r.json()).then(d => setList(d.items || [])).catch(() => setList([]));
  useEffect(() => { load(); }, [projectId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list || [];
    return (list || []).filter(c =>
      (c.name || '').toLowerCase().includes(q) || (c.subject || '').toLowerCase().includes(q));
  }, [list, search]);

  const openOne = async (id) => {
    const r = await fetch(`${API_BASE}/api/email-campaigns/${id}${pq}`, { credentials: 'include' });
    const d = await r.json(); if (r.ok) setEditing(d);
  };
  const create = async () => {
    const r = await fetch(`${API_BASE}/api/email-campaigns${pq}`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      // No starter body — the HTML editor seeds the default broadcast template on open.
      body: JSON.stringify({ name: t('comms.emails.newCampaign'), subject: '', html: '' }),
    });
    const d = await r.json();
    if (r.ok) { await load(); openOne(d.id); }
  };
  const del = async (c) => {
    if (!window.confirm(t('comms.emails.deleteConfirm'))) return;
    await fetch(`${API_BASE}/api/email-campaigns/${c.id}${pq}`, { method: 'DELETE', credentials: 'include' });
    load();
  };
  const pause = async (c) => {
    await fetch(`${API_BASE}/api/email-campaigns/${c.id}/pause${pq}`, { method: 'POST', credentials: 'include' });
    load();
  };
  const resume = async (c) => {
    await fetch(`${API_BASE}/api/email-campaigns/${c.id}/resume${pq}`, { method: 'POST', credentials: 'include' });
    load();
  };
  const rowProps = (c) => ({
    onOpen: () => openOne(c.id), onDelete: () => del(c), onPause: () => pause(c), onResume: () => resume(c),
  });

  // Email broadcasts are a paid feature — Free orgs get the upgrade plaque.
  if (orgId && !planLoading && isFree)
    return <UpgradePlaque featureName={t('comms.emails.tab.broadcasts', { defaultValue: 'email broadcasts' })} />;
  if (editing) return <CampaignEditor projectId={projectId} campaign={editing} onClose={() => { setEditing(null); load(); }} toast={toast} toastNode={toastNode} />;
  if (!list) return <div className="em-loading">{t('common.loading')}</div>;
  return (
    // No .em-tab wrapper here — the org-toolbar's own padding handles spacing
    // (mirrors Targets), so we don't double up margin/gap.
    <>
      {/* Toolbar mirrors Targets: search (300px, left) · view toggle + New (pushed right). */}
      <div className="org-toolbar">
        <div className="org-search-wrap">
          <MagnifyingGlass className="org-search-icon" />
          <input className="org-search-input" placeholder={t('comms.emails.searchPlaceholder')}
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="org-view-toggle" onMouseLeave={() => setViewHover(null)}>
          <div className="org-view-indicator" style={{ transform: `translateX(${curView === 'list' ? 30 : 0}px)` }} />
          <button type="button" className={`org-view-btn${curView === 'grid' ? ' org-view-btn--current' : ''}`}
            onClick={() => setViewPref('grid')} onMouseEnter={() => setViewHover('grid')}
            title={t('comms.emails.gridView')}>
            <SquaresFour className="org-view-icon" />
          </button>
          <button type="button" className={`org-view-btn${curView === 'list' ? ' org-view-btn--current' : ''}`}
            onClick={() => setViewPref('list')} onMouseEnter={() => setViewHover('list')}
            title={t('comms.emails.listView')}>
            <List className="org-view-icon" />
          </button>
        </div>

        <button type="button" className="org-new-btn" onClick={create}>
          <Plus className="org-new-icon" /> {t('comms.emails.newCampaign')}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="crm-placeholder">
          {search ? t('comms.emails.noCampaignsFound') : t('comms.emails.noCampaigns')}
        </div>
      ) : view === 'grid' ? (
        <div className="em-cc-grid">
          {filtered.map(c => <CampaignCard key={c.id} c={c} {...rowProps(c)} />)}
        </div>
      ) : (
        <div className="po-set-table">
          <div className="po-set-row po-set-row--head po-set-row--campaign">
            <span>{t('comms.emails.colName')}</span>
            <span>{t('comms.emails.colSubject')}</span>
            <span>{t('comms.emails.colSchedule')}</span>
            <span>{t('comms.emails.colSent')}</span>
            <span>{t('comms.emails.colStatus')}</span>
            <span />
          </div>
          {filtered.map(c => <CampaignRow key={c.id} c={c} {...rowProps(c)} />)}
        </div>
      )}
      {toastNode}
    </>
  );
}

const SCHED_KEY = { now: 'draftSendNow', scheduled: 'oneTime', recurring: 'weekly' };

// Row/card three-dot menu — Edit · Pause/Resume (scheduled only) · Delete.
// Mirrors Targets' TargetMenu (portal dropdown, closes on Escape / outside click).
function CampaignMenu({ btnRef, status, onClose, onEdit, onDelete, onPause, onResume }) {
  const { t } = useTranslation();
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: Math.max(8, r.right - 184) });
    }
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const onPd  = (e) => {
      if (!e.target.closest?.('.org-card-dropdown') && !btnRef.current?.contains(e.target)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPd);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPd); };
  }, [btnRef, onClose]);
  if (!pos) return null;
  const canPause  = status === 'scheduled' || status === 'blocked';
  const canResume = status === 'paused';
  return createPortal(
    <div className="org-card-dropdown" style={{ top: pos.top, left: pos.left }}
      onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <button className="org-card-dropdown-item" onClick={() => { onClose(); onEdit(); }}>
        <Pencil className="org-card-dropdown-icon" /> {t('comms.emails.edit')}
      </button>
      {canPause && (
        <button className="org-card-dropdown-item" onClick={() => { onClose(); onPause(); }}>
          <PauseCircle className="org-card-dropdown-icon" /> {t('comms.emails.pause')}
        </button>
      )}
      {canResume && (
        <button className="org-card-dropdown-item" onClick={() => { onClose(); onResume(); }}>
          <PlayCircle className="org-card-dropdown-icon" /> {t('comms.emails.resume')}
        </button>
      )}
      <div className="org-card-dropdown-sep" />
      <button className="org-card-dropdown-item org-card-dropdown-item--danger" onClick={() => { onClose(); onDelete(); }}>
        <Trash className="org-card-dropdown-icon" /> {t('common.delete')}
      </button>
    </div>,
    document.body,
  );
}

// Broadcast list row — InteractiveSection tilt row (mirrors Targets / po-set-table).
function CampaignRow({ c, onOpen, onDelete, onPause, onResume }) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef(null);
  return (
    <PoListRow className="po-set-row--campaign" frozen={menuOpen} onClick={onOpen} style={{ cursor: 'pointer' }}>
      <span className="po-set-strong" style={{ minWidth: 0 }}>
        <span className="em-ell">{c.name || t('comms.emails.untitled')}</span>
      </span>
      <span className="po-set-note em-ell">{c.subject || t('comms.emails.noSubject')}</span>
      <span>{t(`comms.emails.${SCHED_KEY[c.schedule_type] || 'draftSendNow'}`)}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
        {c.total_count > 0 ? `${c.sent_count} / ${c.total_count}` : '—'}
      </span>
      <span>
        <span className={`em-status em-status--${c.status}`}>
          {t(`comms.emails.status.${c.status}`, { defaultValue: c.status })}
        </span>
      </span>
      <button ref={menuBtnRef} type="button" className="org-list-menu-btn" aria-label={t('comms.emails.options')}
        onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}>
        <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
      </button>
      {menuOpen && (
        <CampaignMenu btnRef={menuBtnRef} status={c.status} onClose={() => setMenuOpen(false)}
          onEdit={onOpen} onDelete={onDelete} onPause={onPause} onResume={onResume} />
      )}
    </PoListRow>
  );
}

// Broadcast grid card — visual variant for the grid view (hover lift, like Targets cards).
function CampaignCard({ c, onOpen, onDelete, onPause, onResume }) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef(null);
  return (
    <div className="em-cc" onClick={onOpen}>
      <div className="em-cc-head">
        <div className="em-cc-icon"><PaperPlaneTilt weight="duotone" /></div>
        <div className="em-cc-titles">
          <div className="em-cc-name em-ell">{c.name || t('comms.emails.untitled')}</div>
          <div className="em-cc-sub em-ell">{c.subject || t('comms.emails.noSubject')}</div>
        </div>
        <div className="em-cc-actions" onClick={(e) => e.stopPropagation()}>
          <span className={`em-status em-status--${c.status}`}>
            {t(`comms.emails.status.${c.status}`, { defaultValue: c.status })}
          </span>
          <button ref={menuBtnRef} type="button" className="org-list-menu-btn" aria-label={t('comms.emails.options')}
            onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}>
            <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
          </button>
          {menuOpen && (
            <CampaignMenu btnRef={menuBtnRef} status={c.status} onClose={() => setMenuOpen(false)}
              onEdit={onOpen} onDelete={onDelete} onPause={onPause} onResume={onResume} />
          )}
        </div>
      </div>
      <div className="em-cc-foot">
        <span>{t(`comms.emails.${SCHED_KEY[c.schedule_type] || 'draftSendNow'}`)}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {c.total_count > 0 ? `${c.sent_count} / ${c.total_count}` : '—'}
        </span>
      </div>
    </div>
  );
}

const DOW = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// scheduled_at lives as UTC in the DB but the picker shows a naive browser-local
// wall-clock. Convert at the boundaries so "12:30" stays "12:30" (and fires at
// 12:30 local) instead of drifting by the UTC offset on reload.
const utcToLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).slice(0, 16);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const localInputToUtc = (s) => {
  if (!s) return null;
  const d = new Date(s);   // naive "YYYY-MM-DDTHH:MM" → parsed as browser-local
  return isNaN(d.getTime()) ? s : d.toISOString().replace(/\.\d{3}Z$/, 'Z');
};

// Delivery modes (tabbar). `individual` is a one-off send (no schedule_type).
const MODE_TO_SCHED = { everyone: 'now', once: 'scheduled', weekly: 'recurring' };
const SCHED_TO_MODE = { now: 'everyone', scheduled: 'once', recurring: 'weekly' };
const MODES = [
  { key: 'individual', label: 'comms.emails.modeIndividual' },
  { key: 'everyone',   label: 'comms.emails.modeEveryone' },
  { key: 'once',       label: 'comms.emails.oneTime' },
  { key: 'weekly',     label: 'comms.emails.weekly' },
];

// Mode tabbar — reuses the Targets SortToggle look (org-sort-toggle) with the
// sliding indicator that follows hover, falling back to the active mode.
function ModeTabs({ mode, onPick }) {
  const { t } = useTranslation();
  const indRef = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);
  const cur = hovered ?? mode;
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current, el = btnRefs.current[cur];
      if (!ind || !el) return;
      ind.style.opacity = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [cur, mode]);
  return (
    <div className="org-sort-toggle em-modes" onMouseLeave={() => setHovered(null)}>
      <div ref={indRef} className="org-sort-indicator" />
      {MODES.map(({ key, label }) => (
        <button key={key} ref={el => { btnRefs.current[key] = el; }}
          className={`org-sort-btn${cur === key ? ' org-sort-btn--current' : ''}`}
          onMouseEnter={() => setHovered(key)} onClick={() => onPick(key)} type="button">
          {t(label)}
        </button>
      ))}
    </div>
  );
}

// Weekly day multi-select — toggle pills (Mon–Sun); pick several. The broadcast
// sends on every selected day at the chosen time. `value` is a sorted int array
// (0=Mon..6=Sun).
function DayMultiToggle({ value, onChange }) {
  const { t } = useTranslation();
  const sel = new Set(value || []);
  const toggle = (i) => {
    const next = new Set(sel);
    if (next.has(i)) next.delete(i); else next.add(i);
    onChange([...next].sort((a, b) => a - b));
  };
  return (
    <div className="em-days" role="group">
      {DOW.map((d, i) => (
        <button key={i} type="button" aria-pressed={sel.has(i)}
          className={`em-day-btn${sel.has(i) ? ' em-day-btn--on' : ''}`}
          onClick={() => toggle(i)}>
          {t(`comms.emails.dow.${d}`)}
        </button>
      ))}
    </div>
  );
}

function CampaignEditor({ projectId, campaign, onClose, toast, toastNode }) {
  const { t } = useTranslation();
  const pq = `?project_id=${projectId}`;
  const [c, setC] = useState(() => {
    // Migrate a legacy single weekday into the multi-day list so the toggle is
    // purely controlled by recur_dows.
    const init = { ...campaign };
    if ((!init.recur_dows || !init.recur_dows.length) && init.recur_dow != null) init.recur_dows = [init.recur_dow];
    if (!Array.isArray(init.recur_dows)) init.recur_dows = [];
    init.scheduled_at = utcToLocalInput(campaign.scheduled_at);   // UTC → naive local for the picker
    return init;
  });
  const [val, setVal] = useState({ subject: campaign.subject || '', html: campaign.html || '' });
  const [testEmail, setTestEmail] = useState('');
  const [mode, setMode] = useState(SCHED_TO_MODE[campaign.schedule_type] || 'everyone');
  const set = (k, v) => setC(x => ({ ...x, [k]: v }));
  // Picking a delivery mode also maps it onto schedule_type (individual is a
  // side-action — a one-off send — so it leaves schedule_type alone).
  const pickMode = (m) => { setMode(m); if (MODE_TO_SCHED[m]) set('schedule_type', MODE_TO_SCHED[m]); };

  const snapOf = () => JSON.stringify({
    name: c.name, subject: val.subject, html: val.html, schedule_type: c.schedule_type,
    scheduled_at: c.scheduled_at, recur_dows: c.recur_dows, recur_time: c.recur_time,
    exclude_guests: c.exclude_guests, repeat_annually: c.repeat_annually,
  });
  const savedRef  = useRef(null);
  const saveTimer = useRef(null);

  const save = async (extra = {}) => {
    const body = {
      name: c.name, subject: val.subject, html: val.html,
      schedule_type: c.schedule_type, scheduled_at: localInputToUtc(c.scheduled_at),
      recur_dows: c.recur_dows ?? [], recur_time: c.recur_time,
      exclude_guests: c.exclude_guests, repeat_annually: c.repeat_annually ?? false, ...extra,
    };
    const r = await fetch(`${API_BASE}/api/email-campaigns/${c.id}${pq}`, {
      method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) { alert(pickError(d)); return false; }
    return true;
  };

  // Auto-save (debounced) — persists the draft silently; the Save button is gone.
  useEffect(() => {
    const snap = snapOf();
    if (savedRef.current === null) { savedRef.current = snap; return; }  // skip initial mount
    if (snap === savedRef.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => { if (await save({ as_draft: true })) savedRef.current = snap; }, 700);
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, val]);

  // Explicit actions cancel the pending draft auto-save and stamp savedRef so it
  // doesn't immediately revert the committed status.
  const commit = async (extra) => { clearTimeout(saveTimer.current); const ok = await save(extra); if (ok) savedRef.current = snapOf(); return ok; };
  const schedule = async () => { if (await commit()) toast(t('comms.emails.scheduled')); };
  const sendNow = async () => {
    if (!await commit({ schedule_type: 'now' })) return;
    const r = await fetch(`${API_BASE}/api/email-campaigns/${c.id}/send-now${pq}`, { method: 'POST', credentials: 'include' });
    if (r.ok) toast(t('comms.emails.sendingToAll')); else alert(pickError(await r.json()));
  };
  const test = async () => {
    if (!testEmail) return;
    await commit({ as_draft: true });
    const r = await fetch(`${API_BASE}/api/email-campaigns/${c.id}/test${pq}&email=${encodeURIComponent(testEmail)}`, { method: 'POST', credentials: 'include' });
    if (r.ok) toast(t('comms.emails.testSent')); else alert(pickError(await r.json()));
  };
  return (
    <div className="em-tab">
      {/* One-line bar: ← Back · campaign name (fills). Auto-saves as you type —
          no Save button. Delete lives in the campaign list's row menu. */}
      <div className="em-camp-bar">
        <button type="button" className="em-btn-ghost em-back-btn" onClick={onClose}>
          <ArrowLeft /> {t('comms.emails.back')}
        </button>
        <input className="em-camp-name-input" value={c.name || ''} onChange={(e) => set('name', e.target.value)}
          placeholder={t('comms.emails.campaignName')} />
      </div>

      {/* Delivery mode + controls — separate pill blocks on one line (like the
          Verification-code bar), not a card. Blue action button (≈ New campaign). */}
      <div className="em-sched">
        <ModeTabs mode={mode} onPick={pickMode} />
        {mode === 'individual' && <>
          <input className="crm-input em-sched-email" placeholder={t('comms.emails.recipientPlaceholder')}
            value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
          <div className="em-bar-spacer" />
          <button type="button" className="org-new-btn" onClick={test} disabled={!testEmail}>
            <PaperPlaneTilt className="org-new-icon" /> {t('comms.emails.send')}
          </button>
        </>}
        {mode === 'everyone' && <>
          <label className="em-check"><input type="checkbox" className="em-cb" checked={c.exclude_guests ?? true}
            onChange={(e) => set('exclude_guests', e.target.checked)} /> {t('comms.emails.excludeGuests')}</label>
          <div className="em-bar-spacer" />
          <button type="button" className="org-new-btn" onClick={sendNow}>
            <PaperPlaneTilt className="org-new-icon" /> {t('comms.emails.sendToAll')}
          </button>
        </>}
        {mode === 'once' && <>
          <DateTimePicker value={c.scheduled_at || ''} onChange={(v) => set('scheduled_at', v)} />
          <label className="em-check"><input type="checkbox" className="em-cb" checked={c.repeat_annually ?? false}
            onChange={(e) => set('repeat_annually', e.target.checked)} /> {t('comms.emails.repeatYearly')}</label>
          <label className="em-check"><input type="checkbox" className="em-cb" checked={c.exclude_guests ?? true}
            onChange={(e) => set('exclude_guests', e.target.checked)} /> {t('comms.emails.excludeGuests')}</label>
          <div className="em-bar-spacer" />
          <button type="button" className="org-new-btn" onClick={schedule}><Clock className="org-new-icon" /> {t('comms.emails.schedule')}</button>
        </>}
        {mode === 'weekly' && <>
          <DayMultiToggle value={c.recur_dows} onChange={(days) => set('recur_dows', days)} />
          <TimePicker value={c.recur_time || '09:00'} onChange={(v) => set('recur_time', v)} slotInterval={15} />
          <label className="em-check"><input type="checkbox" className="em-cb" checked={c.exclude_guests ?? true}
            onChange={(e) => set('exclude_guests', e.target.checked)} /> {t('comms.emails.excludeGuests')}</label>
          <div className="em-bar-spacer" />
          <button type="button" className="org-new-btn" onClick={schedule}><Clock className="org-new-icon" /> {t('comms.emails.schedule')}</button>
        </>}
      </div>

      <HtmlEmailEditor emailType="__broadcast" subject={val.subject} html={val.html} projectId={projectId}
        onChange={(next) => setVal(v => ({ ...v, ...next }))} />
      {toastNode}
    </div>
  );
}
