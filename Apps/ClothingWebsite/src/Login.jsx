import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import "./Style/Login.css";
import { client, pickError } from "./api.js"
import PasswordInput from "./Elements/PasswordInput";
import GoogleAuthButton from "./Elements/GoogleAuthButton";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordErrors, setPasswordErrors] = useState([]);
  const [generalError, setGeneralError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const emailFormatRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}$/;
  const handleEmailChange = (e) => {
    const value = e.target.value;
    setEmail(value);
    setEmailError(value && !emailFormatRegex.test(value) ? "Incorrect email" : "");
  };

  const validatePassword = (pwd) => {
    if (/\s/.test(pwd))                   return ['No spaces allowed'];
    if (pwd.length < 8 || pwd.length > 24) return ['Must be 8-24 characters'];
    if (!/[\p{L}]/u.test(pwd))            return ['Must contain at least 1 letter'];
    if (!/\d/.test(pwd))                  return ['Must contain at least 1 digit'];
    return [];
  };

  const handlePasswordChange = (e) => {
    const value = e.target.value;
    setPassword(value);
    setPasswordErrors(validatePassword(value));
  };

  const isValid =
    !emailError &&
    passwordErrors.length === 0 &&
    email.length >= 1 &&
    password.length >= 1;

  const handleLogin = async (e) => {
    e.preventDefault();
    setGeneralError("");
    if (!isValid) return;
    setLoading(true);

    try {
      const { ok, data } = await client.auth.sendCode({ email, password, type: "login" });

      if (ok) {
        localStorage.setItem("pendingEmail", email);
        localStorage.setItem("pendingVerificationType", "login");
        const resendSeconds = Number(data.resend_available_in || 60);
        localStorage.setItem("pendingResendUntil", String(Date.now() + resendSeconds * 1000));
        navigate("/login/verification");
      } else {
        setGeneralError(pickError(data, "Login failed"));
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
        <h1>Sign In</h1>
        <div className="reg">
          <form onSubmit={handleLogin}>
            <div className="secsh">
              <input
                type="email"
                id="email"
                name="email"
                placeholder="example@email.com"
                value={email}
                onChange={handleEmailChange}
                autoComplete="username"
                required
              />
              {emailError && <p className="error">{emailError}</p>}
            </div>

            <div className="secsh0">
              <PasswordInput
                id="password"
                name="password"
                placeholder="Password"
                value={password}
                onChange={handlePasswordChange}
                autoComplete="current-password"
              />
              {passwordErrors.length > 0 &&
                passwordErrors.map((err, idx) => (
                  <p className="error" key={idx}>{err}</p>
                ))}
            </div>

            <div className="auth-link-wrap">
              <Link to="/forgot-password" className="auth-link">
                Forgot your password?
              </Link>
            </div>

            {generalError && <p className="error">{generalError}</p>}

            <div className="secsh1">
              <input
                className={isValid && !loading ? "button1" : "not-button"}
                type="submit"
                value={loading ? "Sending..." : "Next"}
                disabled={!isValid || loading}
              />
            </div>

            <GoogleAuthButton />

            <div className="secsh1">
              <Link to="/registration">
                <input className="button2" type="button" value="Create account" />
              </Link>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

export default Login
