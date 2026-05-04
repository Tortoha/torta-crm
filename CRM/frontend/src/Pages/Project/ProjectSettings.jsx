import { useEffect, useRef, useState, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { GearSix, FileText, Warning, UploadSimple } from '@phosphor-icons/react';
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
        <>
          <h1 className="crm-page-title">General</h1>
          <p className="auth-page-subtitle">
            Project name, frontend URL, currency & language live here. Coming soon.
          </p>
          <div className="crm-placeholder">Coming soon</div>
        </>
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
