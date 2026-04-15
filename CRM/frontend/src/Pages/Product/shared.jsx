// ── Shared helpers for Product tab components ──────────────────

export function SaveBtn({ saving, onClick, label = 'Save changes' }) {
  return (
    <button className="prod-save-btn" onClick={onClick} disabled={saving}>
      {saving ? 'Saving…' : label}
    </button>
  );
}

export function InlineField({ label, value, onChange, type = 'text', placeholder = '', mono = false }) {
  return (
    <div className="prod-field">
      <label className="prod-field-label">{label}</label>
      <input
        className={`prod-field-input${mono ? ' prod-field-input--mono' : ''}`}
        type={type} value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

export function TextareaField({ label, value, onChange, placeholder = '', rows = 4 }) {
  return (
    <div className="prod-field">
      <label className="prod-field-label">{label}</label>
      <textarea
        className="prod-field-textarea"
        rows={rows} value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
