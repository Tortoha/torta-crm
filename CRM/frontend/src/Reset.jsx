import React, { useEffect, useState } from "react";
import { useNavigate, Link, useParams } from "react-router-dom";
import "./Style/Login.css";
import PasswordInput from "./Elements/PasswordInput.jsx";

import { API_BASE } from "./api.js"

function Reset() {
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

  const allowedPasswordCharsRegex = /[^A-Za-z0-9!@#$%_+-/\=]/g;

  const validatePassword = (pwd) => {
    if (pwd.length < 8 || pwd.length > 24) return ["Must be 8–24 characters"];
    if (!/[A-Za-z]/.test(pwd)) return ["Must be at least 1 letter"];
    if (!/\d/.test(pwd)) return ["Must be at least 1 digit"];
    return [];
  };

  useEffect(() => {
    let ignore = false;
    fetch(`${API_BASE}/api/reset-password/validate/${token}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ignore) return;
        if (ok) setEmail(data.email || "");
        else setGeneralError(data.detail || "Invalid or expired reset link");
      })
      .catch(() => { if (!ignore) setGeneralError("Network error"); })
      .finally(() => { if (!ignore) setPageLoading(false); });
    return () => { ignore = true; };
  }, [token]);

  const handlePasswordChange = (e) => {
    const value = e.target.value.replace(allowedPasswordCharsRegex, "");
    setPassword(value);
    setPasswordErrors(validatePassword(value));
    setRepeatError(repeatPassword && value !== repeatPassword ? "Passwords do not match" : "");
    setGeneralError("");
  };

  const handleRepeatPasswordChange = (e) => {
    const value = e.target.value.replace(allowedPasswordCharsRegex, "");
    setRepeatPassword(value);
    setRepeatError(value !== password ? "Passwords do not match" : "");
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
        setSuccessMessage("Password changed successfully");
        setTimeout(() => navigate("/login"), 1200);
      } else {
        setGeneralError(data.detail || "Failed to reset password");
      }
    } catch {
      setGeneralError("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="regist">
      <section className="regis">
        <h1 className="verify-h1">Reset Password</h1>

        {/* Страница загружается — токен проверяется */}
        {pageLoading && (
          <div className="reg">
            <div className="secsh2">
              <p className="loading-text">Loading...</p>
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
                <input className="button2" type="button" value="Back to Sign in" />
              </Link>
            </div>
          </div>
        )}

        {/* Основная форма */}
        {!pageLoading && email && (
          <>
            <p className="verify-p">Create a new password for</p>
            <p className="verify-email">{email}</p>

            <div className="reg">
              <form onSubmit={handleSubmit}>
                <div className="secsh">
                  <PasswordInput
                    placeholder="New password"
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
                    placeholder="Repeat new password"
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
                    value={loading ? "Saving..." : "Save password"}
                    disabled={!isValid || loading}
                  />
                </div>

                <div className="secsh1">
                  <Link to="/login">
                    <input className="button2" type="button" value="Back to Sign in" />
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