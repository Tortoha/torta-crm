import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import "./Style/Login.css";
import { client } from "./api.js"
import PasswordInput from "./Elements/PasswordInput";

function Regis() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [nameError, setNameError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordErrors, setPasswordErrors] = useState([]);
  const [repeatError, setRepeatError] = useState("");
  const [generalError, setGeneralError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const emailFormatRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}$/;
  const handleNameChange = (e) => {
    const value = e.target.value;
    setName(value);

    if (value.length > 20) {
      setNameError("No more than 20 characters");
    } else {
      setNameError("");
    }
  };

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

    setRepeatError(
      repeatPassword && value !== repeatPassword ? "Passwords do not match" : ""
    );
  };

  const handleRepeatPasswordChange = (e) => {
    const value = e.target.value;
    setRepeatPassword(value);
    setRepeatError(value !== password ? "Passwords do not match" : "");
  };

  const isValid =
    !nameError &&
    !emailError &&
    passwordErrors.length === 0 &&
    !repeatError &&
    name.length >= 1 &&
    email.length >= 1 &&
    password.length >= 1 &&
    password === repeatPassword;

  const handleRegister = async (e) => {
    e.preventDefault();
    setGeneralError("");

    if (!isValid) return;

    setLoading(true);

    try {
      const { ok, data } = await client.auth.sendCode({ name, email, password, type: "register" });

      if (ok) {
        localStorage.setItem("pendingEmail", email);
        localStorage.setItem("pendingVerificationType", "register");

        const resendSeconds = Number(data.resend_available_in || 60);
        const resendUntil = Date.now() + resendSeconds * 1000;
        localStorage.setItem("pendingResendUntil", String(resendUntil));

        navigate("/registration/verification");
      } else {
        setGeneralError(data?.detail || "Registration failed");
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
        <h1>Create Account</h1>
        <div className="reg" id="r">
          <form onSubmit={handleRegister}>
            <div className="secsh2">
              <input
                type="text"
                id="username"
                name="username"
                placeholder="Your name"
                value={name}
                onChange={handleNameChange}
                required
              />
              {nameError && <p className="error">{nameError}</p>}
            </div>

            <div className="secsh0">
              <input
                type="email"
                id="email"
                name="email"
                placeholder="example@email.com"
                value={email}
                onChange={handleEmailChange}
                required
              />
              {emailError && <p className="error">{emailError}</p>}
            </div>

            <div className="secsh0">
              <PasswordInput
                id="password"
                name="password"
                placeholder="Create password"
                value={password}
                onChange={handlePasswordChange}
              />
              {passwordErrors.length > 0 &&
                passwordErrors.map((err, idx) => (
                  <p className="error" key={idx}>{err}</p>
                ))}
            </div>

            <div className="secsh0">
              <PasswordInput
                id="repeatPassword"
                name="repeatPassword"
                placeholder="Repeat password"
                value={repeatPassword}
                onChange={handleRepeatPasswordChange}
              />
              {repeatError && <p className="error">{repeatError}</p>}
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

            <div className="secsh1">
              <Link to="/login">
                <input className="button2" type="button" value="Sign in" />
              </Link>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

export default Regis
