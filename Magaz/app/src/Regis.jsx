import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import "./Style/Login.css";

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
  const navigate = useNavigate();

  const emailFormatRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}$/;

  const handleNameChange = (e) => {
    const value = e.target.value.replace(/[^a-zA-Z0-9]/g, "");
    setName(value);
    if (value.length > 20) {
      setNameError("No more than 20 characters");
    } else {
      setNameError("");
    }
  };

  const handleEmailChange = (e) => {
    const value = e.target.value.replace(/[^a-zA-Z0-9._@-]/g, "");
    setEmail(value);
    setEmailError(!emailFormatRegex.test(value) ? "Incorrect email" : "");
  };

  const validatePassword = (pwd) => {
    let errors = [];
    if (pwd.length < 8 || pwd.length > 24) {
      errors.push("Must be 8–24 characters");
    }
    else if (!/[A-Za-z]/.test(pwd)) {
      errors.push("Must be at least 1 letter");
    }
    else if (!/\d/.test(pwd)) {
      errors.push("Must be at least 1 digit");
    }
    return errors;
  };

  const allowedPasswordCharsRegex = /[^A-Za-z0-9!@#$%_+-/\=]/g;

  const handlePasswordChange = (e) => {
    const value = e.target.value.replace(allowedPasswordCharsRegex, "");
    setPassword(value);
    setPasswordErrors(validatePassword(value));
    setRepeatError(repeatPassword && value !== repeatPassword
      ? "Passwords do not match" : "");
  };

  const handleRepeatPasswordChange = (e) => {
    const value = e.target.value.replace(allowedPasswordCharsRegex, "");
    setRepeatPassword(value);
    setRepeatError(value !== password ? "Passwords do not match" : "");
  };

  const isValid = (
    !nameError && !emailError &&
    passwordErrors.length === 0 && !repeatError &&
    name.length >= 1 && email.length >= 1 && password.length >= 1 && password === repeatPassword
  );

  const handleRegister = async (e) => {
    e.preventDefault();
    setGeneralError("");
    if (!isValid) return;
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, email, password })
      });
      if (res.ok) {
        navigate("/");
        window.location.reload();
      } else {
        const data = await res.json();
        setGeneralError(data.detail || "Registration failed");
      }
    } catch {
      setGeneralError("Network error");
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
              <input
                type="password"
                id="password"
                name="password"
                placeholder="Create password"
                value={password}
                onChange={handlePasswordChange}
                required
              />
              {passwordErrors.length > 0 && passwordErrors.map((err, idx) => (
                <p className="error" key={idx}>{err}</p>
              ))}
            </div>
            <div className="secsh0">
              <input
                type="password"
                id="repeatPassword"
                name="repeatPassword"
                placeholder="Repeat password"
                value={repeatPassword}
                onChange={handleRepeatPasswordChange}
                required
              />
              {repeatError && <p className="error">{repeatError}</p>}
            </div>
            {generalError && <p className="error">{generalError}</p>}
            <div className="secsh1">
              <input className={isValid ? "button1" : "not-button"} type="submit" value="Next" disabled={!isValid} />
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