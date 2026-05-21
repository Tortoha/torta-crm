"""Email render engine — blocks JSON → email-safe (table + inline-CSS) HTML.
Duplicated verbatim in CRM/backend and External (like send_email/sanitize). Keep both copies in sync."""

import re
import html as _html

# ── Email type metadata: label + variables that must survive merchant edits ──
EMAIL_TYPES = {
    "verification":       {"label": "Verification code",  "required_vars": ["code"],
                           "subject": "Your verification code"},
    "password_reset":     {"label": "Password reset",     "required_vars": ["reset_url"],
                           "subject": "Reset your password"},
    "order_confirmation": {"label": "Order confirmation",  "required_vars": [],
                           "subject": "Order {{order_number}} confirmed"},
    "booking_reminder":   {"label": "Booking reminder",    "required_vars": [],
                           "subject": "Reminder: your appointment is soon"},
    "abandoned_cart":     {"label": "Abandoned cart",      "required_vars": [],
                           "subject": "You left items in your cart"},
    "restock":            {"label": "Back in stock",       "required_vars": [],
                           "subject": "{{product_name}} is back in stock"},
}

# Sample variables used by the CRM live preview (External passes real values).
SAMPLE_VARS = {
    "verification":       {"code": "284913", "store_name": "Acme Store", "expiry_minutes": "10"},
    "password_reset":     {"reset_url": "https://example.com/reset/abc123", "store_name": "Acme Store"},
    "order_confirmation": {"order_number": "1042", "customer_name": "Alex", "order_url": "https://example.com/orders/1042",
                            "store_name": "Acme Store", "order_total": "$129.00",
                            "items": [{"title": "Cotton T-Shirt — Black / M", "qty": 2, "price": "$39.00"},
                                      {"title": "Canvas Tote", "qty": 1, "price": "$51.00"}]},
    "booking_reminder":   {"customer_name": "Alex", "service_name": "Haircut", "staff_name": "Maria",
                            "when": "Tomorrow, 14:30", "store_name": "Acme Salon"},
    "abandoned_cart":     {"customer_name": "Alex", "cart_url": "https://example.com/cart", "store_name": "Acme Store"},
    "restock":            {"product_name": "Cotton T-Shirt", "product_url": "https://example.com/p/123", "store_name": "Acme Store"},
}

DEFAULT_BRANDING = {
    "logo_url": None,
    "accent_color": "#0071E3",
    "page_bg": "#ffffff",
    "card_bg": "#ffffff",
    "text_color": "#1d1d1f",
    "font_family": "Arial, Helvetica, sans-serif",
    "header_text": "",
    "footer_text": "",
    "social_links": [],
}


def _esc(v):
    return _html.escape(str(v if v is not None else ""), quote=True)


def _interpolate(text, variables):
    """Replace {{ key }} tokens with HTML-escaped variable values; unknown keys → ''."""
    if not text:
        return ""

    def repl(m):
        return _esc((variables or {}).get(m.group(1).strip(), ""))

    return re.sub(r"\{\{\s*([\w.]+)\s*\}\}", repl, str(text))


def render_subject(subject, variables):
    """Interpolate {{vars}} in a subject line WITHOUT HTML-escaping (plain-text context)."""
    if not subject:
        return ""

    def repl(m):
        return str((variables or {}).get(m.group(1).strip(), ""))

    return re.sub(r"\{\{\s*([\w.]+)\s*\}\}", repl, str(subject))


def _px(v, fallback=""):
    if v is None or v == "":
        return fallback
    if isinstance(v, (int, float)):
        return f"{v}px"
    return str(v)


def find_vars_in_blocks(blocks):
    """Collect every {{var}} referenced across blocks + implicit vars from dynamic block types."""
    found = set()
    pat = re.compile(r"\{\{\s*([\w.]+)\s*\}\}")
    for b in (blocks or []):
        p = b.get("props", {}) or {}
        for key in ("text", "url", "src", "alt", "subject"):
            for m in pat.findall(str(p.get(key, "") or "")):
                found.add(m)
        if b.get("type") == "code":
            found.add("code")
        if b.get("type") == "order_summary":
            found.add("order")
    return found


def template_has_required(email_type, blocks, subject=""):
    """True when every required var of this type appears in subject or blocks."""
    req = EMAIL_TYPES.get(email_type, {}).get("required_vars", [])
    if not req:
        return True
    found = find_vars_in_blocks(blocks)
    for m in re.findall(r"\{\{\s*([\w.]+)\s*\}\}", subject or ""):
        found.add(m)
    return all(r in found for r in req)


# ── Block renderers (each returns a full-width <tr> for the content table) ──

def _render_heading(p, br, v):
    align = p.get("align", "left")
    css = (f"font-family:{br['font_family']};"
           f"font-size:{_px(p.get('fontSize'), '24px')};"
           f"font-weight:{p.get('fontWeight', '700')};"
           f"color:{p.get('color') or br['text_color']};"
           f"text-align:{align};line-height:1.3;margin:0;")
    pad = _px(p.get("padding"), "24px 24px 8px")
    return (f'<tr><td style="padding:{pad};">'
            f'<h1 style="{css}">{_interpolate(p.get("text", ""), v)}</h1></td></tr>')


def _render_text(p, br, v):
    align = p.get("align", "left")
    css = (f"font-family:{br['font_family']};"
           f"font-size:{_px(p.get('fontSize'), '15px')};"
           f"font-weight:{p.get('fontWeight', '400')};"
           f"color:{p.get('color') or br['text_color']};"
           f"text-align:{align};line-height:1.6;margin:0;")
    pad = _px(p.get("padding"), "4px 24px 16px")
    body = _interpolate(p.get("text", ""), v).replace("\n", "<br>")
    return f'<tr><td style="padding:{pad};"><p style="{css}">{body}</p></td></tr>'


def _render_button(p, br, v):
    align = p.get("align", "center")
    bg = p.get("bg") or br["accent_color"]
    color = p.get("color", "#ffffff")
    radius = _px(p.get("radius"), "999px")
    bpad = _px(p.get("buttonPadding"), "12px 28px")
    fs = _px(p.get("fontSize"), "15px")
    border = p.get("border", "none")
    shadow = p.get("shadow", "")
    pad = _px(p.get("padding"), "12px 24px 16px")
    url = _interpolate(p.get("url", "#"), v) or "#"
    label = _interpolate(p.get("text", "Button"), v)
    btn_css = (f"display:inline-block;background:{bg};color:{color};"
               f"font-family:{br['font_family']};font-size:{fs};font-weight:600;"
               f"text-decoration:none;border-radius:{radius};padding:{bpad};border:{border};")
    if shadow:
        btn_css += f"box-shadow:{shadow};"
    return (f'<tr><td align="{align}" style="padding:{pad};text-align:{align};">'
            f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
            f'style="display:inline-block;"><tr><td align="center" bgcolor="{bg}" '
            f'style="border-radius:{radius};">'
            f'<a href="{url}" target="_blank" style="{btn_css}">{label}</a>'
            f'</td></tr></table></td></tr>')


def _render_image(p, br, v):
    align = p.get("align", "center")
    src = _interpolate(p.get("src", ""), v)
    if not src:
        return ""
    width = _px(p.get("width"), "")
    radius = _px(p.get("radius"), "0")
    pad = _px(p.get("padding"), "12px 24px")
    style = f"max-width:100%;height:auto;border-radius:{radius};display:block;"
    if align == "center":
        style += "margin:0 auto;"
    elif align == "right":
        style += "margin-left:auto;"
    wattr = f' width="{p.get("width")}"' if isinstance(p.get("width"), (int, float)) else ""
    return (f'<tr><td align="{align}" style="padding:{pad};">'
            f'<img src="{_esc(src)}" alt="{_esc(_interpolate(p.get("alt", ""), v))}"{wattr} '
            f'style="{style}{("width:" + width + ";") if width else ""}"></td></tr>')


def _render_divider(p, br, v):
    color = p.get("color", "#e5e5e7")
    thickness = _px(p.get("thickness"), "1px")
    pad = _px(p.get("padding"), "8px 24px")
    return (f'<tr><td style="padding:{pad};">'
            f'<div style="border-top:{thickness} solid {color};font-size:0;line-height:0;">&nbsp;</div>'
            f'</td></tr>')


def _render_spacer(p, br, v):
    h = _px(p.get("height"), "24px")
    return f'<tr><td style="height:{h};line-height:{h};font-size:0;">&nbsp;</td></tr>'


def _render_code(p, br, v):
    code = str((v or {}).get("code", ""))
    grouped = f"{code[:3]} {code[3:]}" if len(code) == 6 else code
    bg = p.get("bg") or "rgba(0,113,227,0.06)"
    color = p.get("color") or br["accent_color"]
    pad = _px(p.get("padding"), "8px 24px 20px")
    box = (f"display:inline-block;background:{bg};color:{color};"
           f"font-family:{br['font_family']};font-size:{_px(p.get('fontSize'), '34px')};"
           f"font-weight:700;letter-spacing:8px;padding:18px 28px;border-radius:16px;")
    return (f'<tr><td align="center" style="padding:{pad};text-align:center;">'
            f'<div style="{box}">{_esc(grouped)}</div></td></tr>')


def _render_order_summary(p, br, v):
    items = (v or {}).get("items") or []
    rows = ""
    for it in items:
        title = _esc(it.get("title", ""))
        qty = _esc(it.get("qty", ""))
        price = _esc(it.get("price", ""))
        rows += (f'<tr><td style="padding:8px 0;font-family:{br["font_family"]};font-size:14px;'
                 f'color:{br["text_color"]};border-bottom:1px solid #eee;">{title} '
                 f'<span style="color:#888;">× {qty}</span></td>'
                 f'<td align="right" style="padding:8px 0;font-family:{br["font_family"]};font-size:14px;'
                 f'color:{br["text_color"]};border-bottom:1px solid #eee;">{price}</td></tr>')
    total = _esc((v or {}).get("order_total", ""))
    if total:
        rows += (f'<tr><td style="padding:12px 0 0;font-family:{br["font_family"]};font-size:15px;'
                 f'font-weight:700;color:{br["text_color"]};">Total</td>'
                 f'<td align="right" style="padding:12px 0 0;font-family:{br["font_family"]};font-size:15px;'
                 f'font-weight:700;color:{br["text_color"]};">{total}</td></tr>')
    pad = _px(p.get("padding"), "4px 24px 16px")
    return (f'<tr><td style="padding:{pad};"><table role="presentation" width="100%" '
            f'cellpadding="0" cellspacing="0" border="0">{rows}</table></td></tr>')


def _render_downloads(p, br, v):
    items = (v or {}).get("downloads") or []
    if not items:
        return ""
    lis = ""
    for d in items:
        title = _esc(d.get("title", ""))
        label = _esc(d.get("label", "Download"))
        url = _esc(d.get("url", "#"))
        lis += (f'<li style="margin:8px 0;font-family:{br["font_family"]};font-size:14px;color:{br["text_color"]};">'
                f'<strong>{title}</strong> &middot; '
                f'<a href="{url}" target="_blank" style="color:{br["accent_color"]};">{label}</a></li>')
    pad = _px(p.get("padding"), "4px 24px 16px")
    head = _esc(p.get("title", "Your downloads"))
    return (f'<tr><td style="padding:{pad};"><div style="font-family:{br["font_family"]};font-size:16px;'
            f'font-weight:700;color:{br["text_color"]};margin:0 0 8px;">{head}</div>'
            f'<ul style="padding-left:18px;margin:0;">{lis}</ul></td></tr>')


_RENDERERS = {
    "heading": _render_heading,
    "text": _render_text,
    "button": _render_button,
    "image": _render_image,
    "divider": _render_divider,
    "spacer": _render_spacer,
    "code": _render_code,
    "order_summary": _render_order_summary,
    "downloads": _render_downloads,
}


def _render_blocks(blocks, br, v):
    out = []
    for b in (blocks or []):
        if b.get("hidden"):
            continue
        fn = _RENDERERS.get(b.get("type"))
        if fn:
            out.append(fn(b.get("props", {}) or {}, br, v))
    return "".join(out)


def render_email(blocks, branding=None, variables=None, *, unsubscribe_url=None):
    """Wrap rendered blocks in the brand shell → final email-safe HTML document."""
    br = {**DEFAULT_BRANDING, **(branding or {})}
    v = variables or {}

    header = ""
    if br.get("logo_url"):
        header = (f'<tr><td align="center" style="padding:28px 24px 4px;">'
                  f'<img src="{_esc(br["logo_url"])}" alt="{_esc(br.get("header_text") or "")}" '
                  f'style="max-height:48px;max-width:200px;display:block;margin:0 auto;"></td></tr>')
    elif br.get("header_text"):
        header = (f'<tr><td align="center" style="padding:28px 24px 4px;font-family:{br["font_family"]};'
                  f'font-size:20px;font-weight:700;color:{br["text_color"]};">{_esc(br["header_text"])}</td></tr>')

    social = ""
    for s in (br.get("social_links") or []):
        label = _esc(s.get("label") or s.get("type") or "Link")
        url = _esc(s.get("url") or "#")
        social += (f'<a href="{url}" target="_blank" style="color:{br["accent_color"]};'
                   f'text-decoration:none;margin:0 8px;font-size:13px;">{label}</a>')

    footer_bits = []
    if br.get("footer_text"):
        footer_bits.append(f'<div style="margin-bottom:8px;">{_esc(br["footer_text"])}</div>')
    if social:
        footer_bits.append(f'<div style="margin-bottom:8px;">{social}</div>')
    if unsubscribe_url:
        footer_bits.append(f'<div><a href="{_esc(unsubscribe_url)}" target="_blank" '
                           f'style="color:#999;text-decoration:underline;">Unsubscribe</a></div>')
    footer = ""
    if footer_bits:
        footer = (f'<tr><td style="padding:20px 24px 28px;font-family:{br["font_family"]};'
                  f'font-size:12px;color:#999;text-align:center;">{"".join(footer_bits)}</td></tr>')

    bg_props = next((b.get("props", {}) for b in (blocks or []) if b.get("type") == "background"), {}) or {}
    page_color = bg_props.get("page_color") or "#ffffff"
    page_img = bg_props.get("page_image") or ""
    card_color = bg_props.get("color") or br["card_bg"]
    card_img = bg_props.get("image") or ""
    _rv = bg_props.get("radius")
    try:
        radius = int(float(_rv)) if _rv not in (None, "") else 16
    except Exception:
        radius = 16
    _shadows = {"none": "none", "soft": "0 4px 18px rgba(16,24,40,0.08)",
                "medium": "0 8px 28px rgba(16,24,40,0.13)", "strong": "0 14px 44px rgba(16,24,40,0.20)"}
    card_shadow = _shadows.get(bg_props.get("shadow") or "soft", _shadows["soft"])
    page_bg = f"background:{page_color};"
    if page_img:
        page_bg += (f"background-image:url('{_esc(page_img)}');"
                    "background-size:cover;background-position:center;background-repeat:no-repeat;")
    card_style = (f"width:600px;max-width:100%;background:{card_color};"
                  f"border-radius:{radius}px;overflow:hidden;box-shadow:{card_shadow};")
    if card_img:
        card_style += (f"background-image:url('{_esc(card_img)}');"
                       "background-size:cover;background-position:center;background-repeat:no-repeat;")
    content = _render_blocks(blocks, br, v)
    return (
        '<!DOCTYPE html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'
        f'<body style="margin:0;padding:0;{page_bg}">'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="{page_bg}"><tr><td align="center" style="padding:24px 12px;">'
        f'<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="{card_style}">'
        f'{header}{content}{footer}'
        '</table></td></tr></table></body></html>'
    )


# ── Default templates (block JSON) for storefront emails ──

DEFAULT_EMAIL_TEMPLATES = {
    "verification": {
        "subject": "Your verification code",
        "blocks": [
            {"type": "heading", "props": {"text": "Verify your email", "align": "center"}},
            {"type": "text", "props": {"text": "Use the code below to finish signing in to {{store_name}}.", "align": "center"}},
            {"type": "code", "props": {}},
            {"type": "text", "props": {"text": "This code expires in {{expiry_minutes}} minutes. If you didn't request it, you can ignore this email.",
                                       "align": "center", "color": "#888", "fontSize": "13px"}},
        ],
    },
    "password_reset": {
        "subject": "Reset your password",
        "blocks": [
            {"type": "heading", "props": {"text": "Reset your password", "align": "center"}},
            {"type": "text", "props": {"text": "We received a request to reset your password for {{store_name}}. Tap the button below to choose a new one.",
                                       "align": "center"}},
            {"type": "button", "props": {"text": "Reset password", "url": "{{reset_url}}", "align": "center"}},
            {"type": "text", "props": {"text": "If you didn't request this, you can safely ignore this email.",
                                       "align": "center", "color": "#888", "fontSize": "13px"}},
        ],
    },
    "order_confirmation": {
        "subject": "Order {{order_number}} confirmed",
        "blocks": [
            {"type": "heading", "props": {"text": "Thank you for your order!"}},
            {"type": "text", "props": {"text": "Hi {{customer_name}}, your order {{order_number}} is confirmed. Here's a summary:"}},
            {"type": "order_summary", "props": {}},
            {"type": "downloads", "props": {}},
            {"type": "button", "props": {"text": "View your order", "url": "{{order_url}}", "align": "left"}},
        ],
    },
    "booking_reminder": {
        "subject": "Reminder: your appointment is soon",
        "blocks": [
            {"type": "heading", "props": {"text": "Your appointment is coming up"}},
            {"type": "text", "props": {"text": "Hi {{customer_name}}, this is a reminder for {{service_name}} with {{staff_name}} on {{when}}. See you soon at {{store_name}}!"}},
        ],
    },
    "abandoned_cart": {
        "subject": "You left items in your cart",
        "blocks": [
            {"type": "heading", "props": {"text": "Still thinking it over?"}},
            {"type": "text", "props": {"text": "Hi {{customer_name}}, you left some items in your cart at {{store_name}}. They're waiting for you."}},
            {"type": "button", "props": {"text": "Return to cart", "url": "{{cart_url}}", "align": "left"}},
        ],
    },
    "restock": {
        "subject": "{{product_name}} is back in stock",
        "blocks": [
            {"type": "heading", "props": {"text": "Back in stock!"}},
            {"type": "text", "props": {"text": "Good news — {{product_name}} is available again at {{store_name}}. Grab it before it's gone."}},
            {"type": "button", "props": {"text": "Shop now", "url": "{{product_url}}", "align": "left"}},
        ],
    },
}
