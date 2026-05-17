import { useEffect, useRef, useState, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { GearSix, FileText, Warning, UploadSimple, Stack, Barcode } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import '../../Style/Authentication.css';
import '../../Style/Booking.css';
import '../../Style/Products.css';
import '../../Style/Integrations.css';

// ─── Tabs (mirror of Authentication.jsx) ───────────────────────────────

function TabSwitcher({ tab, setTab }) {
  const indRef = useRef(null);
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
    { key: 'general',   label: 'General',     Icon: GearSix  },
    { key: 'inventory', label: 'Inventory',   Icon: Stack    },
    { key: 'barcode',   label: 'Barcode defaults', Icon: Barcode },
    { key: 'documents', label: 'Documents',   Icon: FileText },
    { key: 'danger',    label: 'Danger Zone', Icon: Warning  },
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

// ─── Documents tab ─────────────────────────────────────────────────────

const STYLE_OPTIONS = [
  { key: 'modern',  label: 'Modern',  hint: 'Coloured banner + accent stripes (default).' },
  { key: 'classic', label: 'Classic', hint: 'Centered, serif, formal — invoice-style.' },
  { key: 'minimal', label: 'Minimal', hint: 'Black & white, no decoration, prints small.' },
];

function StyleCard({ option, current, onPick }) {
  const active = option.key === current;
  return (
    <button type="button"
      className={`doc-style-card${active ? ' doc-style-card--active' : ''}`}
      onClick={() => onPick(option.key)}>
      <div className={`doc-style-preview doc-style-preview--${option.key}`}>
        <div className="doc-style-preview-band" />
        <div className="doc-style-preview-line doc-style-preview-line--w70" />
        <div className="doc-style-preview-line doc-style-preview-line--w50" />
        <div className="doc-style-preview-line doc-style-preview-line--w90" />
        <div className="doc-style-preview-line doc-style-preview-line--w60" />
      </div>
      <div className="doc-style-name">{option.label}</div>
      <div className="doc-style-hint">{option.hint}</div>
    </button>
  );
}

function DocumentsTab({ projectId, showToast }) {
  const pq = `?project_id=${projectId}`;
  const fileRef = useRef(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/document-settings${pq}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null).then(d => setForm(d || {
        style: 'modern', company_name: '', logo_url: null, address: '',
        tax_id_label: 'Tax ID', tax_id: '', contact_email: '', contact_phone: '',
        footer_note: '', accent_color: '#0071E3',
      }));
  }, [projectId]);

  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = useCallback(async () => {
    if (!form) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/document-settings${pq}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) showToast('Saved');
      else showToast('Save failed');
    } finally { setBusy(false); }
  }, [form, projectId, showToast]);

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    const fd = new FormData(); fd.append('file', file);
    try {
      const res = await fetch(`${API_BASE}/api/upload/image${pq}`, {
        method: 'POST', credentials: 'include', body: fd,
      });
      const data = await res.json();
      if (res.ok && data.url) upd('logo_url', data.url);
      else showToast('Upload failed');
    } finally { setUploading(false); }
  };

  if (!form) return <p className="crm-placeholder">Loading…</p>;

  return (
    <>
      <h1 className="crm-page-title">Documents</h1>
      <p className="auth-page-subtitle">
        Branding for invoices, acts, receipts and tickets. Saved settings apply to
        all PDFs generated from orders and bookings — no per-document override.
      </p>

      <section className="auth-section">
        <h2 className="auth-section-title">Template style</h2>
        <p className="auth-field-hint">Pick the visual layout. You can change it any time.</p>
        <div className="doc-style-row">
          {STYLE_OPTIONS.map(opt => (
            <StyleCard key={opt.key} option={opt}
              current={form.style} onPick={v => upd('style', v)} />
          ))}
        </div>
      </section>

      <section className="auth-section">
        <h2 className="auth-section-title">Company info</h2>

        <div className="auth-field">
          <label className="auth-label">Company / brand name</label>
          <input className="crm-input" value={form.company_name || ''}
            onChange={e => upd('company_name', e.target.value)} maxLength={200}
            placeholder="Acme Inc, ИП Иванов, etc." />
        </div>

        <div className="auth-field">
          <label className="auth-label">Logo (optional)</label>
          <input ref={fileRef} type="file" accept="image/*" className="hidden-input"
            onChange={e => upload(e.target.files?.[0])} />
          {form.logo_url ? (
            <div className="bk-svc-img-preview">
              <img src={form.logo_url} alt="" />
              <div className="bk-svc-img-actions">
                <button type="button" className="crm-submit-btn auth-btn-secondary"
                  onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? 'Uploading…' : 'Replace'}
                </button>
                <button type="button" className="auth-btn-danger"
                  onClick={() => upd('logo_url', null)}>Remove</button>
              </div>
            </div>
          ) : (
            <button type="button" className="bk-svc-img-drop"
              onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : (
                <><UploadSimple weight="bold" size={20} /> <span>Click to upload a logo</span></>
              )}
            </button>
          )}
          <p className="auth-field-hint">Square or wide; rendered at 28×28 mm in the PDF header.</p>
        </div>

        <div className="bk-rules-grid">
          <div className="auth-field">
            <label className="auth-label">Tax ID label</label>
            <input className="crm-input" value={form.tax_id_label || ''}
              onChange={e => upd('tax_id_label', e.target.value)} maxLength={40}
              placeholder="BIN / VAT / EIN / ИНН…" />
          </div>
          <div className="auth-field">
            <label className="auth-label">Tax ID value</label>
            <input className="crm-input" value={form.tax_id || ''}
              onChange={e => upd('tax_id', e.target.value)} maxLength={80}
              placeholder="123456789012" />
          </div>
        </div>

        <div className="auth-field">
          <label className="auth-label">Address</label>
          <textarea className="crm-input bk-textarea" rows={3}
            value={form.address || ''} onChange={e => upd('address', e.target.value)}
            placeholder="Street, city, postal code, country" maxLength={500} />
        </div>

        <div className="bk-rules-grid">
          <div className="auth-field">
            <label className="auth-label">Contact email</label>
            <input className="crm-input" value={form.contact_email || ''} type="email"
              onChange={e => upd('contact_email', e.target.value)} maxLength={200}
              placeholder="billing@company.com" />
          </div>
          <div className="auth-field">
            <label className="auth-label">Contact phone</label>
            <input className="crm-input" value={form.contact_phone || ''}
              onChange={e => upd('contact_phone', e.target.value)} maxLength={40}
              placeholder="+1 555 0100" />
          </div>
        </div>

        <div className="bk-rules-grid">
          <div className="auth-field">
            <label className="auth-label">Accent colour (hex)</label>
            <input className="crm-input" value={form.accent_color || '#0071E3'}
              onChange={e => upd('accent_color', e.target.value)} maxLength={20}
              placeholder="#0071E3" />
            <p className="auth-field-hint">Used for the banner & total row in the Modern template.</p>
          </div>
          <div className="auth-field">
            <label className="auth-label">Footer note (optional)</label>
            <input className="crm-input" value={form.footer_note || ''}
              onChange={e => upd('footer_note', e.target.value)} maxLength={200}
              placeholder="Thank you for your business" />
          </div>
        </div>

        <div className="auth-actions">
          <button className="crm-submit-btn" onClick={save} disabled={busy} type="button">
            {busy ? 'Saving…' : 'Save documents settings'}
          </button>
        </div>
      </section>
    </>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────

export default function ProjectSettings() {
  const { projectId } = useOutletContext();
  const [tab, setTab] = useState('documents');
  const [toast, setToast] = useState('');
  const tref = useRef(null);

  const showToast = (msg) => {
    setToast(msg);
    if (tref.current) clearTimeout(tref.current);
    tref.current = setTimeout(() => setToast(''), 3200);
  };

  return (
    <>
      <div className="auth-tab-wrapper">
        <TabSwitcher tab={tab} setTab={setTab} />
      </div>
      <div className="auth-page">

      {tab === 'general' && (
        <GeneralTab projectId={projectId} showToast={showToast} />
      )}

      {tab === 'inventory' && (
        <InventoryConfigTab projectId={projectId} showToast={showToast} />
      )}

      {tab === 'barcode' && (
        <BarcodeDefaultsTab projectId={projectId} showToast={showToast} />
      )}

      {tab === 'documents' && (
        <DocumentsTab projectId={projectId} showToast={showToast} />
      )}

      {tab === 'danger' && (
        <>
          <h1 className="crm-page-title">Danger Zone</h1>
          <p className="auth-page-subtitle">
            Irreversible actions: rotate API key, delete project. Coming soon.
          </p>
          <div className="crm-placeholder">Coming soon</div>
        </>
      )}

      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
      </div>
    </>
  );
}

// ── General tab: timezone + currency ─────────────────────
// These two settings drive how dates and money are formatted across
// the entire CRM. Timezone is critical: without it, an Almaty merchant
// sees orders bucketed by UTC days, so a 23:00 local order looks like
// "yesterday" in analytics and "today" in the orders list.

// Common IANA timezones — covers the bulk of e-commerce markets without
// dumping the full 600+ list on the user. They can type a custom value
// via the text input if their zone isn't here.
const TIMEZONE_PRESETS = [
  'UTC',
  'Asia/Almaty',     'Asia/Aqtobe',    'Asia/Tashkent',
  'Europe/Moscow',   'Europe/London',  'Europe/Berlin',
  'Europe/Paris',    'Europe/Istanbul',
  'America/New_York','America/Chicago','America/Denver',
  'America/Los_Angeles','America/Toronto',
  'Asia/Dubai',      'Asia/Singapore', 'Asia/Tokyo',
  'Australia/Sydney',
];

// Common currencies — same triage. Bonus: shows symbol next to code.
const CURRENCY_PRESETS = [
  { code: 'USD', label: 'US Dollar ($)' },
  { code: 'EUR', label: 'Euro (€)' },
  { code: 'GBP', label: 'British Pound (£)' },
  { code: 'KZT', label: 'Kazakhstani Tenge (₸)' },
  { code: 'RUB', label: 'Russian Ruble (₽)' },
  { code: 'TRY', label: 'Turkish Lira (₺)' },
  { code: 'UZS', label: 'Uzbekistani Som' },
  { code: 'CNY', label: 'Chinese Yuan (¥)' },
  { code: 'JPY', label: 'Japanese Yen (¥)' },
  { code: 'AED', label: 'UAE Dirham' },
];

function GeneralTab({ projectId, showToast }) {
  const [tz,       setTz]       = useState('UTC');
  const [tzAuto,   setTzAuto]   = useState(true);
  const [currency, setCurrency] = useState('USD');
  const [loaded,   setLoaded]   = useState(false);
  const [savingTz, setSavingTz] = useState(false);
  const [savingCur,setSavingCur]= useState(false);
  useEffect(() => {
    fetch(`${API_BASE}/api/projects/${projectId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (j) {
          setTz(j.timezone || 'UTC');
          setTzAuto(j.tz_auto !== false);
          setCurrency(j.currency || 'USD');
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [projectId]);
  const save = async (body, setBusy) => {
    setBusy(true);
    const r = await fetch(`${API_BASE}/api/projects/${projectId}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (r.ok) {
      showToast('Saved');
      setTimeout(() => window.location.reload(), 500);
    } else {
      const j = await r.json().catch(() => ({}));
      showToast(j.detail || 'Save failed');
    }
  };
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  // Manual dropdown selection → flips tz_auto off (user picked one
  // explicitly, don't auto-overwrite next time they reload from a
  // different machine).
  const pickTimezone = (v) => {
    setTz(v); setTzAuto(false);
    save({ timezone: v, tz_auto: false }, setSavingTz);
  };
  // "Use browser timezone" → switches BACK to auto mode + immediately
  // syncs to whatever the browser reports now. From this moment, the
  // hidden polling in CRM Layout will keep tz in sync with the browser
  // every 30 min + on every page load.
  const useBrowser = () => {
    setTz(browserTz); setTzAuto(true);
    save({ timezone: browserTz, tz_auto: true }, setSavingTz);
  };
  return (
    <>
      <h1 className="crm-page-title">General</h1>
      <p className="auth-page-subtitle">
        Timezone and currency. Both drive how dates and money are
        displayed across the dashboard — Analytics, Orders, Booking, etc.
      </p>

      <div className="crm-section" style={{ marginBottom: 24 }}>
        <h3 className="crm-section-title" style={{ marginBottom: 12 }}>Timezone</h3>
        <p className="cpm-section-hint" style={{ marginBottom: 12 }}>
          Days in analytics are bucketed by this timezone. Orders show
          their creation date in this timezone too.
          <br />
          {tzAuto ? (
            <>
              <b>Auto-detect mode</b> — CRM keeps the project tz in sync
              with your browser ({browserTz}) every 30 min and on every
              page load. Pick a zone from the dropdown to lock it.
            </>
          ) : (
            <>
              <b>Manual mode</b> — locked to {tz}. Your browser reports{' '}
              <b>{browserTz}</b>.{' '}
              {tz !== browserTz && (
                <button type="button" className="auth-btn-check"
                  style={{ marginLeft: 8 }}
                  onClick={useBrowser}
                  disabled={!loaded || savingTz}>
                  Use browser timezone
                </button>
              )}
              {tz === browserTz && (
                <button type="button" className="auth-btn-check"
                  style={{ marginLeft: 8 }}
                  onClick={useBrowser}
                  disabled={!loaded || savingTz}>
                  Resume auto-detect
                </button>
              )}
            </>
          )}
        </p>
        <select className="crm-input" value={tz}
          disabled={!loaded || savingTz}
          onChange={e => pickTimezone(e.target.value)}>
          {TIMEZONE_PRESETS.includes(tz) ? null : <option value={tz}>{tz}</option>}
          {TIMEZONE_PRESETS.map(z => <option key={z} value={z}>{z}</option>)}
        </select>
      </div>

      <div className="crm-section">
        <h3 className="crm-section-title" style={{ marginBottom: 12 }}>Currency</h3>
        <p className="cpm-section-hint" style={{ marginBottom: 12 }}>
          All amounts on the dashboard are formatted with this currency's
          symbol and decimal style. Per-order currency on order_history
          still wins when it disagrees (cross-currency sales).
        </p>
        <select className="crm-input" value={currency}
          disabled={!loaded || savingCur}
          onChange={e => { setCurrency(e.target.value); save({ currency: e.target.value }, setSavingCur); }}>
          {CURRENCY_PRESETS.some(c => c.code === currency) ? null
            : <option value={currency}>{currency}</option>}
          {CURRENCY_PRESETS.map(c => (
            <option key={c.code} value={c.code}>{c.label}</option>
          ))}
        </select>
      </div>
    </>
  );
}

// ── Inventory tab: FIFO/LIFO consumption ────────────────

function InventoryConfigTab({ projectId, showToast }) {
  const [mode, setMode] = useState('fifo');
  const [hidePrice, setHidePrice] = useState(false);
  const [marginPct, setMarginPct] = useState(50);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/projects/${projectId}/batch-settings`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (j) {
          setMode(j.batch_consumption_mode || 'fifo');
          setHidePrice(!!j.hide_price_in_overview);
          setMarginPct(parseFloat(j.default_margin_percent || 50));
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [projectId]);

  const save = async (patch) => {
    const r = await fetch(`${API_BASE}/api/projects/${projectId}/batch-settings`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (r.ok) showToast('Saved');
  };

  return (
    <>
      <h1 className="crm-page-title">Inventory</h1>
      <p className="auth-page-subtitle">
        Batch consumption order + how prices are entered for SKUs.
        Batch-name format lives in <b>Products → Settings</b>.
      </p>

      <div className="crm-section">
        <h3 className="crm-section-title" style={{ marginBottom: 12 }}>Batch consumption</h3>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input type="radio" name="cmode" checked={mode === 'fifo'}
            onChange={() => { setMode('fifo'); save({ batch_consumption_mode: 'fifo' }); }} disabled={!loaded} />
          <span style={{ fontWeight: 500 }}>FIFO — first in, first out (default)</span>
          <span className="cpm-section-hint">Oldest batches sell first. Best for food, cosmetics, anything with an expiry date.</span>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 }}>
          <input type="radio" name="cmode" checked={mode === 'lifo'}
            onChange={() => { setMode('lifo'); save({ batch_consumption_mode: 'lifo' }); }} disabled={!loaded} />
          <span style={{ fontWeight: 500 }}>LIFO — last in, first out</span>
          <span className="cpm-section-hint">Newest batches sell first. Uncommon — use only if you have a specific reason.</span>
        </label>
      </div>

      <div className="crm-section" style={{ marginTop: 16 }}>
        <h3 className="crm-section-title" style={{ marginBottom: 12 }}>Pricing entry</h3>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <input type="checkbox" checked={hidePrice} disabled={!loaded}
            onChange={(e) => { setHidePrice(e.target.checked); save({ hide_price_in_overview: e.target.checked }); }} />
          <span>
            <span style={{ fontWeight: 500 }}>Hide Price column — enter Cost only</span>
            <span className="cpm-section-hint">
              Product Overview hides the Price column for L2 SKUs. Merchant types <b>Cost</b>;
              public price is auto-set to <b>Cost × (1 + margin/100)</b>.
            </span>
          </span>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, opacity: hidePrice ? 1 : 0.5 }}>
          <span style={{ fontWeight: 500, minWidth: 160 }}>Default margin (%)</span>
          <input className="crm-input" type="number" min="0" max="10000" step="0.1"
            style={{ width: 120 }}
            value={marginPct}
            disabled={!hidePrice || !loaded}
            onChange={(e) => setMarginPct(parseFloat(e.target.value) || 0)}
            onBlur={(e) => save({ default_margin_percent: parseFloat(e.target.value) || 0 })} />
          <span className="cpm-section-hint">
            E.g. <b>50</b> → price = cost × 1.5. A cost of 100 produces price 150.
          </span>
        </label>
      </div>
    </>
  );
}

// ── Barcode defaults tab: include date/batch/qty/serial ──

function BarcodeDefaultsTab({ projectId, showToast }) {
  const [s, setS] = useState({
    barcode_include_date:   false,
    barcode_include_batch:  false,
    barcode_include_qty:    false,
    barcode_include_serial: false,
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/projects/${projectId}/batch-settings`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j) setS({
        barcode_include_date:   !!j.barcode_include_date,
        barcode_include_batch:  !!j.barcode_include_batch,
        barcode_include_qty:    !!j.barcode_include_qty,
        barcode_include_serial: !!j.barcode_include_serial,
      }); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [projectId]);

  const toggle = async (key) => {
    const next = { ...s, [key]: !s[key] };
    setS(next);
    const r = await fetch(`${API_BASE}/api/projects/${projectId}/batch-settings`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: next[key] }),
    });
    if (r.ok) showToast('Saved');
  };

  const ROW = ({ k, label, sub }) => (
    <label className="print-bc-check-row" style={{ padding: '8px 0' }}>
      <input type="checkbox" checked={s[k]} disabled={!loaded} onChange={() => toggle(k)} />
      <span style={{ flex: 1 }}>
        <div style={{ fontWeight: 500 }}>{label}</div>
        <div className="cpm-section-hint">{sub}</div>
      </span>
    </label>
  );

  return (
    <>
      <h1 className="crm-page-title">Barcode defaults</h1>
      <p className="auth-page-subtitle">
        These toggles pre-fill the "Advanced encoding" section in Print barcodes. Save once — they apply everywhere.
      </p>
      <div className="crm-section">
        <ROW k="barcode_include_date"   label="Include production date" sub="Appends -YYYYMMDD to the encoded value" />
        <ROW k="barcode_include_batch"  label="Include batch name"      sub="Appends -B<batch> — useful for recall traceability" />
        <ROW k="barcode_include_qty"    label="Include quantity in batch" sub="Appends -Q<n> — for production reporting" />
        <ROW k="barcode_include_serial" label="Include serial counter"  sub="Each printed sticker gets a unique -NNNN suffix" />
      </div>
    </>
  );
}
