import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "./Style/Login.css";

function Verification() {
  const [code, setCode] = useState("");
  const [generalError, setGeneralError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [email, setEmail] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const pendingEmail = localStorage.getItem("pendingEmail");
    if (!pendingEmail) {
      navigate("/login");
    } else {
      setEmail(pendingEmail);
    }
  }, [navigate]);

  const formatCode = (value) => {
    if (value.length <= 3) return value;
    return value.slice(0, 3) + " " + value.slice(3);
  };

  const handleCodeChange = (e) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    setGeneralError("");
  };

  const isValid = code.length === 6;

  const handleVerify = async (e) => {
    e.preventDefault();
    setGeneralError("");
    if (!isValid) return;

    setLoading(true);

    try {
      const res = await fetch("/api/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, code })
      });

      if (res.ok) {
        localStorage.removeItem("pendingEmail");
        navigate("/");
        window.location.reload();
      } else {
        const data = await res.json();
        setGeneralError(data.detail || "Verification failed");
      }
    } catch {
      setGeneralError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setGeneralError("");

    try {
      const res = await fetch("/api/resend-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });

      if (res.ok) {
        setGeneralError("Code resent!");
      } else {
        const data = await res.json();
        setGeneralError(data.detail || "Failed to resend");
      }
    } catch {
      setGeneralError("Network error");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="regist">
      <section className="regis">
        <h1 className="verify-h1">Verify Email</h1>
        <p className="verify-p">Enter the 6-digit code sent to</p>
        <p className="verify-email">{email}</p>
        <div className="reg">
          <form onSubmit={handleVerify}>
            <div className="secsh">
              <input
                type="text"
                id="code"
                name="code"
                placeholder="___ ___"
                value={formatCode(code)}
                onChange={handleCodeChange}
                maxLength={7}
                autoComplete="one-time-code"
                required
                className="verify-input"
              />
            </div>
            {generalError && <p className="error">{generalError}</p>}
            <div className="secsh1">
              <input
                className={isValid && !loading ? "button1" : "not-button"}
                type="submit"
                value={loading ? "Verifying..." : "Continue"}
                disabled={!isValid || loading}
              />
            </div>
            <div className="secsh1">
              <input
                type="button"
                className="button2"
                value={resending ? "Sending..." : "Resend code"}
                onClick={handleResend}
                disabled={resending}
              />
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}


export default Verification