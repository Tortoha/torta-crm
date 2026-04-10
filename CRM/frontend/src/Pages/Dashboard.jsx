import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, Link } from 'react-router-dom';
import { MagnifyingGlass, Plus, X, FolderSimple } from '@phosphor-icons/react';
import { API_BASE } from '../api.js';
import { InteractiveSection } from '../Utils/InteractiveSection.js';
import Header from '../Elements/Header.jsx';
import '../Style/Layout.css';
import '../Style/Dashboard.css';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtDate = iso => iso
  ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  : '—';

// ─── Tilt config ─────────────────────────────────────────────────────────────

const TILT = {
  maxAngle: 18, lerp: 0.05, lerpOut: 0.07,
  scale: 1.05, perspective: 700,
  gloss: { opacity: 0.18, spread: 60 },
};

// ─── OrgCard ─────────────────────────────────────────────────────────────────

function OrgCard({ org }) {
  const { ref, glossRef, handlers } = InteractiveSection(TILT);
  return (
    <Link ref={ref} className="db-card db-card--tilt" to={`/org/${org.slug}`} {...handlers}>
      <div ref={glossRef} className="db-card-gloss" />
      <div className="db-card-inner">
        <span className="db-card-badge">
          {org.projects_count} project{org.projects_count !== 1 ? 's' : ''}
        </span>
        <div className="db-card-row">
          <div className="db-card-icon">
            <FolderSimple className="db-card-icon-svg" />
          </div>
          <div className="db-card-text">
            <div className="db-card-name">{org.name}</div>
            <div className="db-card-meta">{fmtDate(org.created_at)}</div>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ─── CreateOrgModal ───────────────────────────────────────────────────────────

function CreateOrgModal({ onClose, onCreated }) {
  const [name,   setName]   = useState('');
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSubmit = async e => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setErr('Name is required');
    setSaving(true); setErr('');
    try {
      const res  = await fetch(`${API_BASE}/api/orgs`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) return setErr(data.detail || 'Error');
      onCreated(data); onClose();
    } catch { setErr('Network error'); }
    finally   { setSaving(false); }
  };

  return createPortal(
    <div className="hdr-modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="hdr-modal">
        <div className="hdr-modal-head">
          <span className="hdr-modal-title">New organization</span>
          <button className="hdr-modal-close" onClick={onClose} type="button" aria-label="Close">
            <X className="hdr-modal-close-icon" />
          </button>
        </div>
        <form className="hdr-modal-body" onSubmit={handleSubmit}>
          <div className="hdr-modal-field">
            <h4 className="hdr-modal-label">Name</h4>
            <input className="hdr-modal-input" placeholder="Organization name" autoFocus maxLength={100}
              value={name} onChange={e => { setName(e.target.value); setErr(''); }} />
          </div>
          {err && <span className="hdr-modal-err">{err}</span>}
          <button className="hdr-modal-submit" type="submit" disabled={saving || !name.trim()}>
            {saving ? 'Creating…' : 'Create'}
          </button>
        </form>
      </div>
    </div>,
    document.body
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard() {
  const [user,    setUser]    = useState(null);
  const [orgs,    setOrgs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(false);
  const [search,  setSearch]  = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/me`,   { credentials: 'include' }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
      fetch(`${API_BASE}/api/orgs`, { credentials: 'include' }).then(r => r.json()),
    ])
    .then(([u, o]) => { setUser(u); setOrgs(Array.isArray(o) ? o : []); })
    .catch(() => navigate('/login'))
    .finally(() => setLoading(false));
  }, [navigate]);

  if (loading) return (
    <div id="mask" className="mask">
      <svg><circle cx="50" cy="50" r="40" /></svg>
    </div>
  );

  const filtered = orgs.filter(o => o.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="crm-root">
      <Header user={user} />
      <main className="crm-main crm-main--flat">
        <div className="crm-content">
          <h1 className="crm-page-title db-page-title">Your Organizations</h1>

          <div className="db-toolbar">
            <div className="db-search-wrap">
              <MagnifyingGlass className="db-search-icon" />
              <input className="db-search-input" placeholder="Search organizations…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button className="db-new-btn" onClick={() => setModal(true)} type="button">
              <Plus className="db-new-icon" /> New organization
            </button>
          </div>

          {filtered.length === 0 ? (
            <div className="db-empty">
              {orgs.length === 0
                ? 'No organizations yet. Create one to get started.'
                : 'No organizations match your search.'}
            </div>
          ) : (
            <div className="db-grid">
              {filtered.map(org => <OrgCard key={org.id} org={org} />)}
            </div>
          )}
        </div>
      </main>

      {modal && (
        <CreateOrgModal
          onClose={() => setModal(false)}
          onCreated={org => setOrgs(prev => [org, ...prev])}
        />
      )}
    </div>
  );
}

export default Dashboard