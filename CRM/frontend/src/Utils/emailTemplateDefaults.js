// Defaults + variable metadata for the HTML email editor.
//
// Mirrors the backend email_engine EMAIL_TYPES (required_vars + sample data).
// The editor opens PRE-FILLED with a sensible email-safe HTML template per type
// (never an empty box), validates that required vars are present before save,
// and renders a live preview with the SAMPLE values below.
//
// Token convention: standard mustache {{var}} everywhere, PLUS the friendly
// self-closing tag <Verification_Code /> which the backend treats as an alias
// for {{code}}. Either satisfies the "code" requirement.

// Vars offered as quick-insert chips per email type.
export const TYPE_VARS = {
  verification:       ['code', 'customer_name', 'store_name', 'expiry_minutes'],
  password_reset:     ['reset_url', 'customer_name', 'store_name'],
  order_confirmation: ['customer_name', 'order', 'store_name'],
  booking_reminder:   ['customer_name', 'store_name'],
  abandoned_cart:     ['customer_name', 'store_name'],
  restock:            ['customer_name', 'store_name'],
  __broadcast:        ['customer_name', 'store_name'],
};

// Required tokens — save is blocked unless present (matches backend required_vars).
export const REQUIRED_VARS = {
  verification:   ['code'],
  password_reset: ['reset_url'],
};

// Sample values used to render the live preview.
export const SAMPLE_VARS = {
  verification:       { code: '284913', customer_name: 'Alex', store_name: 'Acme Store', expiry_minutes: '10' },
  password_reset:     { reset_url: 'https://acme.example/reset/abc123', customer_name: 'Alex', store_name: 'Acme Store' },
  order_confirmation: { customer_name: 'Alex', store_name: 'Acme Store', order: '#1042 — 2 items — $59.00' },
  booking_reminder:   { customer_name: 'Alex', store_name: 'Acme Store' },
  abandoned_cart:     { customer_name: 'Alex', store_name: 'Acme Store' },
  restock:            { customer_name: 'Alex', store_name: 'Acme Store' },
  __broadcast:        { customer_name: 'Alex', store_name: 'Acme Store' },
};

const SHELL_OPEN =
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
  'style="background:#f4f5f7;margin:0;padding:32px 0;">\n' +
  '  <tr><td align="center">\n' +
  '    <table role="presentation" width="480" cellpadding="0" cellspacing="0" ' +
  'style="background:#ffffff;border-radius:16px;padding:40px;' +
  'font-family:Arial,Helvetica,sans-serif;">\n';
const SHELL_CLOSE = '    </table>\n  </td></tr>\n</table>';

const VERIFICATION_DEFAULT = SHELL_OPEN +
`      <tr><td style="font-size:20px;font-weight:bold;color:#111111;">Confirm your email</td></tr>
      <tr><td style="font-size:14px;color:#555555;padding-top:12px;line-height:1.6;">
        Hi {{customer_name}}, enter the code below to verify your email and finish signing in to {{store_name}}.
      </td></tr>
      <tr><td align="center" style="padding:28px 0;">
        <div style="display:inline-block;background:#f4f5f7;border-radius:12px;padding:16px 28px;
                    font-size:34px;letter-spacing:10px;font-weight:bold;color:#0071E3;">
          {{code}}
        </div>
      </td></tr>
      <tr><td style="font-size:12px;color:#999999;line-height:1.6;">
        This code expires in {{expiry_minutes}} minutes. If you didn't request it, you can safely ignore this email.
      </td></tr>
` + SHELL_CLOSE;

const RESET_DEFAULT = SHELL_OPEN +
`      <tr><td style="font-size:20px;font-weight:bold;color:#111111;">Reset your password</td></tr>
      <tr><td style="font-size:14px;color:#555555;padding-top:12px;line-height:1.6;">
        Hi {{customer_name}}, tap the button below to set a new password for {{store_name}}.
      </td></tr>
      <tr><td align="center" style="padding:28px 0;">
        <a href="{{reset_url}}" style="display:inline-block;background:#0071E3;color:#ffffff;
           text-decoration:none;border-radius:999px;padding:12px 28px;font-size:15px;font-weight:bold;">
          Reset password
        </a>
      </td></tr>
      <tr><td style="font-size:12px;color:#999999;line-height:1.6;">
        If you didn't request this, you can safely ignore this email — your password won't change.
      </td></tr>
` + SHELL_CLOSE;

const GENERIC_DEFAULT = SHELL_OPEN +
`      <tr><td style="font-size:20px;font-weight:bold;color:#111111;">Hello {{customer_name}}</td></tr>
      <tr><td style="font-size:15px;color:#555555;padding-top:12px;line-height:1.6;">
        Write your message here. Use the variable chips above to insert dynamic values
        like {{customer_name}} or {{store_name}}.
      </td></tr>
` + SHELL_CLOSE;

export const DEFAULT_HTML = {
  verification:       VERIFICATION_DEFAULT,
  password_reset:     RESET_DEFAULT,
  order_confirmation: GENERIC_DEFAULT,
  booking_reminder:   GENERIC_DEFAULT,
  abandoned_cart:     GENERIC_DEFAULT,
  restock:            GENERIC_DEFAULT,
  __broadcast:        GENERIC_DEFAULT,
};

// Does the HTML satisfy the required tokens for this type?
// `code` is satisfied by either {{code}} or <Verification_Code />.
export function missingRequiredVars(emailType, html, subject = '') {
  const req = REQUIRED_VARS[emailType] || [];
  if (!req.length) return [];
  const hay = `${subject}\n${html || ''}`;
  return req.filter(v => {
    if (hay.includes(`{{${v}}}`) || hay.includes(`{{ ${v} }}`)) return false;
    if (v === 'code' && /<Verification_Code\s*\/?>/i.test(hay)) return false;
    return true;
  });
}

// Substitute tokens with sample values + wrap in light email-client chrome
// (grey backdrop, centered) so the white email card stands out in the preview.
export function renderPreview(emailType, html) {
  const vars = SAMPLE_VARS[emailType] || SAMPLE_VARS.__broadcast;
  let out = String(html || '');
  out = out.replace(/<Verification_Code\s*\/?>/gi, vars.code || '••••••');  // legacy tag alias
  out = out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => (vars[k] != null ? vars[k] : `{{${k}}}`));
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background:#f1f2f4;">' +
    '<div style="min-height:100vh;box-sizing:border-box;padding:28px 16px;' +
    'display:flex;justify-content:center;align-items:flex-start;' +
    'font-family:Arial,Helvetica,sans-serif;">' +
    out +
    '</div></body></html>'
  );
}
