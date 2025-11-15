import React, { useState } from "react";
import "./Style/Login.css";
import { Link } from "react-router-dom";

function Login() {
    const [phone, setPhone] = useState("+");
    const [error, setError] = useState("");

    const handleChange = (e) => {
        const value = e.target.value.replace(/[^\d+]/g, "");
        const digits = value.replace(/\D/g, "");
        let f = value.startsWith("+") ? "+" : "";
        if (digits.length > 0) f += digits[0];
        if (digits.length > 1) f += "(" + digits.slice(1, 4);
        if (digits.length >= 4) f += ")";
        if (digits.length >= 5) f += digits.slice(4, 7);
        if (digits.length >= 7) f += "-" + digits.slice(7, 11);
        setPhone(f);
        setError(digits.length < 10 ? "The number is too short" : "");
    };

    const isValid = !error && phone.length >= 12;

    return (
        <div className="regist">
            <section className="regis">
                <h1>Sign In</h1>
                <div className="reg">
                    <form onSubmit={(e) => e.preventDefault()}>
                        <div className="secsh">
                            <label htmlFor="phone">Phone number</label>
                            <input type="tel" id="phone" name="phone" placeholder="+_(___)___-____" value={phone} onChange={handleChange} onFocus={() => !phone && setPhone("+")} maxLength="17" required />
                            {error && <p className="error">{error}</p>}
                        </div>
                        <div className="secsh1"><Link to="/"><input className="button1" type="button" value="Next" disabled={!isValid} /></Link></div>
                        <div className="secsh1"><Link to="/registration"><input className="button2" type="button" value="Create account" /></Link></div>
                    </form>
                </div>
            </section>
        </div>
    );
}

export default Login;