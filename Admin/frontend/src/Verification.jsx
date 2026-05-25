import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE, pickError } from './api.js';
import './Style/Login.css';

// 1:1 copy of CRM/frontend/src/Verification.jsx behaviour:
// — `formatCode` inserts a space after 3 digits ("473 219") so the user reads
//   it as two triplets. The space is purely visual; the value on submit is
//   stripped back to 6 raw digits.
// — `maxLength={7}` (6 digits + the cosmetic space). The original 6-digit
//   maxLength was the bug behind "вставил 6 → попало 5" — paste collided
//   with the formatted re-render and ate the last char.
// — handleCodeChange: strip non-digits, slice to 6.
// — onPaste: explicit handler in case the browser's autofill of one-time-code
//   bypasses the normal change path.
// — Email is NOT displayed (defence in depth — even after a correct password,
//   the page doesn't reveal which email got the OTP).
// — After success: window.location.reload() like CRM — guarantees AdminLayout
//   mounts fresh and reads the just-set cookie via /api/me.

export default function Verification() {
  const navigate = useNavigate();
  const [code, setCode]                 = useState('');
  const [generalError, setGeneralError] = useState('');
  const [loading, setLoading]           = useState(false);
  const [resending, setResending]       = useState(false);
  const [email, setEmail]               = useState('');
  const [cooldown, setCooldown]         = useState(0);

  useEffect(() => {
    const pendingEmail = localStorage.getItem('pendingEmail');
    const pendingResendUntil = Number(localStorage.getItem('pendingResendUntil') || 0);
    if (!pendingEmail) { navigate('/login'); return; }
    setEmail(pendingEmail);
    setCooldown(Math.max(0, Math.ceil((pendingResendUntil - Date.now()) / 1000)));
  }, [navigate]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((p) => (p > 0 ? p - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const formatCode = (value) =>
    value.length <= 3 ? value : value.slice(0, 3) + ' ' + value.slice(3);

  const handleCodeChange = (e) => {
    setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
    setGeneralError('');
  };

  // Hardened paste — some browsers/password managers fire `paste` without
  // a proper `change` follow-up, so we intercept and write the value directly.
  const handlePaste = (e) => {
    const pasted = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    if (pasted) {
      e.preventDefault();
      setCode(pasted);
    }
  };

  const extractSecondsFromMessage = (text) => {
    const m = String(text || '').match(/(\d+)/);
    return m ? Number(m[1]) : 60;
  };

  const isValid = code.length === 6;

  const handleVerify = async (e) => {
    e.preventDefault();
    setGeneralError('');
    if (!isValid) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        localStorage.removeItem('pendingEmail');
        localStorage.removeItem('pendingResendUntil');
        // Hard navigation (full-page reload) makes AdminLayout mount cleanly
        // with the just-set crm_token cookie. SPA navigate alone sometimes
        // races the cookie commit when StrictMode double-fires useEffect.
        window.location.href = '/';
      } else {
        setGeneralError(pickError(data, 'Verification failed'));
      }
    } catch {
      setGeneralError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setGeneralError('');
    try {
      const res = await fetch(`${API_BASE}/api/resend-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const secs = Number(data.resend_available_in || 60);
        localStorage.setItem('pendingResendUntil', String(Date.now() + secs * 1000));
        setCooldown(secs);
        setGeneralError('Code re-sent.');
      } else {
        if (res.status === 429) {
          const secs = extractSecondsFromMessage(data.detail);
          localStorage.setItem('pendingResendUntil', String(Date.now() + secs * 1000));
          setCooldown(secs);
        }
        setGeneralError(pickError(data, 'Resend failed'));
      }
    } catch {
      setGeneralError('Network error');
    } finally {
      setResending(false);
    }
  };

  const handleGoBack = () => {
    localStorage.removeItem('pendingEmail');
    localStorage.removeItem('pendingResendUntil');
    navigate('/login');
  };

  return (
    <div className="regist">
      <section className="regis">
        <h1 className="verify-h1">Verify</h1>
        <p className="verify-p">We just sent a 6-digit code to your inbox.</p>

        <div className="reg">
          <form onSubmit={handleVerify}>
            <div className="secsh">
              <input
                type="text"
                name="code"
                placeholder="000 000"
                value={formatCode(code)}
                onChange={handleCodeChange}
                onPaste={handlePaste}
                maxLength={7}
                autoComplete="one-time-code"
                inputMode="numeric"
                required
                autoFocus
                className="verify-input"
              />
            </div>

            {generalError && <p className="error" style={{ textAlign: 'center', marginTop: 12 }}>{generalError}</p>}

            <div className="secsh1">
              <input
                className={isValid && !loading ? 'button1' : 'not-button'}
                type="submit"
                value={loading ? 'Verifying…' : 'Continue'}
                disabled={!isValid || loading}
              />
            </div>

            <div className="secsh1">
              <input
                type="button"
                className={cooldown === 0 && !resending ? 'button3' : 'not-button3'}
                value={
                  resending
                    ? 'Sending…'
                    : cooldown > 0
                      ? `Resend in ${cooldown}s`
                      : 'Resend code'
                }
                onClick={handleResend}
                disabled={resending || cooldown > 0}
              />
            </div>

            <div className="secsh1">
              <input
                type="button"
                className="button2"
                value="Back"
                onClick={handleGoBack}
              />
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
