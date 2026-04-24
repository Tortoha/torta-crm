import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { MagnifyingGlass, Plus, FolderSimple } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { InteractiveSection } from '../../Utils/InteractiveSection.js';
import Header from '../../Elements/Header.jsx';
import Modal from '../../Elements/Modal.jsx';
import '../../Style/Layout.css';
import '../../Style/Dashboard.css';

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

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard() {
  const [user,    setUser]    = useState(null);
  const [orgs,    setOrgs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(false);
  const [search,  setSearch]  = useState('');
  const [orgName, setOrgName] = useState('');
  const [orgSaving, setOrgSaving] = useState(false);
  const [orgErr,  setOrgErr]  = useState('');
  const navigate = useNavigate();

  const closeOrgModal = () => { setModal(false); setOrgName(''); setOrgErr(''); };

  const createOrg = async e => {
    e.preventDefault();
    const trimmed = orgName.trim();
    if (!trimmed) return setOrgErr('Name is required');
    setOrgSaving(true); setOrgErr('');
    try {
      const res  = await fetch(`${API_BASE}/api/orgs`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) return setOrgErr(data.detail || 'Error');
      setOrgs(prev => [data, ...prev]);
      closeOrgModal();
    } catch { setOrgErr('Network error'); }
    finally   { setOrgSaving(false); }
  };

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
        <Modal title="New organization" onClose={closeOrgModal} maxWidth={400}>
          <form onSubmit={createOrg}>
            <div className="hdr-modal-field">
              <h4 className="hdr-modal-label">Name</h4>
              <input className="hdr-modal-input" placeholder="Organization name" autoFocus maxLength={100}
                value={orgName} onChange={e => { setOrgName(e.target.value); setOrgErr(''); }} />
            </div>
            {orgErr && <span className="hdr-modal-err">{orgErr}</span>}
            <button className="hdr-modal-submit" type="submit" disabled={orgSaving || !orgName.trim()}>
              {orgSaving ? 'Creating…' : 'Create'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

export default Dashboard