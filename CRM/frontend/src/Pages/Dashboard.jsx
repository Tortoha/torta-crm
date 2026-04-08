import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, Link } from 'react-router-dom';
import { Plus, Buildings, FolderOpen, X } from '@phosphor-icons/react';
import { API_BASE } from '../api.js';
import Header from '../Elements/Header.jsx';
import '../Style/Layout.css';

function CreateOrgModal({ onClose, onCreated }) {
  const [newName, setNewName] = useState('');
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState('');

  const canSubmit = !!newName.trim();

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async e => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return setErr('Name is required');
    setSaving(true); setErr('');
    try {
      const res  = await fetch(`${API_BASE}/api/orgs`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.detail || 'Error'); return; }
      onCreated(data);
      onClose();
    } catch { setErr('Network error'); }
    finally { setSaving(false); }
  };

  return createPortal(
    <div className="hdr-modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="hdr-modal">
        <div className="hdr-modal-head">
          <span className="hdr-modal-title">New organization</span>
          <button className="hdr-modal-close" onClick={onClose} type="button" aria-label="Close">
            <X className="hdr-modal-close-icon" />
          </button>
        </div>
        <form className="hdr-modal-body" onSubmit={handleSubmit}>
          <div className="hdr-modal-field">
            <h4 className="hdr-modal-label">Organization name</h4>
            <input
              className="hdr-modal-input"
              placeholder="e.g. Nike Kazakhstan"
              value={newName}
              onChange={e => { setNewName(e.target.value); setErr(''); }}
              autoFocus
              maxLength={100}
            />
          </div>
          {err && <span className="hdr-modal-err">{err}</span>}
          <button className="hdr-modal-submit" type="submit" disabled={saving || !canSubmit}>
            {saving ? 'Creating…' : 'Create'}
          </button>
        </form>
      </div>
    </div>,
    document.body
  );
}

function Dashboard() {
  const [user,    setUser]    = useState(null);
  const [orgs,    setOrgs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/me`,   { credentials: 'include' }).then(r => { if (!r.ok) throw new Error('auth'); return r.json(); }),
      fetch(`${API_BASE}/api/orgs`, { credentials: 'include' }).then(r => r.json()),
    ])
    .then(([userData, orgsData]) => {
      setUser(userData);
      setOrgs(Array.isArray(orgsData) ? orgsData : []);
    })
    .catch(() => navigate('/login'))
    .finally(() => setLoading(false));
  }, [navigate]);

  if (loading) return (
    <div id="mask" className="mask">
      <svg><circle cx="50" cy="50" r="40" /></svg>
    </div>
  );

  return (
    <div className="crm-root">
      <Header user={user} />
      <div className="crm-body">
        <main className="crm-main crm-main--flat">
          <div className="crm-content">
            <div className="crm-section-row" style={{ marginBottom: 8 }}>
              <h1 className="crm-page-title" style={{ marginBottom: 0 }}>Organizations</h1>
              <button className="crm-add-btn" onClick={() => setModal(true)}>
                <Plus className="crm-add-btn-icon" />
                New Organization
              </button>
            </div>

            {orgs.length === 0 ? (
              <div className="crm-placeholder">
                No organizations yet. Create one to get started.
              </div>
            ) : (
              <div className="crm-cards-list">
                {orgs.map(org => (
                  <Link
                    key={org.id}
                    to={`/org/${org.slug}`}
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    <div className="crm-section-row" style={{ cursor: 'pointer' }}>
                      <Buildings size={20} style={{ color: '#555', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{org.name}</div>
                        <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>
                          {org.projects_count} project{org.projects_count !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <FolderOpen size={16} style={{ color: '#aaa' }} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      {modal && (
        <CreateOrgModal
          onClose={() => setModal(false)}
          onCreated={data => setOrgs(prev => [data, ...prev])}
        />
      )}
    </div>
  );
}

export default Dashboard;
