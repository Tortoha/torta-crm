# Cart & Orders

The full shopping flow: cart → promo → checkout → order history → returns.

## Cart

```js
const { data: cart } = await client.cart.get();
```

Each line carries `base_price` (SKU price without modifiers), `price` (unit price *including* modifier deltas) and `modifiers` (the selected modifier items with `name`, `price_delta`, `group_name`). The cart also returns a `subtotal`.

### Add an item

`add` takes positional arguments — IDs come from the product page ([Catalog](/docs/catalog)):

```js
// add(product_id, variation_id, configuration_id, quantity = 1, modifierItemIds = [])
await client.cart.add(productId, variationId, configurationId, 1);

// With modifiers (ids from product.modifier_groups[*].items[*].id)
await client.cart.add(productId, variationId, configurationId, 1, [12, 47]);
```

The server validates each modifier id against the product's groups (min/max/required/radio rules). Two lines with the same SKU but different modifier sets stay separate; identical sets merge (quantity bumps).

### Update / remove

```js
await client.cart.update(cartItemId, 3);           // change quantity
await client.cart.update(cartItemId, 3, [12, 47]); // also replace the modifier set
await client.cart.remove(cartItemId);
```

## Promo codes

```js
const r = await client.promos.apply("SUMMER10");
if (!r.ok) toast(r.error); // invalid / expired codes come back as a string
```

## Saved addresses

A per-user address book so customers don't retype at checkout.

```js
const { data } = await client.addresses.list();

await client.addresses.add({
  label: "Home",            // optional
  country: "KZ",            // optional
  city: "Almaty",           // required
  postal_code: "050000",    // optional
  street: "Abay 10",        // required
  apartment: "12",          // optional
  is_default: true,         // optional
});

await client.addresses.setDefault(id); // clears default on the others
await client.addresses.remove(id);
```

## Place an order

```js
const r = await client.orders.place({
  recipient_name: "Aizhan",          // required
  phone: "+77071234567",
  delivery_method: "courier",        // "courier" | "postal" (default courier)
  address_country: "KZ",
  address_city: "Almaty",
  address_postal_code: "050000",
  address_street: "Abay 10",
  address_apartment: "12",
  comment: "Call before arrival",
  payment_method: "stripe",          // chosen method: "stripe" | "manual" | "other"
  promo_code: "SUMMER10",            // optional
});
```

> The structured `address_*` fields are preferred. A legacy single `address` string still works — the backend composes it for you.

> `payment_method` is the method the customer picked — read the enabled ones from `client.config.get().payment_methods`. For a card (`stripe`) order, run the `initPayment` flow first; offline methods (`manual` / `other`) place directly. See [Payments](/docs/payments-api).

## Order history

```js
const { data: orders } = await client.orders.list();
```

## Cancel an order

Allowed while the order is `new`, `confirmed` or `shipped`. Stock side-effects are reversed automatically (reservation released, or units restocked for shipped). `delivered` orders can't be cancelled — use a return instead.

```js
await client.orders.cancel(orderId);
```

## Returns

A 14-day window after delivery.

```js
await client.orders.requestReturn(orderId, {
  reason: "damaged", // damaged | wrong_item | not_as_described | changed_mind | arrived_late | quality_issue | other
  customer_message: "Box arrived crushed",
  items: [{ order_item_id: 88, quantity: 1 }],
  customer_photos: ["https://…/proof.jpg"], // optional, uploaded separately
});

const { data } = await client.orders.listReturns(orderId);

// Cancel a return you submitted — only while status is still "requested"
await client.orders.cancelReturn(orderId, returnId);
```

## Shipping & pickup

```js
// Warehouses the merchant opened for in-store pickup (address + hours + phone)
const { data: spots } = await client.shipping.pickupLocations();

// Aggregate delivery estimate for the "Delivery in 2–4 days" hint
const { data } = await client.shipping.deliveryEta(); // { min_days, max_days }
```

`deliveryEta` returns `null` fields when no warehouse has an ETA configured — hide the hint in that case.
