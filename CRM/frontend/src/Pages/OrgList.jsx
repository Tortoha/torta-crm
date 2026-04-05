import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Plus, Buildings, FolderOpen, SignOut, GearSix } from '@phosphor-icons/react';
import { API_BASE } from '../api.js';

function OrgList() {
  const [user,      setUser]      = useState(null);
  const [orgs,      setOrgs]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showForm,  setShowForm]  = useState(false);
  const [newName,   setNewName]   = useState('');
  const [creating,  setCreating]  = useState(false);
  const [err,       setErr]       = useState('');
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

  const createOrg = async (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return setErr('Name is required');
    setCreating(true); setErr('');
    try {
      const res  = await fetch(`${API_BASE}/api/orgs`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.detail || 'Error'); return; }
      setOrgs(prev => [data, ...prev]);
      setNewName('');
      setShowForm(false);
    } catch { setErr('Network error'); }
    finally { setCreating(false); }
  };

  const logout = async () => {
    await fetch(`${API_BASE}/api/logout`, { method: 'POST', credentials: 'include' });
    navigate('/');
  };

  if (loading) return (
    <div id="mask" className="mask">
      <svg><circle cx="50" cy="50" r="40" /></svg>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #f8f8f8)' }}>
      {/* Top nav */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 32px', height: 56, background: '#fff',
        borderBottom: '1px solid #e5e5e5', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Torta CRM</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, color: '#555' }}>{user?.name}</span>
          <button onClick={() => navigate('/project/settings')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6 }}>
            <GearSix size={18} />
          </button>
          <button onClick={logout} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, color: '#e3342f' }}>
            <SignOut size={18} />
          </button>
        </div>
      </header>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '40px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Organizations</h1>
            <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>
              Select an organization to view its projects
            </p>
          </div>
          <button className="crm-add-btn" onClick={() => { setShowForm(v => !v); setErr(''); }}>
            <Plus className="crm-add-btn-icon" />
            New Organization
          </button>
        </div>

        {/* Create form */}
        <div className={`crm-form-wrap${showForm ? ' crm-form-wrap--open' : ''}`} style={{ marginBottom: 24 }}>
          <form className="crm-form" onSubmit={createOrg}>
            <input
              className="crm-input"
              placeholder="Organization name, e.g. Nike Kazakhstan"
              value={newName}
              onChange={e => { setNewName(e.target.value); setErr(''); }}
              maxLength={100}
              autoFocus={showForm}
            />
            {err && <span className="crm-form-error">{err}</span>}
            <button className="crm-submit-btn" type="submit" disabled={creating}>
              {creating ? 'Creating…' : 'Create organization'}
            </button>
          </form>
        </div>

        {/* Orgs list */}
        {orgs.length === 0 && !showForm ? (
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
    </div>
  );
}

export default OrgList;
