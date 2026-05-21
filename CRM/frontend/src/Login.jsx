import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from 'react-i18next';
import "./Style/Login.css";
import { API_BASE } from "./api.js";
import PasswordInput from "./Elements/PasswordInput.jsx";
import GoogleAuthButton from "./Elements/GoogleAuthButton.jsx";

function Login() {
  const { t } = useTranslation();
  const [email, setEmail]               = useState("");
  const [password, setPassword]         = useState("");
  const [emailError, setEmailError]     = useState("");
  const [passwordErrors, setPasswordErrors] = useState([]);
  const [generalError, setGeneralError] = useState("");
  const [loading, setLoading]           = useState(false);
  const navigate = useNavigate();

  const emailFormatRegex        = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}$/;
  const handleEmailChange = (e) => {
    const value = e.target.value;
    setEmail(value);
    setEmailError(value && !emailFormatRegex.test(value) ? t('auth.validation.incorrectEmail') : "");
  };

  const validatePassword = (pwd) => {
    if (/\s/.test(pwd))                   return [t('auth.validation.noSpaces')];
    if (pwd.length < 8 || pwd.length > 24) return [t('auth.validation.length')];
    if (!/[\p{L}]/u.test(pwd))            return [t('auth.validation.needLetter')];
    if (!/\d/.test(pwd))                  return [t('auth.validation.needDigit')];
    return [];
  };

  const handlePasswordChange = (e) => {
    const value = e.target.value;
    setPassword(value);
    setPasswordErrors(validatePassword(value));
  };

  const isValid =
    !emailError && passwordErrors.length === 0 &&
    email.length >= 1 && password.length >= 1;

  const handleLogin = async (e) => {
    e.preventDefault();
    setGeneralError("");
    if (!isValid) return;
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/api/send-code`, {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ email, password, type: "login" }),
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem("pendingEmail", email);
        localStorage.setItem("pendingVerificationType", "login");
        localStorage.setItem("pendingResendUntil", String(Date.now() + Number(data.resend_available_in || 60) * 1000));
        navigate("/login/verification");
      } else {
        setGeneralError(data.detail || t('auth.login.failed'));
      }
    } catch {
      setGeneralError(t('auth.common.networkError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="regist">
      <section className="regis">
        <h1>{t('auth.login.title')}</h1>
        <div className="reg">
          <form onSubmit={handleLogin}>
            <div className="secsh">
              <input
                type="email" placeholder={t('auth.login.emailPlaceholder')}
                value={email} onChange={handleEmailChange}
                autoComplete="username" required
              />
              {emailError && <p className="error">{emailError}</p>}
            </div>
            <div className="secsh0">
              <PasswordInput
                placeholder={t('auth.login.passwordPlaceholder')} value={password}
                onChange={handlePasswordChange}
                autoComplete="current-password"
              />
              {passwordErrors.map((err, i) => <p className="error" key={i}>{err}</p>)}
            </div>
            <div className="auth-link-wrap">
              <Link to="/forgot-password" className="auth-link">{t('auth.login.forgotPassword')}</Link>
            </div>
            {generalError && <p className="error">{generalError}</p>}
            <div className="secsh1">
              <input
                className={isValid && !loading ? "button1" : "not-button"}
                type="submit" value={loading ? t('auth.login.sending') : t('auth.login.next')}
                disabled={!isValid || loading}
              />
            </div>
            <GoogleAuthButton />
            <div className="secsh1">
              <Link to="/registration">
                <input className="button2" type="button" value={t('auth.login.createAccount')} />
              </Link>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

export default Login