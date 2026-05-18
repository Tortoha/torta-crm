import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import {
  Envelope, PhoneCall,
  CaretRight, X, CheckCircle, Globe, ShieldCheck, Trash,
} from '@phosphor-icons/react';
import { Icon } from '@iconify/react';
import { API_BASE } from '../../api.js';
import { InteractiveSection } from '../../Utils/InteractiveSection.js';
import EmailPanel from './EmailPanel.jsx';
import GooglePanel from './GooglePanel.jsx';
import OAuthProviderPanel from './OAuthProviderPanel.jsx';
import ApplePanel from './ApplePanel.jsx';
import PhonePanel from './PhonePanel.jsx';
import '../../Style/Authentication.css';


const PROVIDERS = [
  // Email — special, custom panel (DKIM/SPF/DMARC, etc.)
  { id: 'email',  label: 'Email',  desc: 'Code-based login via email OTP', configurable: true, phosphor: Envelope },
  // Phone — uses its own panel (PhonePanel) with SMS-provider configuration
  { id: 'phone', label: 'Phone', desc: 'Code-based login via SMS', configurable: true, phosphor: PhoneCall },
  // Google — special, kept as a separate panel (uses its own DB columns + token format)
  { id: 'google', label: 'Google', desc: 'Sign in with Google account',    configurable: true, iconify: 'logos:google-icon' },
  // Generic OAuth providers (real, working — share OAuthProviderPanel)
  { id: 'github',    label: 'GitHub',          desc: 'Sign in with GitHub',         configurable: true, iconify: 'simple-icons:github',    color: '#181717' },
  { id: 'discord',   label: 'Discord',         desc: 'Sign in with Discord',        configurable: true, iconify: 'logos:discord-icon' },
  { id: 'facebook',  label: 'Facebook',        desc: 'Sign in with Facebook',       configurable: true, iconify: 'logos:facebook' },
  { id: 'gitlab',    label: 'GitLab',          desc: 'Sign in with GitLab',         configurable: true, iconify: 'simple-icons:gitlab',    color: '#FC6D26' },
  { id: 'bitbucket', label: 'Bitbucket',       desc: 'Sign in with Bitbucket',      configurable: true, iconify: 'simple-icons:bitbucket', color: '#0052CC' },
  { id: 'linkedin',  label: 'LinkedIn (OIDC)', desc: 'Sign in with LinkedIn',       configurable: true, iconify: 'simple-icons:linkedin',  color: '#0A66C2' },
  { id: 'twitch',    label: 'Twitch',          desc: 'Sign in with Twitch',         configurable: true, iconify: 'simple-icons:twitch',    color: '#9146FF' },
  { id: 'spotify',   label: 'Spotify',         desc: 'Sign in with Spotify',        configurable: true, iconify: 'simple-icons:spotify',   color: '#1DB954' },
  { id: 'slack',     label: 'Slack (OIDC)',    desc: 'Sign in with Slack',          configurable: true, iconify: 'logos:slack-icon' },
  { id: 'notion',    label: 'Notion',          desc: 'Sign in with Notion',         configurable: true, iconify: 'simple-icons:notion',    color: '#000000' },
  { id: 'figma',     label: 'Figma',           desc: 'Sign in with Figma',          configurable: true, iconify: 'logos:figma' },
  { id: 'zoom',      label: 'Zoom',            desc: 'Sign in with Zoom',           configurable: true, iconify: 'simple-icons:zoom',      color: '#2D8CFF' },
  { id: 'azure',     label: 'Azure',           desc: 'Microsoft Entra ID (Azure AD)', configurable: true, iconify: 'logos:microsoft-azure' },
  { id: 'apple',     label: 'Apple',           desc: 'Sign in with Apple ID',       configurable: true, iconify: 'simple-icons:apple',     color: '#000000' },
  { id: 'x',         label: 'X / Twitter (OAuth 2.0)', desc: 'Sign in with X',      configurable: true, iconify: 'simple-icons:x',         color: '#000000' },
  { id: 'kakao',     label: 'Kakao',           desc: 'Sign in with Kakao',          configurable: true, iconify: 'simple-icons:kakaotalk', color: '#3C1E1E' },
  { id: 'keycloak',  label: 'KeyCloak',        desc: 'Sign in with KeyCloak',       configurable: true, iconify: 'simple-icons:keycloak',  color: '#4D4D4D' },
];


const ProviderIcon = ({ provider, size = 24 }) =>
  provider.iconify
    ? <Icon icon={provider.iconify} width={size} height={size} style={provider.color ? { color: provider.color } : undefined} />
    : <provider.phosphor className="auth-provider-icon" />;

const ROW_TILT = {
  maxAngleX: 8, maxAngleY: 3, lerp: 0.05, lerpOut: 0.07,
  scale: 1.052, perspective: 900,
  gloss: { opacity: 0.10, spread: 40 },
};

// ─── Tab Switcher ─────────────────────────────────────────────────────────────

function TabSwitcher({ tab, setTab }) {
  const indRef  = useRef(null);
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
    { key: 'providers', label: 'Auth Providers',    Icon: ShieldCheck },
    { key: 'urls',      label: 'URL Configuration', Icon: Globe },
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

// ─── Provider Rows ────────────────────────────────────────────────────────────

function ProviderRow({ provider, enabled, onClick, first, last }) {
  const { ref, glossRef, handlers } = InteractiveSection(ROW_TILT, false);

  const cls = [
    'auth-provider-row',
    first && 'auth-provider-row--first',
    last  && 'auth-provider-row--last',
  ].filter(Boolean).join(' ');

  return (
    <div ref={ref} className={cls} onClick={onClick} {...handlers}>
      <div ref={glossRef} className="auth-provider-gloss" />

      <div className="auth-provider-icon-wrap">
        <ProviderIcon provider={provider} size={24} />
      </div>

      <span className="auth-provider-name">{provider.label}</span>
      <span className="auth-provider-desc">{provider.desc}</span>

      {enabled
        ? <span className="auth-badge-enabled"><CheckCircle weight="fill" size={11} /> Enabled</span>
        : <span className="auth-badge-disabled">Disabled</span>}

      <CaretRight className="auth-provider-chevron" />
    </div>
  );
}

function DisabledProviderRow({ provider, first, last }) {
  const cls = [
    'auth-provider-row',
    'auth-provider-row--disabled',
    first && 'auth-provider-row--first',
    last  && 'auth-provider-row--last',
  ].filter(Boolean).join(' ');

  return (
    <div className={cls}>
      <div className="auth-provider-icon-wrap auth-provider-icon-wrap--dim">
        <ProviderIcon provider={provider} size={24} />
      </div>
      <span className="auth-provider-name">{provider.label}</span>
      <span className="auth-provider-desc">{provider.desc}</span>
      <span className="auth-badge-disabled">Disabled</span>
      <CaretRight className="auth-provider-chevron" />
    </div>
  );
}

// ─── Modal wrapper ────────────────────────────────────────────────────────────

function AuthModal({ title, subtitle, iconEl, onClose, children, badge }) {
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="auth-modal">
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div className="auth-modal-icon-wrap">{iconEl}</div>
            <div>
              <div className="auth-modal-title">{title}</div>
              {(subtitle || badge) && (
                <div className="auth-modal-subtitle-row">
                  {subtitle && <span className="auth-modal-subtitle">{subtitle}</span>}
                  {badge}
                </div>
              )}
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>
        <div className="auth-modal-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}

// ─── URL Config Panel ─────────────────────────────────────────────────────────

function UrlConfigPanel({ projectId }) {
  const pq = `?project_id=${projectId}`;
  const [siteUrl,      setSiteUrl]      = useState('');
  const [original,     setOriginal]     = useState('');
  const [saving,       setSaving]       = useState(false);
  const [siteErr,      setSiteErr]      = useState('');
  const [redirectUrls, setRedirectUrls] = useState([]);
  const [newUrl,       setNewUrl]       = useState('');
  const [addErr,       setAddErr]       = useState('');
  const [adding,       setAdding]       = useState(false);
  const [deletingId,   setDeletingId]   = useState(null);
  const [toast,        setToast]        = useState('');
  const toastTimer = useRef(null);

  const showToast = msg => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  };

  const loadSite = async () => {
    const res  = await fetch(`${API_BASE}/api/url-config${pq}`, { credentials: 'include' });
    const json = await res.json();
    setSiteUrl(json.frontend_url || ''); setOriginal(json.frontend_url || '');
  };

  const loadRedirects = async () => {
    const res  = await fetch(`${API_BASE}/api/redirect-urls${pq}`, { credentials: 'include' });
    const json = await res.json();
    setRedirectUrls(json.urls || []);
  };

  useEffect(() => { loadSite(); loadRedirects(); }, [projectId]);

  const saveSite = async () => {
    setSaving(true); setSiteErr('');
    try {
      const res  = await fetch(`${API_BASE}/api/url-config${pq}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frontend_url: siteUrl.trim() }),
      });
      const json = await res.json();
      if (res.ok) { showToast('Saved.'); setOriginal(siteUrl.trim()); }
      else        { setSiteErr(json.detail || 'Error'); }
    } catch { setSiteErr('Network error'); }
    finally { setSaving(false); }
  };

  const addUrl = async () => {
    const url = newUrl.trim();
    if (!url) return;
    setAdding(true); setAddErr('');
    try {
      const res  = await fetch(`${API_BASE}/api/redirect-urls${pq}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const json = await res.json();
      if (res.ok) { setNewUrl(''); await loadRedirects(); }
      else        { setAddErr(json.detail || 'Error'); }
    } catch { setAddErr('Network error'); }
    finally { setAdding(false); }
  };

  const deleteUrl = async id => {
    setDeletingId(id);
    try {
      await fetch(`${API_BASE}/api/redirect-urls/${id}${pq}`, { method: 'DELETE', credentials: 'include' });
      await loadRedirects();
    } catch {}
    setDeletingId(null);
  };

  const siteChanged = siteUrl.trim() !== original;

  return (
    <>
    <div className="urlcfg-wrap">

      {/* ── Card 1: Site URL ── */}
      <div className="auth-urlcfg-card">
        <div className="urlcfg-card-header">
          <h2 className="urlcfg-card-title">Site URL</h2>
          <p className="urlcfg-card-desc">
            The main URL of your storefront. Used as the default redirect after login, sign-up, and password reset.
          </p>
        </div>
        <div className="urlcfg-inline-row">
          <input className="crm-input urlcfg-input" placeholder="https://mystore.com"
            value={siteUrl}
            onChange={e => { setSiteUrl(e.target.value); setSiteErr(''); }}
            autoComplete="off" />
          <button className="urlcfg-save-btn" onClick={saveSite}
            disabled={saving || !siteChanged} type="button">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
        {siteErr && <p className="auth-msg auth-msg--err">{siteErr}</p>}
      </div>

      {/* ── Card 2: Redirect URLs ── */}
      <div className="auth-urlcfg-card">
        <div className="urlcfg-card-header">
          <h2 className="urlcfg-card-title">Redirect URLs</h2>
          <p className="urlcfg-card-desc">
            URLs that auth providers are permitted to redirect to after authentication.
            Wildcards allowed, e.g. <code>https://*.domain.com</code>
          </p>
        </div>

        <div className="auth-add-row">
          <input className="crm-input urlcfg-input" placeholder="https://mystore.com/auth/callback"
            value={newUrl}
            onChange={e => { setNewUrl(e.target.value); setAddErr(''); }}
            onKeyDown={e => e.key === 'Enter' && addUrl()}
            autoComplete="off" />
          <button className="auth-add-btn" onClick={addUrl}
            disabled={adding || !newUrl.trim()} type="button">
            {adding ? 'Adding…' : 'Add URL'}
          </button>
        </div>

        {addErr && <p className="auth-msg auth-msg--err">{addErr}</p>}

        {redirectUrls.length > 0 ? (
          <div className="auth-redirect-list">
            {redirectUrls.map(row => (
              <div key={row.id} className="auth-redirect-row">
                <Globe size={13} className="auth-redirect-icon" />
                <span className="auth-redirect-url">{row.url}</span>
                <button className="urlcfg-del-btn"
                  onClick={() => deleteUrl(row.id)} disabled={deletingId === row.id} title="Remove">
                  <Trash size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="urlcfg-empty">No redirect URLs added yet.</p>
        )}
      </div>

    </div>

    {toast && createPortal(
      <div className="auth-toast">{toast}</div>,
      document.body,
    )}
    </>
  );
}

// ─── Authentication ───────────────────────────────────────────────────────────

function Authentication() {
  const { projectId } = useOutletContext();
  const [tab,             setTab]             = useState('providers');
  const [modal,           setModal]           = useState(null); // null | provider.id
  const [googleEnabled,   setGoogleEnabled]   = useState(false);
  const [phoneEnabled,    setPhoneEnabled]    = useState(false);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [emailVerified,   setEmailVerified]   = useState(false);
  // Map of generic provider.id → bool (is_enabled)
  const [providerEnabled, setProviderEnabled] = useState({});

  const reloadProviders = () => {
    fetch(`${API_BASE}/api/auth-providers?project_id=${projectId}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        const map = {};
        for (const p of (d.providers || [])) {
          map[p.provider] = !!p.is_enabled && !!p.configured;
        }
        setProviderEnabled(map);
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetch(`${API_BASE}/api/oauth-settings?project_id=${projectId}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setGoogleEnabled(!!d.google_enabled))
      .catch(() => {});

    fetch(`${API_BASE}/api/email-domain?project_id=${projectId}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        setEmailConfigured(!!d.configured);
        setEmailVerified(!!d.configured && !!d.dkim_ok && !!d.spf_ok);
      })
      .catch(() => {});

    fetch(`${API_BASE}/api/sms-settings?project_id=${projectId}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setPhoneEnabled(!!d.is_enabled))
      .catch(() => {});

    reloadProviders();
  }, [projectId]);

  const configurable = PROVIDERS.filter(p => p.configurable);
  const disabled     = PROVIDERS.filter(p => !p.configurable);
  const allRows      = [...configurable, ...disabled];

  const isEnabled = id => {
    if (id === 'email')  return emailConfigured;
    if (id === 'google') return googleEnabled;
    if (id === 'phone')  return phoneEnabled;
    return !!providerEnabled[id];
  };

  const modalProvider = modal && modal !== 'email' && modal !== 'google' && modal !== 'phone'
    ? PROVIDERS.find(p => p.id === modal)
    : null;

  return (
    <>
      {/* ── Sticky tab switcher ── */}
      <div className="auth-tab-wrapper">
        <TabSwitcher tab={tab} setTab={setTab} />
      </div>

      {/* ── Page content ── */}
      <div className="auth-page">
        {tab === 'providers' && (
          <>
            <h1 className="crm-page-title">Auth Providers</h1>
            <p className="auth-page-subtitle">
              Authenticate your store users through a suite of providers and login methods.
            </p>

            <div className="auth-providers-list">
              {allRows.map((provider, idx) => {
                const first = idx === 0;
                const last  = idx === allRows.length - 1;
                return provider.configurable
                  ? <ProviderRow key={provider.id} provider={provider}
                      enabled={isEnabled(provider.id)} first={first} last={last}
                      onClick={() => setModal(provider.id)} />
                  : <DisabledProviderRow key={provider.id} provider={provider}
                      first={first} last={last} />;
              })}
            </div>
          </>
        )}

        {tab === 'urls' && (
          <>
            <h1 className="crm-page-title">URL Configuration</h1>
            <p className="auth-page-subtitle">
              Configure site URL and redirect URLs for authentication flows.
            </p>
            <UrlConfigPanel projectId={projectId} />
          </>
        )}
      </div>

      {/* ── Modals ── */}
      {modal === 'email' && (
        <AuthModal title="Email" subtitle="Code-based login via email OTP"
          iconEl={<Envelope size={24} className="auth-modal-icon-svg" />}
          onClose={() => setModal(null)}>
          <EmailPanel projectId={projectId} onVerifiedChange={(verified) => {
            setEmailVerified(verified);
          }} onConfiguredChange={setEmailConfigured} />
        </AuthModal>
      )}

      {modal === 'google' && (
        <AuthModal title="Google" subtitle="Sign in with Google account"
          iconEl={<Icon icon="logos:google-icon" width={24} height={24} />}
          onClose={() => setModal(null)}>
          <GooglePanel projectId={projectId} onSaved={setGoogleEnabled} />
        </AuthModal>
      )}

      {modal === 'phone' && (
        <AuthModal title="Phone" subtitle="Code-based login via SMS"
          iconEl={<PhoneCall size={24} className="auth-modal-icon-svg" />}
          onClose={() => setModal(null)}>
          <PhonePanel projectId={projectId} onSaved={setPhoneEnabled} />
        </AuthModal>
      )}

      {modalProvider && (
        <AuthModal
          title={modalProvider.label}
          subtitle={modalProvider.desc}
          iconEl={<ProviderIcon provider={modalProvider} size={24} />}
          onClose={() => setModal(null)}>
          {modalProvider.id === 'apple' ? (
            <ApplePanel
              provider={modalProvider}
              projectId={projectId}
              onSaved={(en) => {
                setProviderEnabled(prev => ({ ...prev, [modalProvider.id]: !!en }));
              }}
            />
          ) : (
            <OAuthProviderPanel
              provider={modalProvider}
              projectId={projectId}
              onSaved={(en) => {
                setProviderEnabled(prev => ({ ...prev, [modalProvider.id]: !!en }));
              }}
            />
          )}
        </AuthModal>
      )}
    </>
  );
}

export default Authentication