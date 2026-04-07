import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Plus, FolderSimple, ArrowLeft } from '@phosphor-icons/react';
import { API_BASE } from '../api.js';

function OrgPage() {
  const { orgSlug }  = useParams();
  const navigate     = useNavigate();
  const [org,        setOrg]        = useState(null);
  const [projects,   setProjects]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showForm,   setShowForm]   = useState(false);
  const [newName,    setNewName]    = useState('');
  const [newUrl,     setNewUrl]     = useState('');
  const [creating,   setCreating]   = useState(false);
  const [err,        setErr]        = useState('');

  useEffect(() => {
    fetch(`${API_BASE}/api/me`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error('auth'); })
      .catch(() => navigate('/login'));

    fetch(`${API_BASE}/api/orgs/by-slug/${orgSlug}`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error('org'); return r.json(); })
      .then(orgData => {
        setOrg(orgData);
        return fetch(`${API_BASE}/api/orgs/${orgData.id}/projects`, { credentials: 'include' });
      })
      .then(r => r.json())
      .then(data => setProjects(Array.isArray(data) ? data : []))
      .catch(() => navigate('/dashboard'))
      .finally(() => setLoading(false));
  }, [orgSlug, navigate]);

  const createProject = async (e) => {
    e.preventDefault();
    const name = newName.trim();
    const url  = newUrl.trim();
    if (!name) return setErr('Name is required');
    if (!url)  return setErr('Frontend URL is required');
    setCreating(true); setErr('');
    try {
      const res  = await fetch(`${API_BASE}/api/orgs/${org.id}/projects`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, frontend_url: url }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.detail || 'Error'); return; }
      setProjects(prev => [data, ...prev]);
      setNewName(''); setNewUrl('');
      setShowForm(false);
    } catch { setErr('Network error'); }
    finally { setCreating(false); }
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
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 32px', height: 56, background: '#fff',
        borderBottom: '1px solid #e5e5e5', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <Link to="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#555', textDecoration: 'none', fontSize: 14 }}>
          <ArrowLeft size={16} />
          Organizations
        </Link>
        <span style={{ color: '#ccc' }}>/</span>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{org?.name}</span>
      </header>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '40px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{org?.name}</h1>
            <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>
              Select a project to open its console
            </p>
          </div>
          <button className="crm-add-btn" onClick={() => { setShowForm(v => !v); setErr(''); }}>
            <Plus className="crm-add-btn-icon" />
            New Project
          </button>
        </div>

        {/* Create form */}
        <div className={`crm-form-wrap${showForm ? ' crm-form-wrap--open' : ''}`} style={{ marginBottom: 24 }}>
          <form className="crm-form" onSubmit={createProject}>
            <input
              className="crm-input"
              placeholder="Project name, e.g. Nike Almaty"
              value={newName}
              onChange={e => { setNewName(e.target.value); setErr(''); }}
              maxLength={100}
              autoFocus={showForm}
            />
            <input
              className="crm-input"
              placeholder="Store frontend URL, e.g. http://localhost:5173"
              value={newUrl}
              onChange={e => { setNewUrl(e.target.value); setErr(''); }}
              autoComplete="off"
            />
            {err && <span className="crm-form-error">{err}</span>}
            <button className="crm-submit-btn" type="submit" disabled={creating}>
              {creating ? 'Creating…' : 'Create project'}
            </button>
          </form>
        </div>

        {/* Projects list */}
        {projects.length === 0 && !showForm ? (
          <div className="crm-placeholder">
            No projects yet. Create one to get started.
          </div>
        ) : (
          <div className="crm-cards-list">
            {projects.map(p => (
              <div
                key={p.id}
                className="crm-section-row"
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/project/${p.api_key}`)}
              >
                <FolderSimple size={20} style={{ color: '#555', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: '#aaa', fontFamily: 'monospace', marginTop: 2 }}>
                    {p.api_key.slice(0, 16)}…
                  </div>
                </div>
                <span style={{ fontSize: 12, color: p.is_active ? '#16a34a' : '#aaa' }}>
                  {p.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default OrgPage;
