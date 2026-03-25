import { useEffect, useState } from 'react';
import { UserCircleIcon, TrashIcon, LinkIcon, ClipboardDocumentIcon, ClipboardDocumentCheckIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { API_BASE } from '../api.js';
import '../Style/Team.css';

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="crm-icon-btn" title="Copy"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }}>
      {copied
        ? <ClipboardDocumentCheckIcon className="crm-icon crm-icon--success" />
        : <ClipboardDocumentIcon className="crm-icon" />}
    </button>
  );
}

function Team() {
  const [members, setMembers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [error, setError] = useState('');

  const [showRoleForm, setShowRoleForm] = useState(false);
  const [roleName, setRoleName] = useState('');
  const [roleError, setRoleError] = useState('');

  const [showInvForm, setShowInvForm] = useState(false);
  const [invRoleId, setInvRoleId] = useState('');
  const [invExpires, setInvExpires] = useState('');
  const [invMaxUses, setInvMaxUses] = useState('');
  const [invError, setInvError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [mRes, rRes] = await Promise.all([
        fetch(`${API_BASE}/api/team`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/roles`, { credentials: 'include' }),
      ]);
      const [m, r] = await Promise.all([mRes.json(), rRes.json()]);

      if (!mRes.ok) { setError(m?.detail || 'Failed to load'); setMembers([]); setRoles([]); return; }

      setMembers(Array.isArray(m) ? m : []);
      setRoles(Array.isArray(r) ? r : []);
      setIsOwner(Array.isArray(m) && m.some(x => x.is_me && x.is_owner));
      setError('');

      const iRes = await fetch(`${API_BASE}/api/invites`, { credentials: 'include' });
      const iData = await iRes.json();
      setInvites(iRes.ok && Array.isArray(iData) ? iData : []);
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    window.addEventListener('api-key-switched', load);
    return () => window.removeEventListener('api-key-switched', load);
  }, []);

  const createRole = async (e) => {
    e.preventDefault();
    if (!roleName.trim()) return setRoleError('Enter role name');
    const res = await fetch(`${API_BASE}/api/roles`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: roleName.trim() }),
    });
    const data = await res.json();
    if (!res.ok) return setRoleError(data.detail || 'Error');
    setRoleName(''); setShowRoleForm(false); setRoleError('');
    load();
  };

  const deleteRole = async (id) => {
    if (!confirm('Delete this role?')) return;
    const res = await fetch(`${API_BASE}/api/roles/${id}`, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) { const d = await res.json(); alert(d.detail); return; }
    load();
  };

  const changeRole = async (userId, roleId) => {
    await fetch(`${API_BASE}/api/team/role`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ crm_user_id: userId, crm_role_id: parseInt(roleId) }),
    });
    load();
  };

  const removeMember = async (userId) => {
    if (!confirm('Remove this member?')) return;
    await fetch(`${API_BASE}/api/team/${userId}`, { method: 'DELETE', credentials: 'include' });
    load();
  };

  const createInvite = async (e) => {
    e.preventDefault();
    if (!invRoleId) return setInvError('Select a role');
    const body = { crm_role_id: parseInt(invRoleId) };
    if (invExpires) body.expires_hours = parseInt(invExpires);
    if (invMaxUses) body.max_uses = parseInt(invMaxUses);
    const res = await fetch(`${API_BASE}/api/invites`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return setInvError(data.detail || 'Error');
    setInvRoleId(''); setInvExpires(''); setInvMaxUses(''); setShowInvForm(false); setInvError('');
    load();
  };

  const revokeInvite = async (id) => {
    await fetch(`${API_BASE}/api/invites/${id}`, { method: 'DELETE', credentials: 'include' });
    load();
  };

  if (error) return <div className="crm-placeholder" style={{ marginTop: 40, color: '#e3342f' }}>{error}</div>;
  if (loading) return <div className="crm-placeholder" style={{ marginTop: 80 }}>Loading…</div>;

  return (
    <>
      <h1 className="crm-page-title">Team</h1>

      <div className="crm-section">
        <h2 className="crm-section-title">Members</h2>
        <div className="crm-cards-list">
          {members.map(m => (
            <div className={`crm-card team-member-card${m.is_me ? ' team-member-card--me' : ''}`} key={m.id}>
              <UserCircleIcon className="team-member-avatar" />
              <div className="team-member-info">
                <span className="team-member-name">
                  {m.name}
                  {m.is_me && <span className="crm-badge crm-badge--light">You</span>}
                  {m.is_owner && <span className="crm-badge crm-badge--dark">Owner</span>}
                </span>
                <span className="team-member-email">{m.email}</span>
              </div>

              {isOwner && !m.is_owner
                ? <select className="team-role-select" value={m.role_id} onChange={e => changeRole(m.id, e.target.value)}>
                  {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                : <span className={`team-role-badge${m.is_owner ? ' team-role-badge--owner' : ''}`}>{m.role_name}</span>
              }

              {isOwner && !m.is_owner && (
                <button className="crm-icon-btn crm-icon-btn--danger" onClick={() => removeMember(m.id)} title="Remove">
                  <TrashIcon className="crm-icon" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {isOwner && (
        <>
          <div className="crm-section2">
            <div className="crm-section-row">
              <h2 className="crm-section-title">Roles</h2>
              <button className="crm-add-btn" onClick={() => { setShowRoleForm(v => !v); setRoleError(''); }}>
                {showRoleForm ? <XMarkIcon className="crm-add-btn-icon" /> : <PlusIcon className="crm-add-btn-icon" />}
                {showRoleForm ? 'Cancel' : 'New Role'}
              </button>
            </div>

            <div className={`crm-form-wrap${showRoleForm ? ' crm-form-wrap--open' : ''}`}>
              <form className="crm-card crm-form" onSubmit={createRole}>
                <input className="crm-input" placeholder="Role name, e.g. Analyst"
                  value={roleName} onChange={e => setRoleName(e.target.value)} maxLength={50} />
                {roleError && <span className="crm-form-error">{roleError}</span>}
                <button className="crm-submit-btn" type="submit">Create</button>
              </form>
            </div>

            <div className="crm-cards-list">
              {roles.map(r => (
                <div className="crm-card team-role-card" key={r.id}>
                  <span className="team-role-card-name">{r.name}</span>
                  {r.is_system
                    ? <span className="crm-badge crm-badge--gray">System</span>
                    : <button className="crm-icon-btn crm-icon-btn--danger" onClick={() => deleteRole(r.id)} title="Delete">
                      <TrashIcon className="crm-icon" />
                    </button>
                  }
                </div>
              ))}
            </div>
          </div>

          <div className="crm-section2">
            <div className="crm-section-row">
              <h2 className="crm-section-title">Invite Links</h2>
              <button className="crm-add-btn" onClick={() => { setShowInvForm(v => !v); setInvError(''); }}>
                {showInvForm ? <XMarkIcon className="crm-add-btn-icon" /> : <LinkIcon className="crm-add-btn-icon" />}
                {showInvForm ? 'Cancel' : 'New Invite'}
              </button>
            </div>

            <div className={`crm-form-wrap${showInvForm ? ' crm-form-wrap--open' : ''}`}>
              <form className="crm-card crm-form" onSubmit={createInvite}>
                <select className="crm-input crm-input-select" value={invRoleId} onChange={e => setInvRoleId(e.target.value)}>
                  <option value="">Select role…</option>
                  {roles.filter(r => !r.is_system).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <input className="crm-input crm-input--sm" placeholder="Expires in hours (optional)"
                  type="number" min="1" value={invExpires} onChange={e => setInvExpires(e.target.value)} />
                <input className="crm-input crm-input--sm" placeholder="Max uses (optional)"
                  type="number" min="1" value={invMaxUses} onChange={e => setInvMaxUses(e.target.value)} />
                {invError && <span className="crm-form-error">{invError}</span>}
                <button className="crm-submit-btn" type="submit">Generate</button>
              </form>
            </div>

            {invites.length > 0 && (
              <div className="crm-cards-list">
                {invites.map(inv => (
                  <div className="crm-card team-invite-card" key={inv.id}>
                    <LinkIcon className="crm-icon" />
                    <div className="team-invite-info">
                      <span className="team-invite-role">{inv.role_name}</span>
                      <code className="team-invite-url">{inv.invite_url}</code>
                      <span className="team-invite-meta">
                        Used {inv.uses}{inv.max_uses ? `/${inv.max_uses}` : ''} times
                        {inv.expires_at && ` · Expires ${new Date(inv.expires_at).toLocaleDateString()}`}
                      </span>
                    </div>
                    <CopyBtn text={inv.invite_url} />
                    <button className="crm-icon-btn crm-icon-btn--danger" onClick={() => revokeInvite(inv.id)} title="Revoke">
                      <TrashIcon className="crm-icon" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

export default Team