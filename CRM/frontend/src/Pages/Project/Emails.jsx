import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import {
  Key, Lock, Receipt, CalendarCheck, ShoppingCart, Package,
  FloppyDisk, ArrowCounterClockwise, Warning,
  Plus, PaperPlaneTilt, Trash, Clock,
} from '@phosphor-icons/react';
import { API_BASE, pickError } from '../../api.js';
import EmailEditor from './EmailEditor.jsx';
import '../../Style/Authentication.css';
import '../../Style/Emails.css';

const TYPE_TABS = [
  { key: 'verification',       label: 'Verification',   Icon: Key },
  { key: 'password_reset',     label: 'Password reset', Icon: Lock },
  { key: 'order_confirmation', label: 'Order',          Icon: Receipt },
  { key: 'booking_reminder',   label: 'Booking',        Icon: CalendarCheck },
  { key: 'abandoned_cart',     label: 'Abandoned cart', Icon: ShoppingCart },
  { key: 'restock',            label: 'Restock',        Icon: Package },
];
const EXTRA_TABS = [
  { key: '__broadcasts', label: 'Broadcasts', Icon: PaperPlaneTilt },
];

const TITLE_BY_KEY = {
  verification: 'Verification code', password_reset: 'Password reset',
  order_confirmation: 'Order confirmation', booking_reminder: 'Booking reminder',
  abandoned_cart: 'Abandoned cart', restock: 'Restock',
  __broadcasts: 'Broadcasts',
};

function useToast() {
  const [msg, setMsg] = useState('');
  const timer = useRef(null);
  const show = (m) => { setMsg(m); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(''), 3200); };
  const node = msg ? createPortal(<div className="auth-toast">{msg}</div>, document.body) : null;
  return [show, node];
}

// Client-side mirror of backend template_has_required — collects {{vars}} + implicit dynamic-block vars.
function findVars(subject, blocks) {
  const set = new Set();
  const scan = (s) => { const r = /\{\{\s*([\w.]+)\s*\}\}/g; let m; while ((m = r.exec(String(s || '')))) set.add(m[1]); };
  scan(subject);
  for (const b of (blocks || [])) {
    const p = b.props || {};
    ['text', 'url', 'src', 'alt'].forEach(k => scan(p[k]));
    if (b.type === 'code') set.add('code');
    if (b.type === 'order_summary') set.add('order');
  }
  return set;
}

export default function Emails() {
  const { projectId } = useOutletContext();
  const [active, setActive] = useState('verification');
  const tabs = [...TYPE_TABS, ...EXTRA_TABS];
  return (
    <div className="em-page">
      <TabSwitcher tabs={tabs} activeKey={active} onPick={setActive} />
      <h1 className="crm-page-title">{TITLE_BY_KEY[active] || 'Emails'}</h1>
      {active === '__broadcasts'
        ? <BroadcastsTab projectId={projectId} />
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
  const pq = `?project_id=${projectId}`;
  const [data, setData] = useState(null);
  const [val, setVal] = useState({ subject: '', blocks: [] });
  const [toast, toastNode] = useToast();
  const savedRef = useRef('');

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/api/email-templates/${type}${pq}`, { credentials: 'include' })
      .then(r => r.json()).then(d => {
        if (!alive) return;
        setData(d);
        const v = { subject: d.subject || '', blocks: d.blocks || [] };
        setVal(v); savedRef.current = JSON.stringify(v);
      }).catch(() => {});
    return () => { alive = false; };
  }, [type, projectId]);

  const missing = data ? (data.required_vars || []).filter(v => !findVars(val.subject, val.blocks).has(v)) : [];

  // Auto-save (debounced). Pauses while a required variable is missing so a broken template is never persisted.
  useEffect(() => {
    if (!data) return;
    const cur = JSON.stringify(val);
    if (cur === savedRef.current || missing.length) return;
    const t = setTimeout(async () => {
      const r = await fetch(`${API_BASE}/api/email-templates/${type}${pq}`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: val.subject, blocks: val.blocks }),
      });
      if (r.ok) { savedRef.current = cur; setData(x => (x && !x.is_customized ? { ...x, is_customized: true } : x)); }
    }, 700);
    return () => clearTimeout(t);
  }, [val, missing.length, data, type, projectId]);

  const reset = async () => {
    if (!window.confirm('Reset this email to the default design?')) return;
    const r = await fetch(`${API_BASE}/api/email-templates/${type}/reset${pq}`, { method: 'POST', credentials: 'include' });
    const d = await r.json();
    if (r.ok) {
      const v = { subject: d.subject || '', blocks: d.blocks || [] };
      setVal(v); savedRef.current = JSON.stringify(v);
      setData(x => ({ ...x, is_customized: false })); toast('Reset to default');
    }
  };

  if (!data) return <div className="em-loading">Loading…</div>;
  return (
    <div className="em-tab">
      {missing.length > 0 && (
        <div className="em-required-warn"><Warning /> This email must include {missing.map(m => `{{${m}}}`).join(', ')} — changes won't save until you add it back.</div>
      )}
      <EmailEditor projectId={projectId} previewType={type} subject={val.subject} blocks={val.blocks} onChange={setVal}
        headerRight={data.is_customized
          ? <button type="button" className="em-btn-ghost em-btn-danger" onClick={reset}><ArrowCounterClockwise /> Reset to default</button>
          : null} />
      {toastNode}
    </div>
  );
}

// ── Broadcasts tab ──

function BroadcastsTab({ projectId }) {
  const pq = `?project_id=${projectId}`;
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
  const [toast, toastNode] = useToast();
  const load = () => fetch(`${API_BASE}/api/email-campaigns${pq}`, { credentials: 'include' })
    .then(r => r.json()).then(d => setList(d.items || [])).catch(() => setList([]));
  useEffect(() => { load(); }, [projectId]);

  const openOne = async (id) => {
    const r = await fetch(`${API_BASE}/api/email-campaigns/${id}${pq}`, { credentials: 'include' });
    const d = await r.json(); if (r.ok) setEditing(d);
  };
  const create = async () => {
    const r = await fetch(`${API_BASE}/api/email-campaigns${pq}`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'New campaign', subject: '',
        blocks: [{ type: 'heading', props: { text: 'Hello {{customer_name}}', align: 'left' } },
                 { type: 'text', props: { text: 'Write your announcement here…' } }],
      }),
    });
    const d = await r.json();
    if (r.ok) { await load(); openOne(d.id); }
  };

  if (editing) return <CampaignEditor projectId={projectId} campaign={editing} onClose={() => { setEditing(null); load(); }} toast={toast} toastNode={toastNode} />;
  if (!list) return <div className="em-loading">Loading…</div>;
  return (
    <div className="em-tab">
      <div className="em-toolbar">
        <span className="em-status-line">Send a campaign to all your customers — now or on a schedule.</span>
        <button type="button" className="crm-add-btn" onClick={create}><Plus className="crm-add-btn-icon" /> New campaign</button>
      </div>
      <div className="em-camp-list">
        {list.length === 0 && <div className="em-empty">No campaigns yet. Create your first broadcast.</div>}
        {list.map(c => (
          <button key={c.id} type="button" className="em-camp-row" onClick={() => openOne(c.id)}>
            <div className="em-camp-main">
              <div className="em-camp-name">{c.name || 'Untitled'}</div>
              <div className="em-camp-sub">{c.subject || 'No subject'}</div>
            </div>
            {c.total_count > 0 && <span className="em-camp-sent">{c.sent_count}/{c.total_count} sent</span>}
            <span className={`em-status em-status--${c.status}`}>{c.status}</span>
          </button>
        ))}
      </div>
      {toastNode}
    </div>
  );
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function CampaignEditor({ projectId, campaign, onClose, toast, toastNode }) {
  const pq = `?project_id=${projectId}`;
  const [c, setC] = useState(campaign);
  const [val, setVal] = useState({ subject: campaign.subject || '', blocks: campaign.blocks || [] });
  const [testEmail, setTestEmail] = useState('');
  const set = (k, v) => setC(x => ({ ...x, [k]: v }));

  const save = async (extra = {}) => {
    const body = {
      name: c.name, subject: val.subject, blocks: val.blocks,
      schedule_type: c.schedule_type, scheduled_at: c.scheduled_at, recur_dow: c.recur_dow,
      recur_time: c.recur_time, exclude_guests: c.exclude_guests, ...extra,
    };
    const r = await fetch(`${API_BASE}/api/email-campaigns/${c.id}${pq}`, {
      method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) { alert(pickError(d)); return false; }
    return true;
  };
  const saveDraft = async () => { if (await save({ schedule_type: 'now' })) toast('Saved'); };
  const schedule = async () => { if (await save()) toast('Scheduled'); };
  const sendNow = async () => {
    if (!await save({ schedule_type: 'now' })) return;
    const r = await fetch(`${API_BASE}/api/email-campaigns/${c.id}/send-now${pq}`, { method: 'POST', credentials: 'include' });
    if (r.ok) toast('Sending to all customers…'); else alert(pickError(await r.json()));
  };
  const test = async () => {
    if (!testEmail) return;
    await save({ schedule_type: 'now' });
    const r = await fetch(`${API_BASE}/api/email-campaigns/${c.id}/test${pq}&email=${encodeURIComponent(testEmail)}`, { method: 'POST', credentials: 'include' });
    if (r.ok) toast('Test sent'); else alert(pickError(await r.json()));
  };
  const del = async () => {
    if (!window.confirm('Delete this campaign?')) return;
    await fetch(`${API_BASE}/api/email-campaigns/${c.id}${pq}`, { method: 'DELETE', credentials: 'include' });
    onClose();
  };

  const recurring = c.schedule_type === 'recurring';
  const scheduled = c.schedule_type === 'scheduled';
  return (
    <div className="em-tab">
      <div className="em-toolbar">
        <input className="crm-input em-camp-name-input" value={c.name || ''} onChange={(e) => set('name', e.target.value)} placeholder="Campaign name" />
        <div className="em-actions">
          <button type="button" className="em-btn-ghost" onClick={onClose}>Back</button>
          <button type="button" className="em-btn-ghost em-btn-danger" onClick={del}><Trash /> Delete</button>
          <button type="button" className="crm-add-btn" onClick={saveDraft}><FloppyDisk className="crm-add-btn-icon" /> Save</button>
        </div>
      </div>

      <div className="em-camp-schedule">
        <div className="em-seg">
          {[['now', 'Draft / send now'], ['scheduled', 'One-time'], ['recurring', 'Weekly']].map(([s, lbl]) => (
            <button key={s} type="button" className={`em-seg-btn${(c.schedule_type || 'now') === s ? ' em-on' : ''}`} onClick={() => set('schedule_type', s)}>{lbl}</button>
          ))}
        </div>
        {scheduled && <input type="datetime-local" className="crm-input" value={(c.scheduled_at || '').slice(0, 16)} onChange={(e) => set('scheduled_at', e.target.value)} />}
        {recurring && <>
          <select className="crm-input" value={c.recur_dow ?? 0} onChange={(e) => set('recur_dow', Number(e.target.value))}>
            {DOW.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
          <input type="time" className="crm-input" value={c.recur_time || '09:00'} onChange={(e) => set('recur_time', e.target.value)} />
        </>}
        <label className="em-check"><input type="checkbox" checked={c.exclude_guests ?? true} onChange={(e) => set('exclude_guests', e.target.checked)} /> Exclude guests</label>
        <div className="em-bar-spacer" />
        {(scheduled || recurring)
          ? <button type="button" className="crm-submit-btn" onClick={schedule}><Clock /> Schedule</button>
          : <button type="button" className="crm-submit-btn" onClick={sendNow}><PaperPlaneTilt /> Send to all</button>}
      </div>

      <div className="em-camp-test">
        <input className="crm-input" placeholder="Send a test to you@example.com" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
        <button type="button" className="auth-btn-check" onClick={test}>Send test</button>
      </div>

      <EmailEditor projectId={projectId} previewType="" subject={val.subject} blocks={val.blocks} onChange={setVal} />
      {toastNode}
    </div>
  );
}
