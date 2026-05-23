# Tracking

Analytics events under `client.track`. Every method is **fire-and-forget** — it never returns a promise you need to await and never throws, so analytics can't break the shopping flow. In the browser the SDK auto-enriches each event with referrer, UTM params, language and screen width.

## Page & product views

```js
client.track.visit();              // call once per page load
client.track.productView(productId); // on a product page
```

## Search

Log what users type in the search bar. Pass `results_count` so the merchant can spot zero-result queries (catalog gaps).

```js
client.track.search("red dress", results.length);
client.track.search("xyz", 0); // highlights a gap
```

## Cart events

```js
// action: add | remove | update_qty | apply_promo | remove_promo
client.track.cartEvent("add", { product_id: 12, quantity: 1 });
```

## Checkout funnel

```js
// step: started | address_filled | promo_tried | submitted | failed
client.track.checkout("started");
client.track.checkout("failed", { fail_reason: "payment_declined" });
```

## Custom goals

Fire a custom event. The `event_name` must match an active custom-event goal configured in the merchant's CRM — otherwise the call is silently ignored.

```js
client.track.goal("newsletter_signup");
client.track.goal("vip_upgrade", 4990, { plan: "gold" }); // optional value + metadata
```
