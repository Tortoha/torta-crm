import React, { useEffect, useState } from "react";
import { useNavigate, Link, useParams } from "react-router-dom";
import { useTranslation } from 'react-i18next';
import "./Style/Login.css";
import PasswordInput from "./Elements/PasswordInput.jsx";

import { API_BASE } from "./api.js"

function Reset() {
  const { t } = useTranslation();
  const { token } = useParams();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [passwordErrors, setPasswordErrors] = useState([]);
  const [repeatError, setRepeatError] = useState("");
  const [generalError, setGeneralError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);

  const validatePassword = (pwd) => {
    if (/\s/.test(pwd))                   return [t('auth.validation.noSpaces')];
    if (pwd.length < 8 || pwd.length > 24) return [t('auth.validation.length')];
    if (!/[\p{L}]/u.test(pwd))            return [t('auth.validation.needLetter')];
    if (!/\d/.test(pwd))                  return [t('auth.validation.needDigit')];
    return [];
  };

  useEffect(() => {
    let ignore = false;
    fetch(`${API_BASE}/api/reset-password/validate/${token}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ignore) return;
        if (ok) setEmail(data.email || "");
        else setGeneralError(data.detail || t('auth.reset.invalidLink'));
      })
      .catch(() => { if (!ignore) setGeneralError(t('auth.common.networkError')); })
      .finally(() => { if (!ignore) setPageLoading(false); });
    return () => { ignore = true; };
  }, [token]);

  const handlePasswordChange = (e) => {
    const value = e.target.value;
    setPassword(value);
    setPasswordErrors(validatePassword(value));
    setRepeatError(repeatPassword && value !== repeatPassword ? t('auth.validation.passwordsMismatch') : "");
    setGeneralError("");
  };

  const handleRepeatPasswordChange = (e) => {
    const value = e.target.value;
    setRepeatPassword(value);
    setRepeatError(value !== password ? t('auth.validation.passwordsMismatch') : "");
    setGeneralError("");
  };

  const isValid =
    password.length >= 1 &&
    repeatPassword.length >= 1 &&
    passwordErrors.length === 0 &&
    !repeatError;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setGeneralError("");
    setSuccessMessage("");
    if (!isValid) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, repeat_password: repeatPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMessage(t('auth.reset.success'));
        setTimeout(() => navigate("/login"), 1200);
      } else {
        setGeneralError(data.detail || t('auth.reset.failed'));
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
        <h1 className="verify-h1">{t('auth.reset.title')}</h1>

        {/* Страница загружается — токен проверяется */}
        {pageLoading && (
          <div className="reg">
            <div className="secsh2">
              <p className="loading-text">{t('auth.reset.loading')}</p>
            </div>
          </div>
        )}

        {/* Токен невалиден */}
        {!pageLoading && !email && (
          <div className="reg">
            <div className="secsh2">
              <p className="error">{generalError}</p>
            </div>
            <div className="secsh1">
              <Link to="/login">
                <input className="button2" type="button" value={t('auth.reset.backToSignIn')} />
              </Link>
            </div>
          </div>
        )}

        {/* Основная форма */}
        {!pageLoading && email && (
          <>
            <p className="verify-p">{t('auth.reset.subtitle')}</p>
            <p className="verify-email">{email}</p>

            <div className="reg">
              <form onSubmit={handleSubmit}>
                <div className="secsh">
                  <PasswordInput
                    placeholder={t('auth.reset.newPasswordPlaceholder')}
                    value={password}
                    onChange={handlePasswordChange}
                    autoComplete="new-password"
                  />
                  {passwordErrors.map((err, idx) => (
                    <p className="error" key={idx}>{err}</p>
                  ))}
                </div>

                <div className="secsh0">
                  <PasswordInput
                    placeholder={t('auth.reset.repeatNewPasswordPlaceholder')}
                    value={repeatPassword}
                    onChange={handleRepeatPasswordChange}
                    autoComplete="new-password"
                  />
                  {repeatError && <p className="error">{repeatError}</p>}
                </div>

                {generalError && <p className="error">{generalError}</p>}
                {successMessage && <p className="success-message">{successMessage}</p>}

                <div className="secsh1">
                  <input
                    className={isValid && !loading ? "button1" : "not-button"}
                    type="submit"
                    value={loading ? t('auth.reset.saving') : t('auth.reset.savePassword')}
                    disabled={!isValid || loading}
                  />
                </div>

                <div className="secsh1">
                  <Link to="/login">
                    <input className="button2" type="button" value={t('auth.reset.backToSignIn')} />
                  </Link>
                </div>
              </form>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default Reset