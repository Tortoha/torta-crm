import { useState } from "react";

function PasswordInput({ id, name, placeholder, value, onChange, autoComplete }) {
  const [show, setShow] = useState(false);

  return (
    <div className="password-wrapper">
      <input
        type={show ? "text" : "password"}
        id={id}
        name={name}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        required
      />
      <button
        type="button"
        className="password-eye"
        onClick={() => setShow(prev => !prev)}
        tabIndex={-1}
      >
        <svg
          className={`eye-icon ${show ? "eye-visible" : "eye-hidden"}`}
          width="22" height="22" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>

        <svg
          className={`eye-icon ${!show ? "eye-visible" : "eye-hidden"}`}
          width="22" height="22" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
      </button>
    </div>
  );
}

export default PasswordInput