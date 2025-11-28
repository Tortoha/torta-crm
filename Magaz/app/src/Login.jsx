import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import "./Style/Login.css";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordErrors, setPasswordErrors] = useState([]);
  const [generalError, setGeneralError] = useState("");
  const navigate = useNavigate();

  const emailFormatRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}$/;

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
  };

  const isValid = (
    !emailError && passwordErrors.length === 0 &&
    email.length >= 5 && password.length >= 8
  );

  const handleLogin = async (e) => {
    e.preventDefault();
    setGeneralError("");
    if (!isValid) return;
    try {
      const res = await fetch("/api/login", {  // ИЗМЕНЕНО!
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password })
      });
      if (res.ok) {
        navigate("/");
        window.location.reload();
      } else {
        const data = await res.json();
        setGeneralError(data.detail || "Login failed");
      }
    } catch {
      setGeneralError("Network error");
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
              <input
                type="password"
                id="password"
                name="password"
                placeholder="Password"
                value={password}
                onChange={handlePasswordChange}
                autoComplete="current-password"
                required
              />
              {passwordErrors.length > 0 && passwordErrors.map((err, idx) => (
                <p className="error" key={idx}>{err}</p>
              ))}
            </div>
            {generalError && <p className="error">{generalError}</p>}
            <div className="secsh1">
              <input className="button1" type="submit" value="Next" disabled={!isValid} />
            </div>
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