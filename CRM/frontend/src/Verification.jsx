import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import "./Style/Login.css";
import { API_BASE } from "./api.js"

function Verification() {
  const [code, setCode] = useState("");
  const [generalError, setGeneralError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [email, setEmail] = useState("");
  const [cooldown, setCooldown] = useState(0);

  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const pendingEmail = localStorage.getItem("pendingEmail");
    const pendingResendUntil = Number(localStorage.getItem("pendingResendUntil") || 0);

    if (!pendingEmail) {
      navigate("/login");
      return;
    }

    setEmail(pendingEmail);

    const initialSeconds = Math.max(
      0,
      Math.ceil((pendingResendUntil - Date.now()) / 1000)
    );
    setCooldown(initialSeconds);
  }, [navigate]);

  useEffect(() => {
    if (cooldown <= 0) return;

    const interval = setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(interval);
  }, [cooldown]);

  const formatCode = (value) => {
    if (value.length <= 3) return value;
    return value.slice(0, 3) + " " + value.slice(3);
  };

  const extractSecondsFromMessage = (text) => {
    const match = String(text || "").match(/(\d+)/);
    return match ? Number(match[1]) : 60;
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
      const res = await fetch(`${API_BASE}/api/verify-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, code }),
      });

      const data = await res.json();

      if (res.ok) {
        localStorage.removeItem("pendingEmail");
        localStorage.removeItem("pendingVerificationType");
        localStorage.removeItem("pendingResendUntil");
        navigate("/dashboard");
        window.location.reload();
      } else {
        setGeneralError(data.detail || "Verification failed");
      }
    } catch {
      setGeneralError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || resending) return;

    setResending(true);
    setGeneralError("");

    try {
      const res = await fetch(`${API_BASE}/api/resend-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (res.ok) {
        const resendSeconds = Number(data.resend_available_in || 60);
        const resendUntil = Date.now() + resendSeconds * 1000;

        localStorage.setItem("pendingResendUntil", String(resendUntil));
        setCooldown(resendSeconds);
        setGeneralError("Code resent!");
      } else {
        if (res.status === 429) {
          const seconds = extractSecondsFromMessage(data.detail);
          const resendUntil = Date.now() + seconds * 1000;

          localStorage.setItem("pendingResendUntil", String(resendUntil));
          setCooldown(seconds);
        }

        setGeneralError(data.detail || "Failed to resend");
      }
    } catch {
      setGeneralError("Network error");
    } finally {
      setResending(false);
    }
  };

  const handleGoBack = () => {
    localStorage.removeItem("pendingEmail");
    localStorage.removeItem("pendingVerificationType");
    localStorage.removeItem("pendingResendUntil");

    if (location.pathname.includes("/registration/")) {
      navigate("/registration");
    } else {
      navigate("/login");
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
                className={cooldown === 0 && !resending ? "button3" : "not-button3"}
                value={
                  resending
                    ? "Sending..."
                    : cooldown > 0
                    ? `Resend after ${cooldown}s`
                    : "Resend code"
                }
                onClick={handleResend}
                disabled={resending || cooldown > 0}
              />
            </div>

            <div className="secsh1">
              <input
                type="button"
                className="button2"
                value="Back"
                onClick={handleGoBack}
              />
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

export default Verification