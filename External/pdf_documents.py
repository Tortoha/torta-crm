"""PDF document generator for orders / bookings / digital purchases / event tickets.

Three style presets — `modern` (accent-banded), `classic` (centered, serif), `minimal`
(monochrome). Branding (logo, company name, tax ID, address, accent colour) comes
from `crm_document_settings`.

Pure reportlab — no system fonts beyond reportlab's bundled Helvetica/Times-Roman.
Returns bytes; caller wraps in a StreamingResponse.
"""
from io import BytesIO
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white, black
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image,
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER

# ── Style preset palette ──────────────────────────────────────────────

def _palette(style: str, accent: str):
    accent_color = HexColor(accent or "#0071E3")
    if style == "classic":
        return {
            "title_font":   "Times-Bold",
            "body_font":    "Times-Roman",
            "heading_size": 22,
            "accent":       HexColor("#1f1f1f"),
            "subtle":       HexColor("#7a7a7a"),
            "rule":         HexColor("#1f1f1f"),
            "table_head_bg": HexColor("#f3f3f3"),
            "show_band":    False,
            "align":        "center",
        }
    if style == "minimal":
        return {
            "title_font":   "Helvetica-Bold",
            "body_font":    "Helvetica",
            "heading_size": 20,
            "accent":       HexColor("#111111"),
            "subtle":       HexColor("#9b9b9b"),
            "rule":         HexColor("#e5e5e5"),
            "table_head_bg": white,
            "show_band":    False,
            "align":        "left",
        }
    # modern (default)
    return {
        "title_font":   "Helvetica-Bold",
        "body_font":    "Helvetica",
        "heading_size": 24,
        "accent":       accent_color,
        "subtle":       HexColor("#666666"),
        "rule":         accent_color,
        "table_head_bg": accent_color,
        "show_band":    True,
        "align":        "left",
    }


def _money(amount, currency="USD"):
    sym = {"USD": "$", "EUR": "€", "KZT": "₸", "RUB": "₽", "GBP": "£"}.get(currency, "")
    if sym in ("$", "€", "£"):
        return f"{sym}{amount:,.2f}"
    return f"{amount:,.2f} {currency}"


def _safe(v):
    return "" if v is None else str(v)


# ── Page banner / header / footer ─────────────────────────────────────

def _draw_band(c: canvas.Canvas, palette, page_width, page_height):
    if not palette["show_band"]:
        return
    c.setFillColor(palette["accent"])
    c.rect(0, page_height - 12 * mm, page_width, 12 * mm, fill=1, stroke=0)


def _draw_footer(c: canvas.Canvas, palette, branding, page_width):
    note = (branding.get("footer_note") or "").strip()
    if not note: return
    c.setFont(palette["body_font"], 8)
    c.setFillColor(palette["subtle"])
    c.drawCentredString(page_width / 2, 12 * mm, note[:200])


# ── Top-of-document header (logo + company info) ─────────────────────

def _build_header(branding, palette):
    """Returns a flowable Table for the document header."""
    company = branding.get("company_name") or "Your Company"
    address = (branding.get("address") or "").replace("\n", "<br/>")
    tax_label = branding.get("tax_id_label") or "Tax ID"
    tax_id    = branding.get("tax_id") or ""
    contact_email = branding.get("contact_email") or ""
    contact_phone = branding.get("contact_phone") or ""

    body_style = ParagraphStyle(
        "company_body", fontName=palette["body_font"], fontSize=9,
        leading=12, textColor=palette["subtle"],
        alignment=TA_RIGHT if palette["align"] == "left" else TA_CENTER,
    )
    name_style = ParagraphStyle(
        "company_name", fontName=palette["title_font"], fontSize=12,
        leading=14, textColor=palette["accent"],
        alignment=TA_RIGHT if palette["align"] == "left" else TA_CENTER,
    )

    info_html = f"<b>{company}</b><br/>"
    if address:        info_html += address + "<br/>"
    if tax_id:         info_html += f"{tax_label}: {tax_id}<br/>"
    if contact_email:  info_html += contact_email + "<br/>"
    if contact_phone:  info_html += contact_phone

    info_para = Paragraph(info_html, body_style)
    name_para = Paragraph(company, name_style)

    # Logo cell (left), name+info (right)
    logo_url = branding.get("logo_url") or ""
    logo_cell = ""
    if logo_url and logo_url.startswith(("http://", "https://", "/")):
        try:
            from urllib.request import urlopen
            from urllib.parse import urlparse
            if logo_url.startswith("/"):
                # locally hosted via External/static; skip — external can serve later
                logo_cell = ""
            else:
                # 5-second fetch budget; on failure fall back silently
                with urlopen(logo_url, timeout=5) as r:
                    logo_bytes = r.read(2_000_000)
                logo_cell = Image(BytesIO(logo_bytes), width=28*mm, height=28*mm,
                                   kind="proportional")
        except Exception:
            logo_cell = ""

    if palette["align"] == "center":
        # Classic centered layout — name above details, no logo column.
        return [
            Paragraph(f"<para alignment='center'>{company}</para>", name_style),
            Paragraph(f"<para alignment='center'>{info_html}</para>", body_style),
        ]
    # modern / minimal — logo left, info right
    table = Table([[logo_cell or "", info_para]], colWidths=[40*mm, None])
    table.setStyle(TableStyle([
        ("ALIGN", (0, 0), (0, 0), "LEFT"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return [table]


def _build_title_block(palette, doc_title, doc_subtitle):
    title_style = ParagraphStyle(
        "doc_title", fontName=palette["title_font"], fontSize=palette["heading_size"],
        leading=palette["heading_size"] * 1.1, textColor=palette["accent"],
        spaceBefore=10, spaceAfter=4,
        alignment=TA_CENTER if palette["align"] == "center" else TA_LEFT,
    )
    sub_style = ParagraphStyle(
        "doc_sub", fontName=palette["body_font"], fontSize=10,
        leading=14, textColor=palette["subtle"], spaceAfter=10,
        alignment=TA_CENTER if palette["align"] == "center" else TA_LEFT,
    )
    out = [Paragraph(doc_title, title_style)]
    if doc_subtitle:
        out.append(Paragraph(doc_subtitle, sub_style))
    return out


def _build_items_table(items, palette, currency="USD"):
    """items: [{title, qty, price, total?}, …]"""
    head_color = white if palette["show_band"] else palette["accent"]
    rows = [[Paragraph(f"<b>Description</b>", _para(palette, color=head_color)),
             Paragraph(f"<b>Qty</b>",        _para(palette, color=head_color, align="right")),
             Paragraph(f"<b>Price</b>",      _para(palette, color=head_color, align="right")),
             Paragraph(f"<b>Total</b>",      _para(palette, color=head_color, align="right"))]]
    for it in items:
        qty   = it.get("qty", 1)
        price = float(it.get("price", 0))
        total = it.get("total", qty * price)
        rows.append([
            Paragraph(_safe(it.get("title")) +
                      (f"<br/><font size=8 color='#888'>{_safe(it.get('variation'))}</font>"
                       if it.get("variation") else ""),
                      _para(palette)),
            Paragraph(str(qty),                   _para(palette, align="right")),
            Paragraph(_money(price, currency),    _para(palette, align="right")),
            Paragraph(_money(total, currency),    _para(palette, align="right")),
        ])
    table = Table(rows, colWidths=[None, 18*mm, 30*mm, 30*mm])
    style = [
        ("VALIGN",    (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND",(0, 0), (-1, 0), palette["table_head_bg"]),
        ("BOX",       (0, 0), (-1, -1), 0.4, palette["rule"]),
        ("INNERGRID", (0, 0), (-1, -1), 0.2, palette["rule"]),
        ("LEFTPADDING",  (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING",   (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 8),
    ]
    table.setStyle(TableStyle(style))
    return table


def _para(palette, color=None, align="left"):
    return ParagraphStyle(
        "cell", fontName=palette["body_font"], fontSize=10,
        leading=13, textColor=color or palette["accent"],
        alignment={"left": TA_LEFT, "right": TA_RIGHT, "center": TA_CENTER}[align],
    )


def _build_totals(subtotal, shipping, discount, total, palette, currency="USD"):
    style_label = ParagraphStyle(
        "tot_label", fontName=palette["body_font"], fontSize=10,
        leading=14, textColor=palette["subtle"], alignment=TA_RIGHT,
    )
    style_value = ParagraphStyle(
        "tot_value", fontName=palette["body_font"], fontSize=10,
        leading=14, textColor=palette["accent"], alignment=TA_RIGHT,
    )
    style_total_l = ParagraphStyle(
        "tot_total_l", fontName=palette["title_font"], fontSize=12,
        leading=16, textColor=palette["accent"], alignment=TA_RIGHT,
    )
    rows = []
    if subtotal is not None:
        rows.append([Paragraph("Subtotal", style_label),
                     Paragraph(_money(subtotal, currency), style_value)])
    if shipping:
        rows.append([Paragraph("Shipping", style_label),
                     Paragraph(_money(shipping, currency), style_value)])
    if discount:
        rows.append([Paragraph("Discount", style_label),
                     Paragraph("-" + _money(discount, currency), style_value)])
    rows.append([Paragraph("<b>Total</b>", style_total_l),
                 Paragraph(f"<b>{_money(total, currency)}</b>", style_total_l)])
    table = Table(rows, colWidths=[None, 36*mm])
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEABOVE", (0, -1), (-1, -1), 1.2, palette["rule"]),
        ("TOPPADDING", (0, -1), (-1, -1), 8),
    ]))
    return table


# ── Public API ────────────────────────────────────────────────────────

def render_document(doc_type: str, style: str, branding: dict, data: dict) -> bytes:
    """
    doc_type: 'invoice' | 'act' | 'receipt' | 'ticket'
    style:    'modern' | 'classic' | 'minimal'
    branding: dict matching crm_document_settings columns
    data:     content shape varies per doc_type (see callers)
    """
    palette = _palette(style or "modern", branding.get("accent_color") or "#0071E3")
    buf = BytesIO()

    def _on_page(c, _doc):
        _draw_band(c, palette, A4[0], A4[1])
        _draw_footer(c, palette, branding, A4[0])

    sd = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=20*mm, rightMargin=20*mm,
        topMargin=24*mm if palette["show_band"] else 18*mm,
        bottomMargin=20*mm,
        title=f"{doc_type.title()} {data.get('number','')}",
    )
    flow = []
    flow.extend(_build_header(branding, palette))
    flow.append(Spacer(1, 8*mm))

    if doc_type == "invoice":
        title = f"Invoice #{data.get('number','')}"
        sub   = (f"Issued {data.get('issued_at','')} · "
                 f"To: {data.get('customer',{}).get('name','')}").strip(" ·")
        flow.extend(_build_title_block(palette, title, sub))
        flow.append(_build_items_table(data.get("items", []), palette, data.get("currency","USD")))
        flow.append(Spacer(1, 6*mm))
        flow.append(_build_totals(
            data.get("subtotal"), data.get("shipping", 0),
            data.get("discount", 0), data.get("total", 0),
            palette, data.get("currency", "USD")))

    elif doc_type == "act":
        title = f"Act of services #{data.get('number','')}"
        sub   = (f"Performed {data.get('performed_at','')} · "
                 f"Customer: {data.get('customer',{}).get('name','')}").strip(" ·")
        flow.extend(_build_title_block(palette, title, sub))
        flow.append(_build_items_table(data.get("items", []), palette, data.get("currency","USD")))
        flow.append(Spacer(1, 6*mm))
        flow.append(_build_totals(
            data.get("subtotal"), 0, 0, data.get("total", 0),
            palette, data.get("currency", "USD")))
        flow.append(Spacer(1, 16*mm))
        sig_style = ParagraphStyle("sig", fontName=palette["body_font"], fontSize=10,
                                    leading=20, textColor=palette["subtle"])
        flow.append(Paragraph("_____________________________________ &nbsp; "
                              "_____________________________________<br/>"
                              "<font size=9 color='#888'>Service provider</font>"
                              "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"
                              "<font size=9 color='#888'>Customer</font>",
                              sig_style))

    elif doc_type == "receipt":
        title = f"Receipt #{data.get('number','')}"
        sub   = f"Paid {data.get('paid_at','')}"
        flow.extend(_build_title_block(palette, title, sub))
        flow.append(_build_items_table(data.get("items", []), palette, data.get("currency","USD")))
        flow.append(Spacer(1, 6*mm))
        flow.append(_build_totals(
            data.get("subtotal"), 0, 0, data.get("total", 0),
            palette, data.get("currency", "USD")))
        if data.get("downloads"):
            flow.append(Spacer(1, 8*mm))
            dl_style = ParagraphStyle("dl", fontName=palette["body_font"], fontSize=10,
                                       leading=14, textColor=palette["accent"])
            flow.append(Paragraph("<b>Your downloads</b>", dl_style))
            for d in data["downloads"]:
                flow.append(Paragraph(f"• {d.get('label','')}: <font color='#0071E3'>{d.get('url','')}</font>",
                                       _para(palette)))

    elif doc_type == "ticket":
        title = f"Event ticket"
        sub   = data.get("event_name", "")
        flow.extend(_build_title_block(palette, title, sub))
        info_style = ParagraphStyle("info", fontName=palette["body_font"], fontSize=11,
                                    leading=16, textColor=palette["accent"])
        when  = data.get("starts_at", "")
        venue = data.get("venue", "")
        seat  = data.get("seat", "")
        attendee = (data.get("attendee", {}) or {}).get("name", "")
        info_html = ""
        if when:    info_html += f"<b>When:</b> {when}<br/>"
        if venue:   info_html += f"<b>Venue:</b> {venue}<br/>"
        if seat:    info_html += f"<b>Seat:</b> {seat}<br/>"
        if attendee:info_html += f"<b>Attendee:</b> {attendee}<br/>"
        flow.append(Paragraph(info_html, info_style))
        flow.append(Spacer(1, 6*mm))
        # QR code if `qr_url` provided — uses reportlab.graphics.barcode
        qr_data = data.get("qr_data") or data.get("qr_url")
        if qr_data:
            try:
                from reportlab.graphics.barcode.qr import QrCodeWidget
                from reportlab.graphics.shapes import Drawing
                qr = QrCodeWidget(qr_data, barLevel="M")
                bounds = qr.getBounds()
                w_qr = bounds[2] - bounds[0]
                h_qr = bounds[3] - bounds[1]
                d = Drawing(60*mm, 60*mm, transform=[60*mm/w_qr, 0, 0, 60*mm/h_qr, 0, 0])
                d.add(qr)
                flow.append(d)
            except Exception:
                pass
        flow.append(Spacer(1, 8*mm))
        flow.append(Paragraph(f"<font color='#888' size=9>"
                              f"Ticket #{data.get('number','')} · "
                              f"Order #{data.get('order_id','')}"
                              f"</font>", _para(palette)))

    else:
        flow.extend(_build_title_block(palette, doc_type.title(),
                                       f"Generated {datetime.utcnow().isoformat(timespec='seconds')}Z"))

    sd.build(flow, onFirstPage=_on_page, onLaterPages=_on_page)
    return buf.getvalue()
