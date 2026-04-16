import { useEffect, useState, useRef, useCallback } from 'react';
import { Trash, Link, Copy, CheckCircle, Plus, X, Hash, PaperPlaneTilt, DotsThreeVertical, ShieldCheck, CaretLeft, NotePencil } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import '../../Style/Team.css';

// ── Helpers ────────────────────────────────────────────────────

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="crm-icon-btn" title="Copy"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }}>
      {copied
        ? <Copy className="crm-icon crm-icon--success" />
        : <Copy className="crm-icon" />}
    </button>
  );
}

function InitialsAvatar({ name, size = 36 }) {
  const initials = (name || '?').split(' ').filter(Boolean).map(w => w[0].toUpperCase()).slice(0, 2).join('');
  const palette = ['#f97316','#8b5cf6','#06b6d4','#10b981','#f43f5e','#3b82f6','#d946ef','#eab308'];
  const bg = palette[(name?.charCodeAt(0) ?? 0) % palette.length];
  return <div className="team-avatar" style={{ width: size, height: size, background: bg }}>{initials}</div>;
}

// ── Permissions panel ──────────────────────────────────────────

const ALL_PERMISSIONS = [
  { key: 'manage_products',  label: 'Manage Products',  desc: 'Create, edit and delete products' },
  { key: 'view_orders',      label: 'View Orders',      desc: 'See all orders in the store' },
  { key: 'manage_orders',    label: 'Manage Orders',    desc: 'Update order status and details' },
  { key: 'view_analytics',   label: 'View Analytics',   desc: 'Access revenue and visit statistics' },
  { key: 'manage_discounts', label: 'Manage Discounts', desc: 'Create and delete promo codes' },
  { key: 'manage_invites',   label: 'Manage Invites',   desc: 'Create and revoke invite links' },
];

function PermissionsPanel({ role, onClose }) {
  const [enabled, setEnabled] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/roles/${role.id}/permissions`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => { setEnabled(new Set(data.permissions || [])); setLoading(false); })
      .catch(() => setLoading(false));
  }, [role.id]);

  const toggle = (key) => setEnabled(prev => {
    const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next;
  });

  const save = async () => {
    setSaving(true);
    await fetch(`${API_BASE}/api/roles/${role.id}/permissions`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: [...enabled] }),
    });
    setSaving(false); onClose();
  };

  return (
    <div className="team-perms-panel">
      <div className="team-perms-header">
        <ShieldCheck className="team-perms-icon" />
        <span className="team-perms-title">Permissions — {role.name}</span>
        <button className="crm-icon-btn" onClick={onClose}><X className="crm-icon" /></button>
      </div>
      {loading ? <div className="crm-placeholder">Loading…</div> : (
        <>
          <div className="team-perms-list">
            {ALL_PERMISSIONS.map(p => (
              <div key={p.key} className="team-perm-row">
                <div className="team-perm-info">
                  <span className="team-perm-label">{p.label}</span>
                  <span className="team-perm-desc">{p.desc}</span>
                </div>
                <button type="button"
                  className={`team-perm-toggle${enabled.has(p.key) ? ' team-perm-toggle--on' : ''}`}
                  onClick={() => toggle(p.key)} />
              </div>
            ))}
          </div>
          <div className="team-perms-footer">
            <button className="crm-submit-btn" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save permissions'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Chat — WhatsApp-style two-screen mini-app ──────────────────

function ChatPanel({ isOwner }) {
  const [channels, setChannels]   = useState([]);
  const [activeId, setActiveId]   = useState(null);   // null = list view
  const [messages, setMessages]   = useState([]);
  const [newMsg, setNewMsg]       = useState('');
  const [sending, setSending]     = useState(false);
  const [showNewCh, setShowNewCh] = useState(false);
  const [chName, setChName]       = useState('');
  const [chError, setChError]     = useState('');
  const [menuChId, setMenuChId]   = useState(null);

  const menuRef      = useRef();
  const messagesEnd  = useRef();
  const pollRef      = useRef();
  const lastIdRef    = useRef(0);
  const inputRef     = useRef();

  // ── channels ──
  const loadChannels = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/chat/channels`, { credentials: 'include' });
      if (!res.ok) return;
      setChannels(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    const handleSwitch = () => { setActiveId(null); setMessages([]); loadChannels(); };
    loadChannels();
    window.addEventListener('api-key-switched', handleSwitch);
    return () => window.removeEventListener('api-key-switched', handleSwitch);
  }, [loadChannels]);

  // safety: if activeId points to a deleted/non-existent channel — go back
  useEffect(() => {
    if (activeId !== null && channels.length > 0 && !channels.some(c => c.id === activeId)) {
      setActiveId(null);
      setMessages([]);
    }
  }, [channels, activeId]);

  // ── messages ──
  const loadMessages = useCallback(async (channelId, full = false) => {
    if (!channelId) return;
    try {
      const url = full
        ? `${API_BASE}/api/chat/channels/${channelId}/messages`
        : `${API_BASE}/api/chat/channels/${channelId}/messages?after_id=${lastIdRef.current}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.length) return;
      if (full) { setMessages(data); lastIdRef.current = data.at(-1)?.id ?? 0; }
      else       { setMessages(prev => [...prev, ...data]); lastIdRef.current = data.at(-1)?.id ?? lastIdRef.current; }
    } catch {}
  }, []);

  useEffect(() => {
    if (!activeId) { clearInterval(pollRef.current); return; }
    lastIdRef.current = 0;
    loadMessages(activeId, true);
    clearInterval(pollRef.current);
    pollRef.current = setInterval(() => loadMessages(activeId, false), 4000);
    return () => clearInterval(pollRef.current);
  }, [activeId, loadMessages]);

  useEffect(() => { messagesEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    const h = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuChId(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // ── navigate ──
  const openChannel = (id) => { setActiveId(id); };
  const goBack      = ()   => { setActiveId(null); setMessages([]); };

  // ── send ──
  const sendMessage = async (e) => {
    e?.preventDefault();
    const msg = newMsg.trim();
    if (!msg || !activeId || sending) return;
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/api/chat/channels/${activeId}/messages`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      if (res.ok) {
        const m = await res.json();
        setMessages(prev => [...prev, m]);
        lastIdRef.current = m.id;
        setNewMsg('');
        inputRef.current?.focus();
      }
    } finally { setSending(false); }
  };

  const createChannel = async (e) => {
    e.preventDefault();
    if (!chName.trim()) return setChError('Enter channel name');
    setChError('');
    try {
      const res = await fetch(`${API_BASE}/api/chat/channels`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: chName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) return setChError(data.detail || 'Error');
      setChannels(prev => [...prev, data]);
      setChName(''); setShowNewCh(false);
      openChannel(data.id);
    } catch { setChError('Network error'); }
  };

  const deleteChannel = async (id) => {
    if (!confirm('Delete this channel?')) return;
    const res = await fetch(`${API_BASE}/api/chat/channels/${id}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) {
      setChannels(prev => prev.filter(c => c.id !== id));
      if (activeId === id) goBack();
    }
    setMenuChId(null);
  };

  const fmtTime = (ts) => new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  const fmtDate = (ts) => {
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return fmtTime(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const activeChannel = channels.find(c => c.id === activeId);

  // last message per channel (for list preview)
  const lastMsgMap = {};  // would need API, skip for now

  return (
    <div className="chat-app">

      {/* ── SCREEN 1: Channel list ══ */}
      <div className={`chat-screen chat-screen--list${activeId !== null ? ' chat-hidden' : ''}`}>
          {/* Header */}
          <div className="chat-app-header">
            <span className="chat-app-title">Team Chat</span>
            {isOwner && (
              <button className="chat-app-action" onClick={() => setShowNewCh(v => !v)} title="New channel">
                {showNewCh ? <X style={{ width: 20, height: 20 }} /> : <NotePencil style={{ width: 20, height: 20 }} />}
              </button>
            )}
          </div>

          {/* New channel inline form */}
          {showNewCh && (
            <form className="chat-new-ch-form" onSubmit={createChannel}>
              <div className="chat-new-ch-row">
                <Hash style={{ width: 14, height: 14, color: '#8e8e93', flexShrink: 0 }} />
                <input
                  className="chat-new-ch-input"
                  placeholder="channel-name"
                  value={chName}
                  onChange={e => setChName(e.target.value)}
                  maxLength={50}
                  autoFocus
                />
                <button className="chat-new-ch-btn" type="submit">Create</button>
              </div>
              {chError && <span style={{ fontSize: 11, color: '#e3342f', padding: '0 16px 8px' }}>{chError}</span>}
            </form>
          )}

          {/* Channel list */}
          <div className="chat-channel-list">
            {channels.length === 0 && (
              <div className="chat-list-empty">No channels yet</div>
            )}
            {channels.map((ch, i) => (
              <div key={ch.id} className="chat-ch-item-wrap" ref={menuChId === ch.id ? menuRef : null}>
                <button className="chat-ch-row" onClick={() => openChannel(ch.id)}>
                  <div className="chat-ch-icon-wrap">
                    <Hash style={{ width: 18, height: 18, color: '#fff' }} />
                  </div>
                  <div className="chat-ch-info">
                    <span className="chat-ch-name">{ch.name}</span>
                    <span className="chat-ch-preview">Tap to open chat</span>
                  </div>
                  <div className="chat-ch-meta">
                    {isOwner && !ch.is_general && (
                      <button
                        className="chat-ch-dots"
                        onClick={e => { e.stopPropagation(); setMenuChId(menuChId === ch.id ? null : ch.id); }}
                      >
                        <DotsThreeVertical style={{ width: 16, height: 16 }} />
                      </button>
                    )}
                  </div>
                </button>
                {i < channels.length - 1 && <div className="chat-ch-sep" />}
                {menuChId === ch.id && (
                  <div className="chat-ctx-menu">
                    <button className="chat-ctx-item chat-ctx-item--danger" onClick={() => deleteChannel(ch.id)}>
                      <Trash style={{ width: 14, height: 14 }} /> Delete channel
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

      {/* ══ SCREEN 2: Chat view ══ */}
      <div className={`chat-screen chat-screen--chat${activeId !== null ? ' chat-visible' : ''}`}>
          {/* Chat header */}
          <div className="chat-app-header chat-app-header--chat">
            <button className="chat-back-btn" onClick={goBack}>
              <CaretLeft style={{ width: 20, height: 20 }} />
              <span>Back</span>
            </button>
            <div className="chat-app-header-center">
              <div className="chat-ch-icon-wrap chat-ch-icon-wrap--sm">
                <Hash style={{ width: 14, height: 14, color: '#fff' }} />
              </div>
              <span className="chat-app-header-name">{activeChannel?.name ?? ''}</span>
            </div>
            <div style={{ width: 70 }} />
          </div>

          {/* Messages */}
          <div className="chat-messages">
            {messages.length === 0 && activeId && (
              <div className="chat-msg-empty">No messages yet. Say hi! 👋</div>
            )}
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const grouped = prev && prev.user_id === m.user_id
                && (new Date(m.created_at) - new Date(prev.created_at)) < 5 * 60 * 1000;
              return (
                <div key={m.id} className={`chat-msg${m.is_me ? ' chat-msg--me' : ' chat-msg--them'}${grouped ? ' chat-msg--grouped' : ''}`}>
                  {!m.is_me && !grouped && (
                    <div className="chat-msg-meta">
                      <InitialsAvatar name={m.user_name} size={24} />
                      <span className="chat-msg-author">{m.user_name}</span>
                    </div>
                  )}
                  <div className="chat-msg-row">
                    <div className={`chat-bubble${m.is_me ? ' chat-bubble--me' : ' chat-bubble--them'}`}>
                      {m.message}
                    </div>
                    <span className="chat-ts">{fmtTime(m.created_at)}</span>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEnd} />
          </div>

          {/* Input */}
          <form className="chat-input-row" onSubmit={sendMessage}>
            <input
              ref={inputRef}
              className="chat-input"
              placeholder={activeChannel ? `Message #${activeChannel.name}` : 'Type a message…'}
              value={newMsg}
              onChange={e => setNewMsg(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              maxLength={2000}
            />
            <button
              className={`chat-send-btn${newMsg.trim() ? ' chat-send-btn--on' : ''}`}
              type="submit"
              disabled={sending || !newMsg.trim()}
            >
              <PaperPlaneTilt style={{ width: 16, height: 16 }} />
            </button>
          </form>
      </div>

    </div>
  );
}

// ── Team page ──────────────────────────────────────────────────

function Team() {
  const [members, setMembers]       = useState([]);
  const [roles, setRoles]           = useState([]);
  const [invites, setInvites]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [isOwner, setIsOwner]       = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [error, setError]           = useState('');

  const [showRoleForm, setShowRoleForm] = useState(false);
  const [roleName, setRoleName]     = useState('');
  const [roleError, setRoleError]   = useState('');

  const [showInvForm, setShowInvForm] = useState(false);
  const [invRoleId, setInvRoleId]   = useState('');
  const [invExpires, setInvExpires] = useState('');
  const [invMaxUses, setInvMaxUses] = useState('');
  const [invError, setInvError]     = useState('');

  const [memberMenuId, setMemberMenuId] = useState(null);
  const memberMenuRef = useRef();
  const [permsRoleId, setPermsRoleId]   = useState(null);

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
      const me = Array.isArray(m) && m.find(x => x.is_me);
      setIsOwner(!!me?.is_owner);
      setCurrentUserId(me?.id ?? null);
      setError('');
      const iRes  = await fetch(`${API_BASE}/api/invites`, { credentials: 'include' });
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

  useEffect(() => {
    const h = (e) => { if (memberMenuRef.current && !memberMenuRef.current.contains(e.target)) setMemberMenuId(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
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
    setRoleName(''); setShowRoleForm(false); setRoleError(''); load();
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
    setMemberMenuId(null); load();
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
    setInvRoleId(''); setInvExpires(''); setInvMaxUses(''); setShowInvForm(false); setInvError(''); load();
  };

  const revokeInvite = async (id) => {
    await fetch(`${API_BASE}/api/invites/${id}`, { method: 'DELETE', credentials: 'include' });
    load();
  };

  if (error)   return <div className="crm-placeholder" style={{ marginTop: 40, color: '#e3342f' }}>{error}</div>;
  if (loading) return <div className="crm-placeholder" style={{ marginTop: 80 }}>Loading…</div>;

  return (
    <div className="team-page">

      {/* ══ Left ══ */}
      <div className="team-center">
        <h1 className="team-title">Team</h1>

        {/* Members */}
        <div className="team-members-wrapper">
          <div className="team-members-head">
            <span>Name</span><span>Role</span><span />
          </div>
          <div className="team-members-card">
            <div className="team-members-scroll">
              {members.reduce((acc, m, i) => {
                const showDivider = i > 0 && !m.is_me && !members[i - 1]?.is_me;
                return [
                  ...acc,
                  showDivider && <div key={`d-${m.id}`} className="team-row-divider" />,
                  <div key={m.id} className={`team-member-row${m.is_me ? ' team-member-row--me' : ''}`}>
                    <div className="team-member-identity">
                      <InitialsAvatar name={m.name} size={40} />
                      <div className="team-member-info">
                        <span className="team-member-name">
                          {m.name}
                          {m.is_me && <span className="crm-badge crm-badge--light">You</span>}
                        </span>
                        <span className="team-member-email">{m.email}</span>
                      </div>
                    </div>
                    {isOwner && !m.is_owner
                      ? <select className="team-role-select" value={m.role_id} onChange={e => changeRole(m.id, e.target.value)}>
                          {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                      : <span className={`team-role-badge${m.is_owner ? ' team-role-badge--owner' : ''}`}>{m.role_name}</span>
                    }
                    <div className="team-member-actions">
                      {isOwner && !m.is_owner && (
                        <div className="team-member-menu-wrap" ref={memberMenuId === m.id ? memberMenuRef : null}>
                          <button className="crm-icon-btn crm-icon-btn--danger"
                            onClick={() => setMemberMenuId(memberMenuId === m.id ? null : m.id)}>
                            <DotsThreeVertical className="crm-icon" />
                          </button>
                          {memberMenuId === m.id && (
                            <div className="api-drop-menu">
                              <button className="api-drop-item api-drop-item--danger" onClick={() => removeMember(m.id)}>
                                <Trash className="api-drop-icon" /> Remove member
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>,
                ];
              }, [])}
            </div>
          </div>
        </div>

        {isOwner && (
          <>
            {/* Roles */}
            <div className="team-section">
              <div className="team-section-header">
                <h2 className="team-section-title">Roles</h2>
                <button className="crm-add-btn" onClick={() => { setShowRoleForm(v => !v); setRoleError(''); }}>
                  {showRoleForm ? <><X className="crm-add-btn-icon" />Cancel</> : <><Plus className="crm-add-btn-icon" />New Role</>}
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
              <div className="team-roles-card">
                {roles.map(r => (
                  <div key={r.id}>
                    <div className="team-role-row">
                      <span className="team-role-card-name">{r.name}</span>
                      <div className="team-role-card-actions">
                        {!r.is_system && (
                          <button className={`crm-icon-btn team-perms-btn${permsRoleId === r.id ? ' team-perms-btn--active' : ''}`}
                            onClick={() => setPermsRoleId(permsRoleId === r.id ? null : r.id)}>
                            <ShieldCheck className="crm-icon" />
                          </button>
                        )}
                        {r.is_system
                          ? <span className="crm-badge crm-badge--gray">System</span>
                          : <button className="crm-icon-btn crm-icon-btn--danger" onClick={() => deleteRole(r.id)}>
                              <Trash className="crm-icon" />
                            </button>}
                      </div>
                    </div>
                    {permsRoleId === r.id && <PermissionsPanel role={r} onClose={() => setPermsRoleId(null)} />}
                  </div>
                ))}
              </div>
            </div>

            {/* Invites */}
            <div className="team-section">
              <div className="team-section-header">
                <h2 className="team-section-title">Invite Links</h2>
                <button className="crm-add-btn" onClick={() => { setShowInvForm(v => !v); setInvError(''); }}>
                  {showInvForm ? <><X className="crm-add-btn-icon" />Cancel</> : <><Link className="crm-add-btn-icon" />New Invite</>}
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
                <div className="team-invites-card">
                  {invites.map(inv => (
                    <div className="team-invite-row" key={inv.id}>
                      <Link className="crm-icon" style={{ flexShrink: 0 }} />
                      <div className="team-invite-info">
                        <span className="team-invite-role">{inv.role_name}</span>
                        <code className="team-invite-url">{inv.invite_url}</code>
                        <span className="team-invite-meta">
                          Used {inv.uses}{inv.max_uses ? `/${inv.max_uses}` : ''} times
                          {inv.expires_at && ` · Expires ${new Date(inv.expires_at).toLocaleDateString()}`}
                        </span>
                      </div>
                      <CopyBtn text={inv.invite_url} />
                      <button className="crm-icon-btn crm-icon-btn--danger" onClick={() => revokeInvite(inv.id)}>
                        <Trash className="crm-icon" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ══ Right: chat app ══ */}
      <div className="team-right">
        <ChatPanel isOwner={isOwner} currentUserId={currentUserId} />
      </div>

    </div>
  );
}

export default Team;
