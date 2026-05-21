// Invite acceptance — a teammate opens /invite/:token. Requires being signed
// in (the backend matches the invite email to the logged-in account). On
// accept the user joins the org and lands on the dashboard.

import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { UsersThree } from '@phosphor-icons/react';
import { API_BASE } from './api.js';

export default function Invite() {
  const { t } = useTranslation();
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
    setErr(j.detail || t('auth.invite.acceptFailed'));
  };

  const wrap = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' };
  const card = { width: 420, maxWidth: '92vw', background: 'var(--card)', borderRadius: 24, padding: 32, textAlign: 'center', boxShadow: 'var(--shadow-card)' };
  const icon = { width: 56, height: 56, borderRadius: 16, background: 'var(--accent-tint)', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 };

  let body;
  if (state.loading) body = <p className="crm-placeholder">{t('common.loading')}</p>;
  else if (state.needLogin) body = (
    <>
      <h2 style={{ margin: '0 0 8px' }}>{t('auth.invite.invitedTitle')}</h2>
      <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 20 }}>
        {t('auth.invite.invitedText')}
      </p>
      <Link to="/login" className="crm-submit-btn" style={{ textDecoration: 'none' }}>{t('auth.invite.signIn')}</Link>
    </>
  );
  else if (state.invalid) body = (
    <>
      <h2 style={{ margin: '0 0 8px' }}>{t('auth.invite.notFoundTitle')}</h2>
      <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 20 }}>
        {t('auth.invite.notFoundText')}
      </p>
      <Link to="/dashboard" className="crm-submit-btn" style={{ textDecoration: 'none' }}>{t('auth.invite.goToDashboard')}</Link>
    </>
  );
  else if (!state.email_matches) body = (
    <>
      <h2 style={{ margin: '0 0 8px' }}>{t('auth.invite.wrongAccountTitle')}</h2>
      <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 20 }}>
        <Trans i18nKey="auth.invite.wrongAccountText" values={{ email: state.email }} components={{ 1: <b /> }} />
      </p>
      <Link to="/login" className="crm-submit-btn" style={{ textDecoration: 'none' }}>{t('auth.invite.switchAccount')}</Link>
    </>
  );
  else body = (
    <>
      <h2 style={{ margin: '0 0 8px' }}>{t('auth.invite.joinTitle', { org: state.org_name })}</h2>
      <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 20 }}>
        <Trans i18nKey="auth.invite.joinText" values={{ org: state.org_name }} components={{ 1: <b /> }} />
      </p>
      {err && <p className="auth-msg auth-msg--err" style={{ marginBottom: 12 }}>{err}</p>}
      <button className="crm-submit-btn" onClick={accept} disabled={busy}>
        {busy ? t('auth.invite.joining') : t('auth.invite.accept')}
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
