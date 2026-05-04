import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, CheckCircle, BookOpen, PaperPlaneTilt } from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { CONNECTOR_BY_TYPE } from './connectors.js';
import ConnectorIcon from './ConnectorIcon.jsx';

// One modal handles install + edit + uninstall for every connector type.
// `connectorType` decides the layout (Slack/Discord show "webhook URL", Custom
// Webhook shows secret + signature hint, etc.). When `existing` is passed,
// modal is in edit mode.

const ALL_EVENTS = [
  { value: 'order.created',     group: 'Orders'   },
  { value: 'order.paid',        group: 'Orders'   },
  { value: 'order.shipped',     group: 'Orders'   },
  { value: 'order.delivered',   group: 'Orders'   },
  { value: 'order.cancelled',   group: 'Orders'   },
  { value: 'order.returned',    group: 'Orders'   },
  { value: 'booking.created',   group: 'Bookings' },
  { value: 'booking.confirmed', group: 'Bookings' },
  { value: 'booking.completed', group: 'Bookings' },
  { value: 'booking.cancelled', group: 'Bookings' },
  { value: 'booking.no_show',   group: 'Bookings' },
  { value: 'customer.created',  group: 'Other'    },
  { value: 'payment.received',  group: 'Other'    },
  { value: 'product.created',   group: 'Other'    },
  { value: 'product.updated',   group: 'Other'    },
];
const EVENTS_BY_GROUP = ALL_EVENTS.reduce((acc, e) => {
  (acc[e.group] = acc[e.group] || []).push(e); return acc;
}, {});

export default function ConnectorModal({ projectId, connectorType, existing, onClose, onSaved, onDeleted }) {
  const pq = `?project_id=${projectId}`;
  const meta = CONNECTOR_BY_TYPE[connectorType] || {};
  const isEdit = !!existing;

  const [name,     setName]     = useState(existing?.name ?? meta.name ?? '');
  const [url,      setUrl]      = useState(existing?.url ?? '');
  const [allEvents, setAllEvents] = useState(() => !existing || (existing.events || []).length === 0);
  const [events,   setEvents]   = useState(existing?.events ?? []);
  const [isActive, setIsActive] = useState(existing?.is_active !== false);
  const [secret,   setSecret]   = useState(existing?.secret ?? '');
  const [busy,     setBusy]     = useState(false);
  const [err,      setErr]      = useState('');
  const [testRes,  setTestRes]  = useState(null);
  const [copied,   setCopied]   = useState(false);

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const toggleEvent = (ev) => {
    setEvents(prev => prev.includes(ev) ? prev.filter(x => x !== ev) : [...prev, ev]);
  };

  const save = async () => {
    setErr(''); setBusy(true);
    try {
      const u = url.trim();
      if (!u) { setErr('URL is required'); setBusy(false); return; }
      if (!/^https?:\/\//i.test(u)) {
        setErr('URL must start with http:// or https://'); setBusy(false); return;
      }
      const body = {
        name: name.trim(),
        url: u,
        events: allEvents ? [] : events,
      };
      let res;
      if (isEdit) {
        res = await fetch(`${API_BASE}/api/integrations/${existing.id}${pq}`, {
          method: 'PUT', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, is_active: isActive }),
        });
      } else {
        res = await fetch(`${API_BASE}/api/integrations${pq}`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, type: connectorType }),
        });
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.detail || 'Save failed'); setBusy(false); return;
      }
      const data = await res.json();
      if (!isEdit && data.secret) setSecret(data.secret);
      onSaved?.(data);
    } catch (e) { setErr(String(e)); }
    setBusy(false);
  };

  const test = async () => {
    if (!isEdit) { setErr('Save the integration first, then test'); return; }
    setErr(''); setTestRes(null); setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/integrations/${existing.id}/test${pq}`, {
        method: 'POST', credentials: 'include',
      });
      const data = await res.json();
      setTestRes(data);
    } catch (e) { setErr(String(e)); }
    setBusy(false);
  };

  const remove = async () => {
    if (!isEdit) { onClose(); return; }
    if (!confirm('Delete this integration? Logs are preserved.')) return;
    setBusy(true);
    try {
      await fetch(`${API_BASE}/api/integrations/${existing.id}${pq}`, {
        method: 'DELETE', credentials: 'include',
      });
      onDeleted?.();
    } finally { setBusy(false); }
  };

  const copySecret = () => {
    if (!secret) return;
    navigator.clipboard?.writeText(secret);
    setCopied(true); setTimeout(() => setCopied(false), 1600);
  };

  const urlPlaceholder = {
    slack:   'https://hooks.slack.com/services/T0…/B0…/…',
    discord: 'https://discord.com/api/webhooks/…/…',
    webhook: 'https://your-server.com/torta-webhook',
  }[connectorType] || 'https://your-endpoint.com/hook';

  const urlHint = {
    slack:   'Get this from api.slack.com/messaging/webhooks',
    discord: 'Server Settings → Integrations → Webhooks → New Webhook',
    webhook: 'Your server should accept POST and verify X-Torta-Signature.',
  }[connectorType];

  return createPortal(
    <div className="auth-modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="auth-modal int-modal">
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div className="auth-modal-icon-wrap"><ConnectorIcon icon={meta.icon} /></div>
            <div>
              <div className="auth-modal-title">{meta.name}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">{meta.description}</span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body">
          <div className="auth-field">
            <label className="auth-label">Name (internal)</label>
            <input className="crm-input" value={name}
              onChange={e => setName(e.target.value)} maxLength={120}
              placeholder={meta.name} />
          </div>

          <div className="auth-field">
            <label className="auth-label">
              {connectorType === 'webhook' ? 'Endpoint URL' : 'Webhook URL'}
            </label>
            <input className="crm-input" value={url} type="url"
              onChange={e => setUrl(e.target.value)}
              placeholder={urlPlaceholder} />
            {urlHint && <p className="auth-field-hint">{urlHint}</p>}
          </div>

          {connectorType === 'webhook' && secret && (
            <div className="auth-field">
              <label className="auth-label">Signing secret</label>
              <div className="int-secret-row">
                <code className="int-secret">{secret}</code>
                <button type="button" className="auth-btn-check int-copy-btn"
                  onClick={copySecret}>
                  {copied ? <><CheckCircle weight="fill" size={14} /> Copied</>
                          : <><Copy size={14} /> Copy</>}
                </button>
              </div>
              <p className="auth-field-hint">
                Verify <code>X-Torta-Signature: sha256=&lt;hex&gt;</code> on every request:
                {' '}<code>HMAC-SHA256(body, secret)</code>.
              </p>
            </div>
          )}

          <div className="auth-sep" />

          <div className="auth-field">
            <label className="auth-toggle-row" style={{ cursor: 'pointer' }}>
              <div>
                <span className="auth-toggle-label">Subscribe to all events</span>
                <p className="auth-field-hint">When ON, every event from this project triggers this integration.</p>
              </div>
              <span className="auth-toggle">
                <input type="checkbox" checked={allEvents}
                  onChange={e => setAllEvents(e.target.checked)} />
                <span className="auth-toggle-track" />
              </span>
            </label>
          </div>

          {!allEvents && (
            <div className="int-events-grid">
              {Object.entries(EVENTS_BY_GROUP).map(([group, list]) => (
                <div key={group} className="int-events-group">
                  <div className="int-events-group-title">{group}</div>
                  {list.map(e => (
                    <label key={e.value} className="int-event-check">
                      <input type="checkbox" checked={events.includes(e.value)}
                        onChange={() => toggleEvent(e.value)} />
                      <span>{e.value}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}

          {isEdit && (
            <>
              <div className="auth-sep" />
              <div className="auth-toggle-row">
                <div>
                  <span className="auth-toggle-label">Active</span>
                  <p className="auth-field-hint">Pause delivery without losing config.</p>
                </div>
                <label className="auth-toggle">
                  <input type="checkbox" checked={isActive}
                    onChange={e => setIsActive(e.target.checked)} />
                  <span className="auth-toggle-track" />
                </label>
              </div>
            </>
          )}

          {testRes && (
            <div className={`int-test-result int-test-result--${testRes.status === 'success' ? 'ok' : 'err'}`}>
              <div className="int-test-status">
                {testRes.status === 'success'
                  ? <><CheckCircle weight="fill" size={14} /> {testRes.http_code} OK · {testRes.duration_ms} ms</>
                  : <>✕ {testRes.http_code || '—'} · {testRes.duration_ms} ms</>}
              </div>
              {testRes.response_body && (
                <code className="int-test-body">{testRes.response_body}</code>
              )}
            </div>
          )}

          {err && <p className="auth-msg auth-msg--err">{err}</p>}

          <div className="auth-actions">
            <button className="crm-submit-btn" onClick={save} disabled={busy} type="button">
              {busy ? 'Saving…' : (isEdit ? 'Save changes' : 'Install')}
            </button>
            {isEdit && (
              <button type="button" className="auth-btn-check" onClick={test} disabled={busy}>
                <PaperPlaneTilt size={14} /> Test send
              </button>
            )}
            {connectorType === 'webhook' && (
              <a className="auth-btn-check" target="_blank" rel="noreferrer"
                href="https://docs.tortacrm.com/webhooks" style={{ textDecoration: 'none' }}>
                <BookOpen size={14} /> Docs
              </a>
            )}
            {isEdit && (
              <button type="button" className="auth-btn-danger"
                style={{ marginLeft: 'auto' }}
                onClick={remove} disabled={busy}>
                Delete
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
