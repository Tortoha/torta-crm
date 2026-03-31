import { useState } from "react";
import { Eye, EyeSlash } from '@phosphor-icons/react';

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
        <span className={`eye-icon-wrap${show ? ' eye-icon-wrap--hidden' : ''}`}>
          <EyeSlash size={22} />
        </span>
        <span className={`eye-icon-wrap eye-icon-wrap--abs${!show ? ' eye-icon-wrap--hidden' : ''}`}>
          <Eye size={22} />
        </span>
      </button>
    </div>
  );
}

export default PasswordInput