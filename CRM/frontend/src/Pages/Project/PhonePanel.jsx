import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { Eye, EyeSlash, Trash, CaretDown, ChatCircle } from '@phosphor-icons/react';
import { Icon } from '@iconify/react';
import { API_BASE } from '../../api.js';
import { DynamicBlock } from '../../Utils/DynamicBlock.js';


const SMS_PROVIDERS = [
  // ── Global ─────────────────────────────────────────────────────────────────
  {
    id: 'twilio', label: 'Twilio', region: 'Global',
    iconify: 'simple-icons:twilio', color: '#F22F46',
    fields: [
      { key: 'twilio_account_sid',         label: 'Twilio Account SID',                                  placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
      { key: 'twilio_auth_token',          label: 'Twilio Auth Token',          secret: true,            placeholder: '••••••••••••••••' },
      { key: 'twilio_message_service_sid', label: 'Twilio Message Service SID',                          placeholder: 'MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
      { key: 'twilio_content_sid',         label: 'Twilio Content SID (Optional, For WhatsApp Only)',    placeholder: 'HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', optional: true },
    ],
  },
  {
    id: 'twilio_verify', label: 'Twilio Verify', region: 'Global',
    iconify: 'simple-icons:twilio', color: '#F22F46',
    fields: [
      { key: 'twilio_account_sid',        label: 'Twilio Account SID',                          placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
      { key: 'twilio_auth_token',         label: 'Twilio Auth Token',         secret: true,     placeholder: '••••••••••••••••' },
      { key: 'twilio_verify_service_sid', label: 'Twilio Verify Service SID',                   placeholder: 'VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
    ],
  },
  {
    id: 'vonage', label: 'Vonage', region: 'Global',
    iconify: 'simple-icons:vonage', color: '#871FFF',  // brand purple — visible on white
    fields: [
      { key: 'vonage_api_key',     label: 'Vonage API Key',                  placeholder: 'abcdef12' },
      { key: 'vonage_api_secret',  label: 'Vonage API Secret', secret: true, placeholder: '••••••••••••••••' },
      { key: 'vonage_from_number', label: 'Vonage From Number',              placeholder: 'YourBrand or +447700900000' },
    ],
  },
  {
    id: 'messagebird', label: 'MessageBird', region: 'Global',
    phosphor: ChatCircle, color: '#2481D7',  // simple-icons:bird not in collection
    fields: [
      { key: 'messagebird_access_key', label: 'MessageBird Access Key', secret: true, placeholder: '••••••••••••••••' },
      { key: 'messagebird_originator', label: 'MessageBird Originator',               placeholder: 'YourBrand or +447700900000' },
    ],
  },
  {
    id: 'aws_sns', label: 'AWS SNS', region: 'Global',
    iconify: 'simple-icons:amazonwebservices', color: '#FF9900',
    fields: [
      { key: 'aws_access_key_id',     label: 'AWS Access Key ID',                       placeholder: 'AKIA...' },
      { key: 'aws_secret_access_key', label: 'AWS Secret Access Key', secret: true,     placeholder: '••••••••••••••••' },
      { key: 'aws_region',            label: 'AWS Region',                              placeholder: 'us-east-1' },
    ],
  },
  {
    id: 'plivo', label: 'Plivo', region: 'Global',
    phosphor: ChatCircle, color: '#0E76A8',  // simple-icons:plivo not in collection
    fields: [
      { key: 'plivo_auth_id',     label: 'Plivo Auth ID',                       placeholder: 'MAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
      { key: 'plivo_auth_token',  label: 'Plivo Auth Token',  secret: true,     placeholder: '••••••••••••••••' },
      { key: 'plivo_from_number', label: 'Plivo From Number',                   placeholder: '+12025551234' },
    ],
  },

  // ── Russia / CIS ───────────────────────────────────────────────────────────
  {
    id: 'smsc', label: 'SMSC.ru', region: 'Russia / CIS',
    phosphor: ChatCircle, color: '#D63031',  // generic icon (no brand in Iconify)
    fields: [
      { key: 'smsc_login',    label: 'SMSC Login',                       placeholder: 'your_login' },
      { key: 'smsc_password', label: 'SMSC Password (or API key)', secret: true, placeholder: '••••••••' },
      { key: 'smsc_sender',   label: 'Sender name (optional)',          placeholder: 'YourBrand', optional: true },
    ],
  },
  {
    id: 'sms_ru', label: 'SMS.ru', region: 'Russia / CIS',
    phosphor: ChatCircle, color: '#0066CC',
    fields: [
      { key: 'smsru_api_id', label: 'SMS.ru API ID', secret: true, placeholder: 'XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX' },
      { key: 'smsru_from',   label: 'Sender name (optional)',       placeholder: 'YourBrand', optional: true },
    ],
  },

  // ── Kazakhstan ─────────────────────────────────────────────────────────────
  {
    id: 'mobizon', label: 'Mobizon.kz', region: 'Kazakhstan',
    phosphor: ChatCircle, color: '#00B894',
    fields: [
      { key: 'mobizon_api_key', label: 'Mobizon API Key',         secret: true, placeholder: 'kz••••••••••••••••' },
      { key: 'mobizon_alpha',   label: 'Alphaname (optional)',                 placeholder: 'YourBrand', optional: true },
    ],
  },

  // ── UK / India ─────────────────────────────────────────────────────────────
  {
    id: 'textlocal', label: 'Textlocal', region: 'UK / India',
    phosphor: ChatCircle, color: '#1E73BE',  // no textlocal icon in simple-icons
    fields: [
      { key: 'textlocal_api_key', label: 'Textlocal API Key', secret: true, placeholder: '••••••••••••••••' },
      { key: 'textlocal_sender',  label: 'Textlocal Sender',                placeholder: 'TXTLCL' },
    ],
  },

  // ── Free ───────────────────────────────────────────────────────────────────
  {
    id: 'telegram_gateway', label: 'Telegram Gateway', region: 'Free',
    iconify: 'logos:telegram',
    fields: [
      { key: 'telegram_gateway_token', label: 'Telegram Gateway Access Token', secret: true, placeholder: 'AAjflKjflFJa...' },
    ],
  },
];

const findProvider = id => SMS_PROVIDERS.find(p => p.id === id) || SMS_PROVIDERS[0];

// Renders either an Iconify brand icon (with safe color tint) or a Phosphor
// fallback for providers not present in any Iconify collection.
function ProviderBrandIcon({ provider, size = 18 }) {
  if (provider.iconify) {
    return (
      <Icon icon={provider.iconify} width={size} height={size}
        style={provider.color ? { color: provider.color } : undefined} />
    );
  }
  if (provider.phosphor) {
    const PhIcon = provider.phosphor;
    return <PhIcon size={size} weight="fill" color={provider.color || 'currentColor'} />;
  }
  return null;
}

// Dropdown with Dynamic Block indicator (matches Sidebar / Header switcher pattern).
function ProviderDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(null);
  const ref = useRef(null);
  const cur = findProvider(value);

  // Track current focus key — hover wins over selection (same pattern as Sidebar).
  const currentKey = hovered ?? value;
  const { indRef, setItemRef } = DynamicBlock(open ? currentKey : null);

  useEffect(() => {
    const onDoc = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className="phone-dd" ref={ref}>
      <button type="button" className="phone-dd-trigger" onClick={() => setOpen(o => !o)}>
        <ProviderBrandIcon provider={cur} size={18} />
        <span className="phone-dd-label">{cur.label}</span>
        <CaretDown size={14} className={`phone-dd-chev${open ? ' phone-dd-chev--open' : ''}`} />
      </button>
      {open && (
        <div className="phone-dd-menu" onMouseLeave={() => setHovered(null)}>
          {/* Dynamic Block sliding indicator */}
          <div ref={indRef} className="phone-dd-indicator" />

          {SMS_PROVIDERS.map(p => (
            <button key={p.id} type="button"
              ref={setItemRef(p.id)}
              className={`phone-dd-item${p.id === value ? ' phone-dd-item--active' : ''}`}
              onMouseEnter={() => setHovered(p.id)}
              onClick={() => { onChange(p.id); setOpen(false); setHovered(null); }}>
              <ProviderBrandIcon provider={p} size={16} />
              <span className="phone-dd-item-label">{p.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Hint text per provider ───────────────────────────────────────────────────
const PROVIDER_HINT = {
  twilio:           'Send SMS via Twilio Programmable Messaging. Get your credentials at twilio.com/console.',
  twilio_verify:    'Twilio Verify is a separate service that handles OTP delivery and validation for you.',
  vonage:           'Send SMS via Vonage (formerly Nexmo). Get your credentials at dashboard.nexmo.com.',
  messagebird:      'Send SMS via MessageBird (Bird). Get your access key from dashboard.bird.com.',
  aws_sns:          'Send SMS via AWS SNS. Use a region with SMS support (us-east-1 recommended).',
  plivo:            'Send SMS via Plivo — cheaper Twilio alternative. Get credentials at console.plivo.com.',
  smsc:             'SMSC.ru — самый популярный SMS-сервис в России и СНГ. Цены от 1.5₽/SMS. smsc.ru',
  sms_ru:           'SMS.ru — российский сервис, простая регистрация, цены от 1.4₽/SMS. sms.ru',
  mobizon:          'Mobizon.kz — основной SMS-провайдер Казахстана. Цены от 4.5₸/SMS. mobizon.kz',
  textlocal:        'Send SMS via Textlocal (UK/India). Get your API key at control.textlocal.com.',
  telegram_gateway: 'Telegram Gateway — бесплатная отправка OTP через Telegram, если у пользователя есть аккаунт. gateway.telegram.org',
};

function PhonePanel({ projectId, onSaved }) {
  const pq = `?project_id=${projectId}`;

  const [data,     setData]     = useState(null);
  const [form,     setForm]     = useState(null);
  const [reveal,   setReveal]   = useState({});  // per-secret-field show flag
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err,      setErr]      = useState('');
  const [toast,    setToast]    = useState('');
  const toastTimer = useRef(null);

  const showToast = msg => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  };

  const load = async () => {
    const res = await fetch(`${API_BASE}/api/sms-settings${pq}`, { credentials: 'include' });
    const json = await res.json();
    setData(json);
    setForm(json);
  };

  useEffect(() => { load(); }, [projectId]);

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const toggleReveal = k => setReveal(r => ({ ...r, [k]: !r[k] }));

  const save = async () => {
    setSaving(true); setErr('');
    try {
      // Strip 'configured' meta-flag before sending
      const { configured, ...payload } = form;
      const res = await fetch(`${API_BASE}/api/sms-settings${pq}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (res.ok) { showToast('Saved'); onSaved?.(payload.is_enabled); await load(); }
      else        { setErr(json.detail || 'Error saving'); }
    } catch { setErr('Network error'); }
    finally { setSaving(false); }
  };

  const del = async () => {
    if (!confirm('Remove SMS settings?')) return;
    setDeleting(true);
    await fetch(`${API_BASE}/api/sms-settings${pq}`, { method: 'DELETE', credentials: 'include' });
    setDeleting(false);
    onSaved?.(false);
    await load();
  };

  if (!form) return <p className="crm-placeholder">Loading…</p>;

  const cur = findProvider(form.provider);

  return (
    <>
      {/* ── Enable toggle ── */}
      <div className="auth-toggle-row">
        <div>
          <span className="auth-toggle-label">Enable Phone provider</span>
          <p className="auth-field-hint">This will enable phone-based login for your application.</p>
        </div>
        <label className="auth-toggle">
          <input type="checkbox" checked={form.is_enabled}
            onChange={e => update('is_enabled', e.target.checked)} />
          <span className="auth-toggle-track" />
        </label>
      </div>

      <div className="auth-sep" />

      {/* ── SMS provider dropdown ── */}
      <div className="auth-field">
        <label className="auth-label">SMS provider</label>
        <p className="auth-field-hint">External provider that will handle sending SMS messages.</p>
        <ProviderDropdown value={form.provider} onChange={v => update('provider', v)} />
        <p className="auth-field-hint" style={{ marginTop: 8 }}>{PROVIDER_HINT[form.provider]}</p>
      </div>

      {/* ── Provider-specific fields ── */}
      {cur.fields.map(f => (
        <div className="auth-field" key={f.key}>
          <label className="auth-label">{f.label}</label>
          {f.secret ? (
            <div className="auth-secret-wrap">
              <input className="crm-input" type={reveal[f.key] ? 'text' : 'password'}
                placeholder={f.placeholder} value={form[f.key] || ''}
                onChange={e => update(f.key, e.target.value)}
                autoComplete="new-password" />
              <button type="button" className="auth-eye-btn" onClick={() => toggleReveal(f.key)}>
                {reveal[f.key] ? <EyeSlash size={16} /> : <Eye size={16} />}
              </button>
            </div>
          ) : (
            <input className="crm-input" placeholder={f.placeholder}
              value={form[f.key] || ''} onChange={e => update(f.key, e.target.value)}
              autoComplete="off" />
          )}
        </div>
      ))}

      <div className="auth-sep" />

      {/* ── Phone confirmations ── */}
      <div className="auth-toggle-row">
        <div>
          <span className="auth-toggle-label">Enable phone confirmations</span>
          <p className="auth-field-hint">Users will need to confirm their phone number before signing in.</p>
        </div>
        <label className="auth-toggle">
          <input type="checkbox" checked={form.enable_phone_confirmations}
            onChange={e => update('enable_phone_confirmations', e.target.checked)} />
          <span className="auth-toggle-track" />
        </label>
      </div>

      {/* ── OTP behaviour ── */}
      <div className="auth-field">
        <label className="auth-label">SMS OTP Expiry</label>
        <p className="auth-field-hint">Duration before an SMS OTP expires (30–600 seconds).</p>
        <input className="crm-input" type="number" min={30} max={600}
          value={form.otp_expiry_seconds}
          onChange={e => update('otp_expiry_seconds', parseInt(e.target.value, 10) || 60)} />
      </div>

      <div className="auth-field">
        <label className="auth-label">SMS OTP Length</label>
        <p className="auth-field-hint">Number of digits in the OTP (4–10).</p>
        <input className="crm-input" type="number" min={4} max={10}
          value={form.otp_length}
          onChange={e => update('otp_length', parseInt(e.target.value, 10) || 6)} />
      </div>

      <div className="auth-field">
        <label className="auth-label">SMS Message</label>
        <p className="auth-field-hint">
          Template for the OTP message. Use <code>{'{{ .Code }}'}</code> as the code placeholder.
        </p>
        <textarea className="crm-input phone-textarea" rows={3}
          value={form.message_template}
          onChange={e => update('message_template', e.target.value)} />
      </div>

      <div className="auth-field">
        <label className="auth-label">Test Phone Numbers and OTPs</label>
        <p className="auth-field-hint">
          Comma-separated <code>phone=otp</code> pairs that bypass the SMS provider for testing.
          Example: <code>+18005550123=789012</code>
        </p>
        <input className="crm-input" placeholder="+18005550123=789012, +77071234567=000000"
          value={form.test_phone_numbers}
          onChange={e => update('test_phone_numbers', e.target.value)} />
      </div>

      {err && <p className="auth-msg auth-msg--err">{err}</p>}

      <div className="auth-actions">
        <button className="crm-submit-btn" onClick={save} disabled={saving} type="button">
          {saving ? 'Saving…' : 'Save'}
        </button>
        {data?.configured && (
          <button className="auth-btn-danger" onClick={del} disabled={deleting} type="button">
            <Trash size={15} />
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        )}
      </div>

      {toast && createPortal(
        <div className="auth-toast">{toast}</div>,
        document.body,
      )}
    </>
  );
}

export default PhonePanel