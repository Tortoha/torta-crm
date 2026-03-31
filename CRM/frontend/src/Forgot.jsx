import React, { useState } from "react";
import { Link } from "react-router-dom";
import "./Style/Login.css";
import { API_BASE } from "./api.js"

function Forgot() {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [generalError, setGeneralError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const emailFormatRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}$/;

  const handleEmailChange = (e) => {
    const value = e.target.value;
    setEmail(value);
    setEmailError(value && !emailFormatRegex.test(value) ? "Incorrect email" : "");
    setGeneralError("");
    setSuccessMessage("");
  };

  const isValid = !emailError && email.length >= 1;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setGeneralError("");
    setSuccessMessage("");

    if (!isValid) return;

    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (res.ok) {
        setSuccessMessage(
          data.message || "If the account exists, a password reset email has been sent."
        );
      } else {
        setGeneralError(data.detail || "Failed to send reset email");
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
        <h1>Forgot Password</h1>
        <p className="verify-p">Enter your email to receive a reset link</p>

        <div className="reg">
          <form onSubmit={handleSubmit}>
            <div className="secsh2">
              <input
                type="email"
                id="email"
                name="email"
                placeholder="example@email.com"
                value={email}
                onChange={handleEmailChange}
                autoComplete="email"
                required
              />
              {emailError && <p className="error">{emailError}</p>}
            </div>

            {generalError && <p className="error">{generalError}</p>}
            {successMessage && <p className="success-message">{successMessage}</p>}

            <div className="secsh1">
              <input
                className={isValid && !loading ? "button1" : "not-button"}
                type="submit"
                value={loading ? "Sending..." : "Send reset link"}
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
      </section>
    </div>
  );
}

export default Forgot