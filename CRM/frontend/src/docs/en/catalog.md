# Catalog

Read-only product, category and store-config data. None of these require a logged-in user.

## Store config

Call once on bootstrap so prices render with the right currency on first paint (otherwise they flash from `$100` to `100₸` on hydration).

```js
const { data } = await client.config.get();
// { currency, name, timezone, … }
```

## Products

```js
// All products
const { data } = await client.products.list();

// Only one category (by slug)
await client.products.list({ category: 'trousers' });

// Only products with no category
await client.products.list({ uncategorized: true });
```

Get a single product's full page by its hash id:

```js
const { data: product } = await client.products.get(productHash);
```

The product object carries its variations, sizes/configurations, images and `modifier_groups` (with `items` you reference when adding to the cart — see [Cart & Orders](/docs/cart-orders)).

For a **digital** product (`product_type: "digital"`) the object also includes a `downloads` array — `[{ label, url }]`, the buyer's download links (one entry for the single-ZIP bundle, or one per file). Empty for physical / service products.

## Categories

```js
const { data } = await client.categories.list();
// [{ id, name, slug, products_count }, …]
```

Feed a category's `slug` straight into `client.products.list({ category: slug })`.
