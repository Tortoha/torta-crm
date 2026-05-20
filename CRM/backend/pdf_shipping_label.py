"""Reportlab renderer for shipping labels.

Generates a printable shipping label for one order. The label is the
physical sticker that the merchant slaps on the parcel box — it
contains:

  • A 1D Code 128 barcode encoding the courier's tracking number
    (so the carrier's own scanner reads it natively).
  • A QR code resolving to the COURIER'S public tracking page
    (CDEK / Kazpost / Pochta / DHL / etc.). CRM is not a delivery
    service, so the QR must never point back to us — customers
    scanning the label should land on the carrier's tracking UI.
  • Recipient block (city, address, name) — highlighted city block
    mirrors how Kazakh/Russian logistics dispatchers expect to
    pick the sorting bin in <1 second.
  • Sender block from `crm_document_settings` (merchant brand).
  • Item list (truncated to 3 rows with "and N more" suffix).
  • Package count, package weight, planned delivery date.

Layouts:
  thermal_100x150 — one label per page, 100×150 mm (standard
                    thermal-printer roll size used by every CIS courier).
  a4_1             — one label centered on A4 (manual courier flow).
  a4_2             — two labels stacked on A4 (cut line in middle).
  a4_4             — four labels in 2×2 grid on A4.

Note on text: reportlab's default Helvetica has no Cyrillic glyphs,
so we register DejaVuSans (shipped with the OS / pip install) once at
module load. If DejaVuSans is unavailable we fall back to Arial on
Windows; otherwise Cyrillic will appear as boxes — log a warning.

Note on fill-colour discipline: Code128.drawOn() inherits the current
canvas fill colour. The header band draws WHITE text into a black
pill, leaving the canvas with `fillColor=white` afterwards — without
an explicit reset, every subsequent `drawOn(...)` ends up rendering
white-on-white invisible bars. Every helper here therefore calls
`c.setFillColor(black)` immediately before drawing barcode primitives.
"""
from __future__ import annotations
from io import BytesIO
from typing import Iterable, Optional
import os

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white, black
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.graphics.barcode import code128
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF


# ── Font setup ──────────────────────────────────────────────────────────
_FONT_REGULAR = "Helvetica"
_FONT_BOLD    = "Helvetica-Bold"


def _try_register(font_name: str, path_candidates: Iterable[str]) -> Optional[str]:
    for p in path_candidates:
        if os.path.exists(p):
            try:
                pdfmetrics.registerFont(TTFont(font_name, p))
                return font_name
            except Exception:
                pass
    return None


_reg = _try_register("DejaVuSans", [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "C:/Windows/Fonts/DejaVuSans.ttf",
    "C:/Windows/Fonts/arial.ttf",
])
if _reg:
    _FONT_REGULAR = _reg

_reg_b = _try_register("DejaVuSans-Bold", [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "C:/Windows/Fonts/DejaVuSans-Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
])
if _reg_b:
    _FONT_BOLD = _reg_b


# ── Helpers ─────────────────────────────────────────────────────────────

def _draw_text(c, x, y, txt, font=None, size=8, color=black, max_width=None):
    """Draw text, optionally truncating to `max_width` (in points) with an
    ellipsis suffix. Always restores fill-colour to black on exit so
    subsequent shape draws (barcode bars, QR modules) inherit the right
    colour."""
    if txt is None: txt = ""
    txt = str(txt)
    c.setFillColor(color)
    c.setFont(font or _FONT_REGULAR, size)
    if max_width and c.stringWidth(txt, font or _FONT_REGULAR, size) > max_width:
        while txt and c.stringWidth(txt + "…", font or _FONT_REGULAR, size) > max_width:
            txt = txt[:-1]
        txt += "…"
    c.drawString(x, y, txt)
    c.setFillColor(black)  # discipline — keep canvas state predictable


def _wrap_text(c, txt, font, size, max_width):
    """Word-wrap `txt` to fit within `max_width` points. Returns a list
    of lines. Splits on whitespace + commas (so "Tole Bi 273a/4, apt 123"
    breaks cleanly between segments rather than mid-word). Long single
    tokens (e.g. an unbroken URL or 50-char street name) get ellipsised
    on their own line instead of overflowing.
    Used for the recipient address — without wrapping, a long line
    like "Tole Bi 273a/4, apt 123, fl 6, entr 5, int 123, 050005, Kazakhstan"
    was overflowing the label width and getting cut off as "Kaz…".
    """
    if not txt: return []
    # Comma-aware tokenization: keep the comma attached to the chunk
    # before it, so wrapping happens after a logical group.
    parts = [p.strip() for p in txt.split(",")]
    lines = []
    cur = ""
    for i, part in enumerate(parts):
        chunk = part + ("," if i < len(parts) - 1 else "")
        candidate = (cur + " " + chunk).strip() if cur else chunk
        if c.stringWidth(candidate, font, size) <= max_width:
            cur = candidate
        else:
            if cur:
                lines.append(cur)
            # The chunk itself might be longer than max_width — truncate.
            if c.stringWidth(chunk, font, size) > max_width:
                truncated = chunk
                while truncated and c.stringWidth(truncated + "…", font, size) > max_width:
                    truncated = truncated[:-1]
                lines.append(truncated + "…")
                cur = ""
            else:
                cur = chunk
    if cur:
        lines.append(cur)
    return lines


def _draw_block_label(c, x, y, w, h, text, font_size=12):
    """Black-background highlighted text block — used for the destination
    city. After drawing the white text, we explicitly reset fill colour
    to black so the next caller (barcode renderer, in particular) draws
    visible shapes."""
    c.setFillColor(black)
    c.rect(x, y, w, h, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont(_FONT_BOLD, font_size)
    c.drawString(x + 4 * mm, y + (h - font_size) / 2 + 1, text)
    c.setFillColor(black)


def _draw_barcode_1d(c, x, y, w, h, value):
    """Code 128 1D barcode. Width auto-fits within `w` (points)."""
    if not value: return
    # Critical: bar fill colour. Without this an upstream call to
    # setFillColor(white) (e.g. when drawing white text inside a black
    # pill) leaves the canvas in white-fill mode and Code128's bars
    # render invisible. Setting black explicitly here makes the
    # barcode robust to caller order.
    c.setFillColor(black)
    # Larger bar width than the v1 default (0.4 mm) — most thermal
    # printers happily resolve 0.5–0.6 mm bars and a thicker barcode
    # is far more scanner-friendly on cheap consumer phones.
    bc = code128.Code128(value, barHeight=h, barWidth=0.55 * mm, humanReadable=False)
    bc_width = bc.width
    if bc_width > w:
        scale = w / bc_width
        c.saveState()
        c.translate(x, y)
        c.scale(scale, 1)
        bc.drawOn(c, 0, 0)
        c.restoreState()
    else:
        bc.drawOn(c, x + (w - bc_width) / 2, y)


def _draw_qr(c, x, y, size, payload):
    """QR code square of `size` (points) drawn from bottom-left (x, y)."""
    if not payload: return
    c.setFillColor(black)
    qr = QrCodeWidget(payload)
    bounds = qr.getBounds()
    qw = bounds[2] - bounds[0]
    qh = bounds[3] - bounds[1]
    d = Drawing(size, size, transform=[size / qw, 0, 0, size / qh, 0, 0])
    d.add(qr)
    renderPDF.draw(d, c, x, y)


def _hairline(c, x1, y, x2):
    """Thin horizontal separator line. Black, 0.4pt."""
    c.setStrokeColor(black)
    c.setLineWidth(0.4)
    c.line(x1, y, x2, y)


def _format_tracking(t: str) -> str:
    """Split a tracking number into space-separated 3-digit groups
    from the LEFT (matches how CDEK / Kazpost / Pochta print their
    numbers on real labels: 924 037 531). Strings that contain any
    non-digit (e.g. 'ORD-74') are returned unchanged — they're not
    numeric carrier IDs and the spacing wouldn't make sense."""
    if not t: return ""
    if not t.isdigit():
        return t
    # Group from the left so leading digits stay aligned (matches
    # human reading order in CIS). e.g. "929292696" -> "929 292 696".
    return " ".join(t[i:i+3] for i in range(0, len(t), 3))


# ── Label drawer (canvas-relative — origin (ox, oy) for bottom-left) ──

def _draw_label(c, ox: float, oy: float, w: float, h: float, label: dict):
    """Draw ONE shipping label inside the box (ox, oy, w, h).

    `label` is a dict with keys:
      tracking_number, tracking_url, carrier_name, sender_*, recipient_*,
      items, package_index, package_total, package_weight_g, eta_date.
    """
    pad = 3 * mm
    inner_x = ox + pad
    inner_w = w - 2 * pad
    inner_r = ox + w - pad
    # Cursor walks top → bottom.
    y_top = oy + h - pad

    # ── 1. Header band: sender brand (left) + carrier pill (right) ──
    band_h = 7 * mm
    y_top -= band_h
    sender_name = (label.get("sender_name") or "").strip()
    carrier_name = (label.get("carrier_name") or "").strip()[:30]
    _draw_text(c, inner_x, y_top + 2, sender_name or "Your Store",
               font=_FONT_BOLD, size=11, max_width=inner_w * 0.55)
    if carrier_name:
        cn_size = 11
        cn_w = c.stringWidth(carrier_name, _FONT_BOLD, cn_size) + 12
        cn_x = inner_r - cn_w
        c.setFillColor(black)
        c.roundRect(cn_x, y_top, cn_w, band_h, 2, stroke=0, fill=1)
        c.setFillColor(white)
        c.setFont(_FONT_BOLD, cn_size)
        # Center text vertically inside pill.
        c.drawString(cn_x + 6, y_top + (band_h - cn_size) / 2 + 1, carrier_name)
        c.setFillColor(black)

    # ── 2. Tracking 1D barcode — largest single visual element ──────
    y_top -= 2 * mm
    bc_h = 16 * mm
    y_top -= bc_h
    tracking = (label.get("tracking_number") or "").strip()
    if tracking:
        _draw_barcode_1d(c, inner_x, y_top, inner_w, bc_h, tracking)

    # Human-readable tracking number, centered under the bars with
    # 3-digit grouping. The package index hugs the right edge so it
    # doesn't compete with the centred tracking number.
    y_top -= 5 * mm
    pi = label.get("package_index") or 1
    pt = label.get("package_total") or 1
    pkg_txt = f"{pi}/{pt}"
    c.setFillColor(black)
    c.setFont(_FONT_BOLD, 13)
    pretty_tracking = _format_tracking(tracking) if tracking else "(no tracking)"
    c.drawCentredString((inner_x + inner_r) / 2, y_top, pretty_tracking)
    c.setFont(_FONT_BOLD, 12)
    c.drawRightString(inner_r, y_top, pkg_txt)

    # ── 3. Recipient block ─────────────────────────────────────────
    # Layout depends on what data we have:
    #   • Has city → black highlight block with city + name on the right
    #   • No city but has address → name only, address line below
    #   • Nothing → just "—" name, no block (keeps layout intact)
    y_top -= 3 * mm
    _hairline(c, inner_x, y_top, inner_r)
    y_top -= 3 * mm
    _draw_text(c, inner_x, y_top, "Recipient",
               font=_FONT_REGULAR, size=7, color=HexColor("#666666"))

    # City extraction: explicit field → first segment of comma-split
    # address. If neither, fall through to "name-only" layout below.
    city = (label.get("recipient_city") or "").strip()
    raw_addr = (label.get("recipient_address") or "").strip()
    if not city and "," in raw_addr:
        city = raw_addr.split(",", 1)[0].strip()[:30]

    name = (label.get("recipient_name") or "").strip() or "—"
    if city:
        y_top -= 9 * mm
        block_w = inner_w * 0.58
        _draw_block_label(c, inner_x, y_top, block_w, 8 * mm, city, font_size=13)
        _draw_text(c, inner_x + block_w + 4 * mm, y_top + 2.5 * mm,
                   name, font=_FONT_BOLD, size=11,
                   max_width=inner_w - block_w - 4 * mm)
    else:
        # No city block — just name in larger type, full width.
        y_top -= 6 * mm
        _draw_text(c, inner_x, y_top, name,
                   font=_FONT_BOLD, size=13, max_width=inner_w)

    # Address — wrapped across multiple lines if needed. Without
    # wrapping, a long line like "Tole Bi 273a/4, apt 123, fl 6,
    # entr 5, int 123, 050005, Kazakhstan" overflowed the label and
    # was cut off as "Kaz…". The wrapper breaks on commas first so
    # the line breaks land between logical address segments.
    if raw_addr:
        y_top -= 4 * mm
        for line in _wrap_text(c, raw_addr, _FONT_REGULAR, 9, inner_w):
            _draw_text(c, inner_x, y_top, line,
                       font=_FONT_REGULAR, size=9, max_width=inner_w)
            y_top -= 3.5 * mm
        # Compensate the last decrement so the next block aligns
        # directly under the address (loop overshoots by one row).
        y_top += 3.5 * mm
    phone = (label.get("recipient_phone") or "").strip()
    if phone:
        y_top -= 3.5 * mm
        _draw_text(c, inner_x, y_top, "tel.: " + phone,
                   font=_FONT_REGULAR, size=8, max_width=inner_w)

    # ── 4. Sender block ────────────────────────────────────────────
    # We always print at least the sender_name here (the renderer's
    # caller falls back to project / org name when the merchant hasn't
    # filled crm_document_settings yet — so this field is virtually
    # never empty in practice). Address line only when set.
    sender_addr = (label.get("sender_address") or "").strip()
    if sender_name or sender_addr:
        y_top -= 4 * mm
        _hairline(c, inner_x, y_top, inner_r)
        y_top -= 3 * mm
        _draw_text(c, inner_x, y_top, "Sender",
                   font=_FONT_REGULAR, size=7, color=HexColor("#666666"))
        y_top -= 3.5 * mm
        _draw_text(c, inner_x, y_top, sender_name or "—",
                   font=_FONT_BOLD, size=9, max_width=inner_w)
        if sender_addr:
            y_top -= 3.5 * mm
            _draw_text(c, inner_x, y_top, sender_addr,
                       font=_FONT_REGULAR, size=8, max_width=inner_w)

    # ── 5. Item list (max 3 rows + overflow) ──────────────────────
    y_top -= 4 * mm
    _hairline(c, inner_x, y_top, inner_r)
    y_top -= 3 * mm
    items = label.get("items") or []
    shown = items[:3]
    overflow = max(0, len(items) - 3)
    for idx, it in enumerate(shown, start=1):
        title = (it.get("title") or "").strip()
        qty = int(it.get("quantity") or 1)
        y_top -= 3.5 * mm
        _draw_text(c, inner_x, y_top, f"{idx}. {title}",
                   font=_FONT_REGULAR, size=8,
                   max_width=inner_w - 16 * mm)
        c.setFillColor(black)
        c.setFont(_FONT_REGULAR, 8)
        c.drawRightString(inner_r, y_top, f"× {qty}")
    if overflow:
        y_top -= 3.5 * mm
        _draw_text(c, inner_x, y_top, f"… и ещё {overflow}",
                   font=_FONT_REGULAR, size=7,
                   color=HexColor("#666666"))

    # ── 6. Footer: QR + weight + ETA ───────────────────────────────
    # Anchor at the bottom of the inner area so we never overlap items.
    footer_top = oy + pad + 28 * mm
    qr_size = 24 * mm
    qr_x = inner_r - qr_size
    qr_y = oy + pad
    tracking_url = (label.get("tracking_url") or "").strip()
    if tracking_url:
        _draw_qr(c, qr_x, qr_y, qr_size, tracking_url)
        # Carrier host under the QR — confirms where scanning will lead.
        host = tracking_url.split("/")[2] if "://" in tracking_url else ""
        if host:
            _draw_text(c, qr_x, qr_y - 2.5 * mm, host,
                       font=_FONT_REGULAR, size=6,
                       color=HexColor("#666666"),
                       max_width=qr_size)

    # Left of the QR: weight, package count, ETA.
    info_x = inner_x
    info_y = qr_y + qr_size - 4 * mm
    weight_g = label.get("package_weight_g")
    if weight_g:
        kg = weight_g / 1000.0
        _draw_text(c, info_x, info_y, f"Weight ≈ {kg:.1f} kg",
                   font=_FONT_BOLD, size=11)
        info_y -= 4.5 * mm
    if pt and pt > 1:
        _draw_text(c, info_x, info_y, f"Packages: {pt}",
                   font=_FONT_REGULAR, size=9)
        info_y -= 4 * mm
    eta = (label.get("eta_date") or "").strip()
    if eta:
        _draw_text(c, info_x, info_y, f"ETA: {eta}",
                   font=_FONT_REGULAR, size=8)


# ── Page-level layouts ──────────────────────────────────────────────────

def _render_thermal_100x150(labels):
    buf = BytesIO()
    pagesize = (100 * mm, 150 * mm)
    c = pdf_canvas.Canvas(buf, pagesize=pagesize)
    for label in labels:
        _draw_label(c, 0, 0, 100 * mm, 150 * mm, label)
        c.showPage()
    c.save()
    return buf.getvalue()


def _render_a4_1(labels):
    buf = BytesIO()
    c = pdf_canvas.Canvas(buf, pagesize=A4)
    page_w, page_h = A4
    label_w = 120 * mm
    label_h = 180 * mm
    for label in labels:
        ox = (page_w - label_w) / 2
        oy = (page_h - label_h) / 2
        c.setDash(1, 2)
        c.setStrokeColor(HexColor("#999999"))
        c.rect(ox, oy, label_w, label_h, stroke=1, fill=0)
        c.setDash()
        _draw_label(c, ox, oy, label_w, label_h, label)
        c.showPage()
    c.save()
    return buf.getvalue()


def _render_a4_2(labels):
    buf = BytesIO()
    c = pdf_canvas.Canvas(buf, pagesize=A4)
    page_w, page_h = A4
    label_w = 190 * mm
    label_h = 140 * mm
    margin_x = (page_w - label_w) / 2
    margin_y = (page_h - label_h * 2) / 3
    pos = [(margin_x, page_h - margin_y - label_h),
           (margin_x, margin_y)]
    page_labels = []
    for label in labels:
        page_labels.append(label)
        if len(page_labels) == 2:
            for (lx, ly), lab in zip(pos, page_labels):
                c.setDash(1, 2); c.setStrokeColor(HexColor("#999999"))
                c.rect(lx, ly, label_w, label_h, stroke=1, fill=0)
                c.setDash()
                _draw_label(c, lx, ly, label_w, label_h, lab)
            c.showPage()
            page_labels = []
    if page_labels:
        for (lx, ly), lab in zip(pos, page_labels):
            c.setDash(1, 2); c.setStrokeColor(HexColor("#999999"))
            c.rect(lx, ly, label_w, label_h, stroke=1, fill=0)
            c.setDash()
            _draw_label(c, lx, ly, label_w, label_h, lab)
        c.showPage()
    c.save()
    return buf.getvalue()


def _render_a4_4(labels):
    buf = BytesIO()
    c = pdf_canvas.Canvas(buf, pagesize=A4)
    page_w, page_h = A4
    label_w = 95 * mm
    label_h = 135 * mm
    gutter_x = (page_w - label_w * 2) / 3
    gutter_y = (page_h - label_h * 2) / 3
    positions = [
        (gutter_x,                  page_h - gutter_y - label_h),
        (gutter_x * 2 + label_w,    page_h - gutter_y - label_h),
        (gutter_x,                  gutter_y),
        (gutter_x * 2 + label_w,    gutter_y),
    ]
    page_labels = []
    for label in labels:
        page_labels.append(label)
        if len(page_labels) == 4:
            for (lx, ly), lab in zip(positions, page_labels):
                c.setDash(1, 2); c.setStrokeColor(HexColor("#999999"))
                c.rect(lx, ly, label_w, label_h, stroke=1, fill=0)
                c.setDash()
                _draw_label(c, lx, ly, label_w, label_h, lab)
            c.showPage()
            page_labels = []
    if page_labels:
        for (lx, ly), lab in zip(positions, page_labels):
            c.setDash(1, 2); c.setStrokeColor(HexColor("#999999"))
            c.rect(lx, ly, label_w, label_h, stroke=1, fill=0)
            c.setDash()
            _draw_label(c, lx, ly, label_w, label_h, lab)
        c.showPage()
    c.save()
    return buf.getvalue()


# ── Public entry point ──────────────────────────────────────────────────

_LAYOUTS = {
    "thermal_100x150": _render_thermal_100x150,
    "a4_1":            _render_a4_1,
    "a4_2":            _render_a4_2,
    "a4_4":            _render_a4_4,
}


def render_shipping_labels(labels: list[dict], format: str = "thermal_100x150") -> bytes:
    """Render N labels into a single PDF.

    Each label dict carries the fully-resolved per-order data — the
    renderer does NO database lookups. Caller resolves carrier name +
    tracking URL + items + branding upstream and hands a flat shape in.
    """
    fn = _LAYOUTS.get(format) or _render_thermal_100x150
    return fn(labels)
