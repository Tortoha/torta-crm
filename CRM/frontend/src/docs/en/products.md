# Products

**Project → Products** is the biggest area of the console — the catalog plus everything around it: variations, stock, batches, pricing, warehouses and categories. It's a set of tabs; this page walks through each one, and through building a product.

Every product is one of three **types**:

- **Physical** — has variations, stock, warehouses, batches, shipping. The full system.
- **Digital** — a downloadable file; no stock or shipping.
- **Service** — a bookable service, linked to the [Booking](/docs/booking-page) page.

Prices everywhere use your project's currency (set in [Settings](/docs/settings)).

---

## The product list

The default tab. Products load 50 at a time as you scroll and are grouped **Physical → Digital → Services**.

**Toolbar:**

- **Search** — filter by title as you type.
- **Sort** — by name, price or date; click again to flip the direction.
- **Category filter** — All / Uncategorized / a specific category (you can create one inline).
- **Status** — All / Active / Paused.
- **Grid / List** view toggle.
- **Import / Export** — import products from a CSV, or export the catalog (or just the selected rows) to CSV.
- **+ New product** — title, optional subtitle/description, category, and type.

**Each product** shows its cover image (click for the full photo set), title, price (a single value or a `$30–$45` range), total stock, rating and a category badge. Paused products drop to the bottom and can only be opened from their menu.

**Per-product menu (⋮ or right-click):**

| Action | What it does |
|--------|--------------|
| **Edit** | open the product to configure it |
| **Duplicate** | clone the whole product |
| **Print barcode** | open the barcode print dialog (physical only) |
| **Pause / Resume** | hide from / show on the storefront |
| **Archive / Restore** | move to the Archive view (archived products are off-sale but kept) |
| **Delete** | permanently remove (with confirmation) |

**Bulk mode** — select several products (right-click → Select) to get a bottom toolbar: set category, adjust price by ±%, pause/resume, archive, print barcodes, or delete — all at once.

### CSV import

Drag in a `.csv` (columns: `title` required, plus `subtitle, description, product_type, category, variation_name, configuration_name, sku_code, sku_barcode, price, stock_quantity`). The import runs a **dry-run** first — it reports how many products and SKUs would be created and any per-row errors — then you **Commit** to import for real.

### Barcode printing

A dedicated dialog with a live print preview. You choose what to encode (product SKU, configuration SKU, batch, EAN-13…), the **symbology** (Code128, EAN-13, QR, and more), the **label format** (thermal 50×30 / 70×40, or A4 sheets), what to show on the label (title / SKU / price), and copies per row. A checkbox tree lets you print exactly the products/variations/SKUs you want. Every product and SKU is auto-assigned a valid EAN-13, so scanning always works.

---

## Building a product

Open a product to configure it. **Everything auto-saves as you type** (a small toast confirms), and most edits can be **undone** from that toast.

### Multi-layer configuration — the key concept

This is the most important idea to understand. A product can have **1 to 5 nested configuration layers**, so you model variations exactly as they exist:

- **Layer 1** is a grid of cards — e.g. **colors**. Each card has a photo gallery, a name, and **Price / Cost / Weight**.
- **Layer 2–5** are tables nested under each Layer-1 card — e.g. **sizes** under each color. Click a card to drill into its rows. The deepest level is the **leaf** (the actual sellable **SKU**).
- Add a deeper layer with **+ Create Configuration Layer**; you only need as many layers as the product has (a simple product can stay on Layer 1 alone).

**Price inheritance.** Price is optional below Layer 1 — if you leave a size's price blank, it **inherits** the nearest parent's price (the placeholder shows what it'll use). So you can set one price on a color and let all sizes follow, or override individual sizes. The same idea applies to automatic discounts (below).

**Stock lives on the leaf.** You never type stock here — it's added by *receiving inventory* (see Inventory & Batches). A color or product simply shows the **sum** of its children's stock.

**Copy to siblings.** Built one color's full set of sizes? One click copies that structure to every other color.

### The other building blocks

Depending on the product type, the detail page also has:

- **General** — title, subtitle, description, category, type.
- **Photos** — per variation: upload images / video / 3D, reorder (first = cover), or add by URL.
- **Modifiers** (physical) — add-on groups like "extra cheese / no onion": checkbox or radio, min/max, required, with a price delta per option. These flow through to the cart.
- **Specifications** — key/value attributes, optionally grouped, attached to whichever layer they describe.
- **Custom fields** — your own typed fields (text, number, boolean, date, file, JSON). A field can be **global** (shared by every product).
- **SEO** — SEO title, meta description, keywords.
- **Service details** (service type) — duration, capacity, "requires staff", price — wired to Booking.
- **Digital files** (digital type) — the file(s) delivered in the order email.

### Product detail tabs

| Tab | What's there |
|-----|--------------|
| **Overview** | everything above — the configuration and content |
| **Settings** | per-product & per-SKU options: barcodes/brand/HS code, dimensions, **scheduled sale price (start/end)**, shipping class & lead time, backorders, pre-order, B2B (MOQ, net terms, purchase orders), social image |
| **Edit history** | read-only **stock log** (every change, who, why, which batch) + the **restock waitlist** (shoppers who asked to be notified) |
| **Reviews** | storefront reviews for this product (read-only) |
| **API preview** | the exact JSON the public API returns for this product — a developer aid ([Catalog](/docs/catalog)) |

---

## Categories

A **flat** list (no parent/child nesting). Create categories, then open one to rename it and tick which products belong. Deleting a category offers three modes: keep the products (they become uncategorized), move them to another category, or delete the products too (type-to-confirm).

---

## Inventory

The stock view for physical products, as an expandable **Warehouse → Product → Variation → SKU** tree. Each row shows price, cost, profit and margin (thin margins flagged), plus stock and sold counts that roll up from the SKUs.

- Filter to **All / Low / Out-of-stock** (low = 1–10 units).
- **Add stock** opens the receive wizard; **Distribute** opens the transfer wizard.
- **Edit a SKU** to adjust its stock by a +/- amount against a chosen warehouse and **batch**, with a reason (delivery, return, recount, damage…) and note.

The mental model: **stock is tracked per SKU, per warehouse, in batches.** Every higher number is just a sum.

---

## Batches

Received inventory is tracked in **batches** (lots) — useful for shelf-life, recalls and cost. Each batch shows remaining vs received, production/expiry dates, and a status (**Active / Frozen / Depleted**).

- **Receive** a batch: SKU, warehouse, quantity, cost per unit, optional name (auto-named otherwise), production & expiry dates.
- **Freeze** a batch to stop it being sold; **edit** dates/notes; **delete** only while it's untouched.
- **FIFO / LIFO** — a project setting decides whether sales draw from the oldest batch first (FIFO) or newest (LIFO).

---

## Pricing: three different tools

These are easy to confuse, so here's the difference:

| Tool | What it is | Who triggers it |
|------|-----------|-----------------|
| **Promo codes** | a coupon the customer **types at checkout** | the customer |
| **Discounts** | an **automatic sale price** shown to everyone | nobody — it's always on |
| **Tier pricing** | **wholesale "buy N+, pay less each"** ladders | quantity in the cart |

- **Promo codes** — percentage or fixed amount, with min order, usage limits (total + per-user), a validity window, and an optional category restriction.
- **Discounts** — set on a product, variation or single SKU, as percent-off / amount-off / a fixed price, with an optional schedule. Discounts **inherit down** the layer tree like prices do, and the row shows the before → after price.
- **Tier pricing** — per-SKU ladders (e.g. *10+ → $8 each, 50+ → $6 each*) for B2B / bulk buyers.

---

## Warehouses

Define your stock locations. Each warehouse has an address, a contact, and **storefront fulfilment** settings: allow **pickup** (+ hours) and a **delivery ETA** (min–max days) that powers the "Delivery in 2–4 days" hint. One warehouse is the **default** (new SKUs seed their stock there; it can't be deleted).

Stock isn't edited here — moving units between warehouses is done with the **transfer wizard** (from Inventory).

---

## Products Settings

Catalog-wide defaults and rules:

- **Bulk-apply defaults** — stamp values (shipping class, lead time, low-stock threshold, backorders, B2B terms…) onto **all** products at once; a confirmation shows the change first.
- **SKU generation** — how new SKUs are formed (numeric / letters / alphanumeric / manual + length), with a "regenerate all" action.
- **Batch grouping & naming** — how auto-named batches are scoped, and a naming template with date/sequence tokens and a live preview.
