import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Style/Login.css";


function Verification() {
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [generalError, setGeneralError] = useState("");
  const navigate = useNavigate();

  const formatCode = (value) => {
    if (value.length <= 3) return value;
    return value.slice(0, 3) + " " + value.slice(3);
  };

  const handleCodeChange = (e) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
  };

  const isValid = code.length === 6;


  const handleVerify = async (e) => {
    e.preventDefault();
    setGeneralError("");
    if (!isValid) return;

    try {
      const res = await fetch("/api/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code })
      });

      if (res.ok) {
        navigate("/");
        window.location.reload();
      } else {
        const data = await res.json();
        setGeneralError(data.detail || "Verification failed");
      }
    } catch {
      setGeneralError("Network error");
    }
  };


  return (
    <div className="regist">
      <section className="regis">
        <h1 className="verify-h1">Verify Email</h1>
        <p className="verify-p">Enter the 6-digit code sent to your email</p>
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
              {codeError && <p className="error">{codeError}</p>}
            </div>
            {generalError && <p className="error">{generalError}</p>}
            <div className="secsh1">
              <input className={isValid ? "verify-button" : "verify-not-button"} type="submit" value="Continue" disabled={!isValid} />
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}


export default Verification