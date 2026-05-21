import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trans, useTranslation } from 'react-i18next';
import {
  X, Copy, CheckCircle, BookOpen, PaperPlaneTilt, Eye, EyeSlash,
} from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { CONNECTOR_BY_TYPE } from './connectors.js';
import ConnectorIcon from './ConnectorIcon.jsx';

const ALL_EVENTS = [
  { value: 'order.created',     group: 'groupOrders'   },
  { value: 'order.paid',        group: 'groupOrders'   },
  { value: 'order.shipped',     group: 'groupOrders'   },
  { value: 'order.delivered',   group: 'groupOrders'   },
  { value: 'order.cancelled',   group: 'groupOrders'   },
  { value: 'order.returned',    group: 'groupOrders'   },
  { value: 'booking.created',   group: 'groupBookings' },
  { value: 'booking.confirmed', group: 'groupBookings' },
  { value: 'booking.completed', group: 'groupBookings' },
  { value: 'booking.cancelled', group: 'groupBookings' },
  { value: 'booking.no_show',   group: 'groupBookings' },
  { value: 'customer.created',  group: 'groupOther'    },
  { value: 'payment.received',  group: 'groupOther'    },
  { value: 'product.created',   group: 'groupOther'    },
  { value: 'product.updated',   group: 'groupOther'    },
];
const EVENTS_BY_GROUP = ALL_EVENTS.reduce((acc, e) => {
  (acc[e.group] = acc[e.group] || []).push(e); return acc;
}, {});

export default function ConnectorModal({ projectId, connectorType, existing, onClose, onSaved, onDeleted }) {
  const { t } = useTranslation();
  // Default field schema for legacy webhook/slack/discord — kept as a fallback
  // so connectors that don't declare primaryLabel still render correctly.
  const DEFAULT_PRIMARY_BY_TYPE = {
    webhook: {
      label: t('integrations.connector.defaults.webhook.label'),
      placeholder: t('integrations.connector.defaults.webhook.placeholder'),
      help: t('integrations.connector.defaults.webhook.help'),
    },
    slack: {
      label: t('integrations.connector.defaults.slack.label'),
      placeholder: t('integrations.connector.defaults.slack.placeholder'),
      help: t('integrations.connector.defaults.slack.help'),
    },
    discord: {
      label: t('integrations.connector.defaults.discord.label'),
      placeholder: t('integrations.connector.defaults.discord.placeholder'),
      help: t('integrations.connector.defaults.discord.help'),
    },
  };
  const pq = `?project_id=${projectId}`;
  const meta = CONNECTOR_BY_TYPE[connectorType] || {};
  const isEdit = !!existing;

  // Primary field — `url` column in DB. Label / placeholder / help from meta
  // (declared in connectors.js) or fall back to type-based defaults so
  // webhook/slack/discord without explicit meta still work.
  const primary = useMemo(() => {
    if (meta.primaryLabel) {
      return {
        label:       meta.primaryLabel,
        placeholder: meta.primaryPlaceholder || '',
        help:        meta.primaryHelp || '',
      };
    }
    return DEFAULT_PRIMARY_BY_TYPE[connectorType] || {
      label: t('integrations.connector.defaults.fallbackLabel'),
      placeholder: t('integrations.connector.defaults.fallbackPlaceholder'),
      help: '',
    };
  }, [meta, connectorType]);

  const configFields = meta.configFields || [];
  const isWebhookLike = ['webhook', 'slack', 'discord', 'zapier'].includes(connectorType);
  const showHmacSecret = connectorType === 'webhook';

  const [name,      setName]      = useState(existing?.name ?? meta.name ?? '');
  const [url,       setUrl]       = useState(existing?.url ?? '');
  const initialEvents = existing?.events ?? (isEdit ? [] : (meta.defaultEvents || []));
  const [allEvents, setAllEvents] = useState(
    () => !isEdit
      ? (meta.defaultEvents || []).length === 0  // new install: default to "all" only if no defaults specified
      : (existing.events || []).length === 0,
  );
  const [events,    setEvents]    = useState(initialEvents);
  const [isActive,  setIsActive]  = useState(existing?.is_active !== false);
  const [secret,    setSecret]    = useState(existing?.secret ?? '');

  // Per-config-field state — one entry per configFields[].key, seeded from
  // existing row's config dict (already masked by the backend).
  const [configState, setConfigState] = useState(() => {
    const obj = {};
    const existingCfg = existing?.config || {};
    configFields.forEach(f => { obj[f.key] = existingCfg[f.key] ?? ''; });
    return obj;
  });
  const [showSecretMap, setShowSecretMap] = useState({});

  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState('');
  const [testRes, setTestRes] = useState(null);
  const [copied,  setCopied]  = useState(false);

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const toggleEvent = (ev) => {
    setEvents(prev => prev.includes(ev) ? prev.filter(x => x !== ev) : [...prev, ev]);
  };

  const onSecretChange = (key, value) => {
    setConfigState(prev => ({ ...prev, [key]: value }));
  };

  // For API-connector types, build the merged config payload — only include
  // keys the user touched (unmodified masked values are kept by the backend
  // via _is_masked_secret detection, but sending them is fine too).
  const buildConfigPayload = () => {
    const cfg = {};
    configFields.forEach(f => { cfg[f.key] = (configState[f.key] || '').trim(); });
    // Preserve any other keys the backend already had (e.g. future extensions).
    const existingCfg = existing?.config || {};
    Object.keys(existingCfg).forEach(k => {
      if (!(k in cfg)) cfg[k] = existingCfg[k];
    });
    return cfg;
  };

  const save = async () => {
    setErr(''); setBusy(true);
    try {
      const u = url.trim();
      // Webhook-like primary field is a URL; API-connector primary is an
      // identifier (G-XXX, list_id, token) — backend enforces both shapes.
      if (!u) {
        setErr(t('integrations.connector.primaryRequired', { label: primary.label }));
        setBusy(false); return;
      }
      if (isWebhookLike && !/^https?:\/\//i.test(u)) {
        setErr(t('integrations.connector.primaryHttp', { label: primary.label }));
        setBusy(false); return;
      }
      const body = {
        name: name.trim(),
        url: u,
        events: allEvents ? [] : events,
      };
      if (configFields.length > 0) {
        body.config = buildConfigPayload();
      }
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
        setErr(j.detail || t('integrations.connector.saveFailed')); setBusy(false); return;
      }
      const data = await res.json();
      if (!isEdit && data.secret) setSecret(data.secret);
      onSaved?.(data);
    } catch (e) { setErr(String(e)); }
    setBusy(false);
  };

  const test = async () => {
    if (!isEdit) { setErr(t('integrations.connector.saveFirstThenTest')); return; }
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
    if (!confirm(t('integrations.connector.confirmDelete'))) return;
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
            <label className="auth-label">{t('integrations.connector.nameLabel')}</label>
            <input className="crm-input" value={name}
              onChange={e => setName(e.target.value)} maxLength={120}
              placeholder={meta.name} />
          </div>

          <div className="auth-field">
            <label className="auth-label">{primary.label}</label>
            <input className="crm-input" value={url}
              type={isWebhookLike ? 'url' : 'text'}
              onChange={e => setUrl(e.target.value)}
              placeholder={primary.placeholder} />
            {primary.help && <p className="auth-field-hint">{primary.help}</p>}
          </div>

          {/* Connector-specific secret/config fields */}
          {configFields.map(f => {
            const reveal = !!showSecretMap[f.key];
            const isSecret = f.secret;
            return (
              <div key={f.key} className="auth-field">
                <label className="auth-label">{f.label}</label>
                <div className={isSecret ? 'int-secret-input-wrap' : ''}>
                  <input className="crm-input" value={configState[f.key] || ''}
                    type={isSecret && !reveal ? 'password' : 'text'}
                    onChange={e => onSecretChange(f.key, e.target.value)}
                    placeholder={f.placeholder} maxLength={500} />
                  {isSecret && (
                    <button type="button" className="int-secret-reveal"
                      onClick={() => setShowSecretMap(m => ({ ...m, [f.key]: !m[f.key] }))}
                      aria-label={reveal ? t('integrations.connector.hide') : t('integrations.connector.show')}>
                      {reveal ? <EyeSlash size={14} /> : <Eye size={14} />}
                    </button>
                  )}
                </div>
                {f.help && <p className="auth-field-hint">{f.help}</p>}
              </div>
            );
          })}

          {showHmacSecret && secret && (
            <div className="auth-field">
              <label className="auth-label">{t('integrations.connector.signingSecret')}</label>
              <div className="int-secret-row">
                <code className="int-secret">{secret}</code>
                <button type="button" className="auth-btn-check int-copy-btn"
                  onClick={copySecret}>
                  {copied ? <><CheckCircle weight="fill" size={14} /> {t('integrations.connector.copied')}</>
                          : <><Copy size={14} /> {t('integrations.connector.copy')}</>}
                </button>
              </div>
              <p className="auth-field-hint">
                <Trans i18nKey="integrations.connector.signingHint"
                  components={[<code key="0" />, <code key="1" />]} />
              </p>
            </div>
          )}

          <div className="auth-sep" />

          <div className="auth-field">
            <label className="auth-toggle-row" style={{ cursor: 'pointer' }}>
              <div>
                <span className="auth-toggle-label">{t('integrations.connector.subscribeAll')}</span>
                <p className="auth-field-hint">
                  {connectorType === 'mailchimp'
                    ? t('integrations.connector.subscribeAllHintMailchimp')
                    : connectorType === 'ga4'
                    ? t('integrations.connector.subscribeAllHintGa4')
                    : t('integrations.connector.subscribeAllHintDefault')}
                </p>
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
                  <div className="int-events-group-title">{t(`integrations.connector.events.${group}`)}</div>
                  {list.map(e => (
                    <label key={e.value} className="int-event-check">
                      {/* Same square checkbox as Targets / Promo / Accounting modal —
                          unifies the CRM's checkbox look (was raw browser default). */}
                      <input type="checkbox"
                        className="cat-prod-checkbox po-include-cb"
                        checked={events.includes(e.value)}
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
                  <span className="auth-toggle-label">{t('integrations.connector.active')}</span>
                  <p className="auth-field-hint">{t('integrations.connector.activeHint')}</p>
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
              {busy ? t('integrations.connector.saving') : (isEdit ? t('integrations.connector.saveChanges') : t('integrations.connector.install'))}
            </button>
            {isEdit && (
              <button type="button" className="auth-btn-check" onClick={test} disabled={busy}>
                <PaperPlaneTilt size={14} /> {t('integrations.connector.testSend')}
              </button>
            )}
            {meta.docsUrl && (
              <a className="auth-btn-check" target="_blank" rel="noopener noreferrer"
                href={meta.docsUrl} style={{ textDecoration: 'none' }}>
                <BookOpen size={14} /> {t('integrations.connector.docs')}
              </a>
            )}
            {isEdit && (
              <button type="button" className="auth-btn-danger"
                style={{ marginLeft: 'auto' }}
                onClick={remove} disabled={busy}>
                {t('integrations.connector.delete')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
