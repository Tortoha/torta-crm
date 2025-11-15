import React, { useState } from "react";
import "./Style/Login.css";
import { Link } from "react-router-dom";

function Regis() {
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("+");
    const [error, setError] = useState("");

    const handlePhoneChange = (e) => {
        const value = e.target.value.replace(/[^\d+]/g, "");
        const digits = value.replace(/\D/g, "");
        let formatted = value.startsWith("+") ? "+" : "";
        if (digits.length > 0) formatted += digits[0];
        if (digits.length > 1) formatted += "(" + digits.slice(1, 4);
        if (digits.length >= 4) formatted += ")";
        if (digits.length >= 5) formatted += digits.slice(4, 7);
        if (digits.length >= 7) formatted += "-" + digits.slice(7, 11);
        setPhone(formatted);
        setError(digits.length < 10 ? "The number is too short" : "");
    };

    const isValid = name.trim().length > 1 && !error && phone.length >= 12;

    return (
        <>
            <div className="regist">
                <section className="regis">
                    <h1>Create Account</h1>
                    <div className="reg" id="r">
                        <form onSubmit={(e) => e.preventDefault()}>
                            <div className="secsh2">
                                <label htmlFor="username">Name</label><br />
                                <input type="text" id="username" name="username" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required /><br />
                            </div>
                            <div className="secsh2">
                                <label htmlFor="phone">Phone number</label><br />
                                <input type="tel" id="phone" name="phone" placeholder="+_(___)___-____" value={phone} onChange={handlePhoneChange} onFocus={() => !phone && setPhone("+")} maxLength="17" required /><br />
                                {error && <p className="error">{error}</p>}
                            </div>
                            <div className="secsh1">
                                <Link to="/"><input className="button3" type="button" value="Next" disabled={!isValid} /></Link>
                            </div>
                            <div className="secsh1">
                                <Link to="/login"><input className="button2" type="button" value="Sign in" /></Link>
                            </div>
                        </form>
                    </div>
                </section>
            </div>
        </>
    );
}

export default Regis;