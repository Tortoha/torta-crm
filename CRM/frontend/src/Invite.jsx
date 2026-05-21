// Invite acceptance — a teammate opens /invite/:token. Requires being signed
// in (the backend matches the invite email to the logged-in account). On
// accept the user joins the org and lands on the dashboard.

import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { UsersThree } from '@phosphor-icons/react';
import { API_BASE } from './api.js';

export default function Invite() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch(`${API_BASE}/api/invites/${token}`, { credentials: 'include' })
      .then(async r => {
        if (r.status === 401) { setState({ loading: false, needLogin: true }); return; }
        if (!r.ok) { setState({ loading: false, invalid: true }); return; }
        setState({ loading: false, ...(await r.json()) });
      })
      .catch(() => setState({ loading: false, invalid: true }));
  }, [token]);

  const accept = async () => {
    setBusy(true); setErr('');
    const r = await fetch(`${API_BASE}/api/invites/${token}/accept`, {
      method: 'POST', credentials: 'include',
    });
    setBusy(false);
    if (r.ok) { navigate('/dashboard'); return; }
    const j = await r.json().catch(() => ({}));
    setErr(j.detail || 'Could not accept the invitation');
  };

  const wrap = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' };
  const card = { width: 420, maxWidth: '92vw', background: 'var(--card)', borderRadius: 24, padding: 32, textAlign: 'center', boxShadow: 'var(--shadow-card)' };
  const icon = { width: 56, height: 56, borderRadius: 16, background: 'var(--accent-tint)', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 };

  let body;
  if (state.loading) body = <p className="crm-placeholder">Loading…</p>;
  else if (state.needLogin) body = (
    <>
      <h2 style={{ margin: '0 0 8px' }}>You've been invited</h2>
      <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 20 }}>
        Sign in to accept this invitation, then open this link again.
      </p>
      <Link to="/login" className="crm-submit-btn" style={{ textDecoration: 'none' }}>Sign in</Link>
    </>
  );
  else if (state.invalid) body = (
    <>
      <h2 style={{ margin: '0 0 8px' }}>Invitation not found</h2>
      <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 20 }}>
        This invitation is no longer valid or has already been used.
      </p>
      <Link to="/dashboard" className="crm-submit-btn" style={{ textDecoration: 'none' }}>Go to dashboard</Link>
    </>
  );
  else if (!state.email_matches) body = (
    <>
      <h2 style={{ margin: '0 0 8px' }}>Wrong account</h2>
      <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 20 }}>
        This invitation was sent to <b>{state.email}</b>. Sign in with that account to accept it.
      </p>
      <Link to="/login" className="crm-submit-btn" style={{ textDecoration: 'none' }}>Switch account</Link>
    </>
  );
  else body = (
    <>
      <h2 style={{ margin: '0 0 8px' }}>Join {state.org_name}</h2>
      <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 20 }}>
        You've been invited to join <b>{state.org_name}</b> as a team member.
      </p>
      {err && <p className="auth-msg auth-msg--err" style={{ marginBottom: 12 }}>{err}</p>}
      <button className="crm-submit-btn" onClick={accept} disabled={busy}>
        {busy ? 'Joining…' : 'Accept invitation'}
      </button>
    </>
  );

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={icon}><UsersThree size={28} weight="fill" /></div>
        <div>{body}</div>
      </div>
    </div>
  );
}
