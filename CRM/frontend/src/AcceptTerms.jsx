// Hard gate that fires for any authenticated user whose terms_accepted_at
// is still NULL — almost always Google-OAuth sign-ups, since the email
// flow records consent during verify_code. The page sits BETWEEN login
// and any actual app screen: until the consent box is ticked and
// POST /api/me/accept-terms succeeds, the user cannot reach the app.
//
// It looks like a small focused card on the page bg — no sidebar, no
// header chrome. Layout / OrgLayout / Dashboard all redirect here when
// /api/me returns terms_accepted_at === null. The page itself fetches
// /api/me on mount to bounce away if they're already accepted
// (e.g. came back via stale URL).

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { SmileyMelting } from '@phosphor-icons/react';
import { API_BASE } from './api.js';
import { trackSignup } from './Utils/ads.js';
import './Style/AcceptTerms.css';

const TERMS_VERSION = '1.0';

export default function AcceptTerms() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [user,       setUser]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [agreed1,    setAgreed1]    = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err,        setErr]        = useState('');

  // Mount: fetch /api/me — if not logged in → bounce to /login.
  // If already accepted → bounce to /dashboard. Otherwise stay on page.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/me`, { credentials: 'include' });
        if (!alive) return;
        if (!r.ok)  { navigate('/login', { replace: true }); return; }
        const u = await r.json();
        if (u?.terms_accepted_at) { navigate('/dashboard', { replace: true }); return; }
        setUser(u);
      } catch {
        if (alive) navigate('/login', { replace: true });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [navigate]);

  const canSubmit = agreed1 && !submitting;

  const handleAccept = async () => {
    if (!canSubmit) return;
    setSubmitting(true); setErr('');
    try {
      const res  = await fetch(`${API_BASE}/api/me/accept-terms`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ terms_version: TERMS_VERSION }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.detail || 'Failed to save. Try again.');
        return;
      }
      // Google Ads "Sign up" conversion for GOOGLE-OAuth registrations — this
      // page is the completion point for a new Google account (the email flow
      // fires it in Verification.jsx). terms_accepted_at was NULL to reach here
      // and is set by the call above, so this runs exactly once per new account.
      // First-time signup → tell the dashboard to auto-open "New organization".
      sessionStorage.setItem('crm_onboard_new_org', '1');
      // Navigate only AFTER the hit is sent (event_callback + timeout fallback).
      trackSignup(() => navigate('/dashboard', { replace: true }));
    } catch {
      setErr(t('auth.common.networkError'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="at-page">
        <div className="at-card">
          <p className="at-loading">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="at-page">
      <div className="at-card">

        {/* Header */}
        <div className="at-head">
          <div className="at-icon"><SmileyMelting size={28} weight="regular" /></div>
          <div className="at-head-text">
            <h1 className="at-title">{t('auth.acceptTerms.title')}</h1>
          </div>
        </div>

        {/* Single consent checkbox + soft acceptable-use note (mirrors the email sign-up form) */}
        <label className="at-check">
          <input type="checkbox" checked={agreed1} onChange={e => setAgreed1(e.target.checked)} className="at-check-box" />
          <span className="at-check-text">
            <Trans i18nKey="auth.acceptTerms.checkboxLabel"
              components={{
                terms:   <a href="/terms"   target="_blank" rel="noopener noreferrer" />,
                privacy: <a href="/privacy" target="_blank" rel="noopener noreferrer" />,
              }} />
          </span>
        </label>

        {err && <p className="at-error">{err}</p>}

        {/* Actions */}
        <div className="at-actions">
          <button type="button"
            className="at-btn at-btn--primary"
            disabled={!canSubmit}
            onClick={handleAccept}>
            {submitting ? t('auth.acceptTerms.saving') : t('auth.acceptTerms.continue')}
          </button>
        </div>
      </div>
    </div>
  );
}
