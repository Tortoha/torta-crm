import React, { useState } from "react";
import "./Style/Login.css";
import { Link } from "react-router-dom";

function Regis() {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [repeatPassword, setRepeatPassword] = useState("");
    const [nameError, setNameError] = useState("");
    const [emailError, setEmailError] = useState("");
    const [passwordErrors, setPasswordErrors] = useState([]);
    const [repeatError, setRepeatError] = useState("");

    // Только буквы и цифры для имени (любого регистра)
    const allowedNameRegex = /^[a-zA-Z0-9]*$/;

    // Email разрешённые символы: a-z, A-Z, 0-9, точка, дефис, подчёркивание, @
    const allowedEmailRegex = /^[a-zA-Z0-9._@-]*$/;
    const emailFormatRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}$/;

    // Запрещённые символы для пароля и повтор пароля
    const forbiddenPasswordCharsRegex = /[;:.,/#$%&*+=()<>{}|^`'"\\\s]/g;

    // Имя: только буквы и цифры
    const handleNameChange = (e) => {
        const value = e.target.value.replace(/[^a-zA-Z0-9]/g, ""); // сразу убираем лишнее
        setName(value);
        if (value.length < 1) {
            setNameError("Must be at least 1 characters");
        } else {
            setNameError("");
        }
    };

    // Email: только разрешённые символы и формат
    const handleEmailChange = (e) => {
        let value = e.target.value.replace(/[^a-zA-Z0-9._@-]/g, "");
        setEmail(value);
        if (!emailFormatRegex.test(value)) {
            setEmailError("Incorrect email");
        } else {
            setEmailError("");
        }
    };

    // Подходящие требования к паролю — от 8 до 24 символов, хотя бы одна буква и хотя бы одна цифра
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

    // Пароль: запрещённые символы не вводятся
    const handlePasswordChange = (e) => {
        const value = e.target.value.replace(forbiddenPasswordCharsRegex, "");
        setPassword(value);
        setPasswordErrors(validatePassword(value));
        if (repeatPassword && value !== repeatPassword) {
            setRepeatError("Passwords do not match");
        } else {
            setRepeatError("");
        }
    };

    // Повтор пароля: запрещённые символы не вводятся, сравнение с основным паролем
    const handleRepeatPasswordChange = (e) => {
        const value = e.target.value.replace(forbiddenPasswordCharsRegex, "");
        setRepeatPassword(value);
        if (value !== password) {
            setRepeatError("Passwords do not match");
        } else {
            setRepeatError("");
        }
    };

    const isValid =
        !nameError &&
        !emailError &&
        passwordErrors.length === 0 &&
        !repeatError &&
        name.length >= 2 &&
        email.length >= 5 &&
        password.length >= 8 &&
        password === repeatPassword;

    return (
        <div className="regist">
            <section className="regis">
                <h1>Create Account</h1>
                <div className="reg" id="r">
                    <form onSubmit={(e) => e.preventDefault()}>
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
                        <div className="secsh1">
                            <Link to="/">
                                <input className="button1" type="button" value="Next" disabled={!isValid} />
                            </Link>
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

export default Regis;