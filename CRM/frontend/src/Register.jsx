import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from 'react-i18next';
import "./Style/Login.css";
import { API_BASE } from "./api.js";
import PasswordInput from "./Elements/PasswordInput.jsx";
import GoogleAuthButton from "./Elements/GoogleAuthButton.jsx";

function Register() {
  const { t } = useTranslation();
  const [name, setName]                     = useState("");
  const [email, setEmail]                   = useState("");
  const [password, setPassword]             = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [nameError, setNameError]           = useState("");
  const [emailError, setEmailError]         = useState("");
  const [passwordErrors, setPasswordErrors] = useState([]);
  const [repeatError, setRepeatError]       = useState("");
  const [generalError, setGeneralError]     = useState("");
  const [loading, setLoading]               = useState(false);
  const navigate = useNavigate();

  const emailFormatRegex        = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}$/;
  const handleNameChange = (e) => {
    const value = e.target.value;
    setName(value);
    setNameError(value.length > 20 ? t('auth.validation.nameTooLong') : "");
  };

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
    setRepeatError(repeatPassword && value !== repeatPassword ? t('auth.validation.passwordsMismatch') : "");
  };

  const handleRepeatPasswordChange = (e) => {
    const value = e.target.value;
    setRepeatPassword(value);
    setRepeatError(value !== password ? t('auth.validation.passwordsMismatch') : "");
  };

  const isValid =
    !nameError && !emailError && passwordErrors.length === 0 && !repeatError &&
    name.length >= 1 && email.length >= 1 &&
    password.length >= 1 && password === repeatPassword;

  const handleRegister = async (e) => {
    e.preventDefault();
    setGeneralError("");
    if (!isValid) return;
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/api/send-code`, {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ name, email, password, type: "register" }),
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem("pendingEmail", email);
        localStorage.setItem("pendingVerificationType", "register");
        localStorage.setItem("pendingResendUntil", String(Date.now() + Number(data.resend_available_in || 60) * 1000));
        navigate("/registration/verification");
      } else {
        setGeneralError(data.detail || t('auth.register.failed'));
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
        <h1>{t('auth.register.title')}</h1>
        <div className="reg" id="r">
          <form onSubmit={handleRegister}>
            <div className="secsh2">
              <input
                type="text" placeholder={t('auth.register.namePlaceholder')}
                value={name} onChange={handleNameChange} required
              />
              {nameError && <p className="error">{nameError}</p>}
            </div>
            <div className="secsh0">
              <input
                type="email" placeholder={t('auth.register.emailPlaceholder')}
                value={email} onChange={handleEmailChange} required
              />
              {emailError && <p className="error">{emailError}</p>}
            </div>
            <div className="secsh0">
              <PasswordInput
                placeholder={t('auth.register.passwordPlaceholder')} value={password}
                onChange={handlePasswordChange}
              />
              {passwordErrors.map((err, i) => <p className="error" key={i}>{err}</p>)}
            </div>
            <div className="secsh0">
              <PasswordInput
                placeholder={t('auth.register.repeatPasswordPlaceholder')} value={repeatPassword}
                onChange={handleRepeatPasswordChange}
              />
              {repeatError && <p className="error">{repeatError}</p>}
            </div>
            {generalError && <p className="error">{generalError}</p>}
            <div className="secsh1">
              <input
                className={isValid && !loading ? "button1" : "not-button"}
                type="submit" value={loading ? t('auth.register.sending') : t('auth.register.next')}
                disabled={!isValid || loading}
              />
            </div>
            <GoogleAuthButton />
            <div className="secsh1">
              <Link to="/login">
                <input className="button2" type="button" value={t('auth.register.signIn')} />
              </Link>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

export default Register