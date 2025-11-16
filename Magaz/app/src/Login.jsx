import React, { useState } from "react";
import "./Style/Login.css";
import { Link } from "react-router-dom";

function Login() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [emailError, setEmailError] = useState("");
    const [passwordErrors, setPasswordErrors] = useState([]);

    // Разрешённые символы для email: a-z, A-Z, 0-9, точка, дефис, подчёркивание, @
    const allowedEmailRegex = /^[a-zA-Z0-9._@-]*$/;
    const emailFormatRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}$/;

    // Запрещённые символы и пробелы для пароля
    const forbiddenCharsRegex = /[!?#$%&*+=()<>{}|^`'"\\\s]/g;

    // Email обработчик: удаляет запрещённые символы по вводу
    const handleEmailChange = (e) => {
        let value = e.target.value;
        value = value.replace(/[^a-zA-Z0-9._@-]/g, "");
        setEmail(value);
        if (!emailFormatRegex.test(value)) {
            setEmailError("Incorrect email");
        } else {
            setEmailError("");
        }
    };

    // Пароль должен быть 8-24 символа, минимум одна буква (любого регистра), минимум одна цифра
    const validatePassword = (pwd) => {
        let errors = [];
        if (pwd.length < 8 || pwd.length > 24) {
            errors.push("Must be 8–24 characters");
        }
        if (!/[A-Za-z]/.test(pwd)) {
            errors.push("Must be at least 1 letter");
        }
        if (!/\d/.test(pwd)) {
            errors.push("Must be at least 1 digit");
        }
        return errors;
    };

    // Пароль обработчик: запрещённые символы не попадают в value
    const handlePasswordChange = (e) => {
        const value = e.target.value.replace(forbiddenCharsRegex, "");
        setPassword(value);
        setPasswordErrors(validatePassword(value));
    };

    const isValid = !emailError && passwordErrors.length === 0 && email.length >= 5 && password.length >= 8;

    return (
        <div className="regist">
            <section className="regis">
                <h1>Sign In</h1>
                <div className="reg">
                    <form onSubmit={e => e.preventDefault()}>
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
                            {passwordErrors.length > 0 && (
                                <>{passwordErrors.map((err, idx) => (
                                    <p className="error" key={idx}>{err}</p>
                                ))}</>
                            )}
                        </div>
                        <div className="secsh1">
                            <Link to="/">
                                <input className="button1" type="button" value="Next" disabled={!isValid} />
                            </Link>
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

export default Login;