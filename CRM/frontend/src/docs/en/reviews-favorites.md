# Reviews & Favorites

Customer engagement: wishlists, product reviews with photos and voting, and restock alerts.

## Favorites

> Note the asymmetry: you **add** by numeric product id but **remove** by product hash.

```js
const { data } = await client.favorites.list(); // favorited product ids

await client.favorites.add(productId);     // numeric id
await client.favorites.remove(productHash); // hash
```

## Reviews

```js
await client.reviews.add(productId, 5, "Great fit, fast delivery");
await client.reviews.delete(reviewId); // own review only
```

### Photos

Up to 5 photos per review. Upload the image to your project's S3 bucket first, then attach the resulting URL — external URLs are rejected.

```js
await client.reviews.attachPhoto(reviewId, "https://your-bucket.s3.../photo.jpg");
await client.reviews.deletePhoto(photoId);
```

### Helpful votes

Vote on *other* people's reviews.

```js
await client.reviews.vote(reviewId, true);  // helpful
await client.reviews.vote(reviewId, false); // not helpful
await client.reviews.unvote(reviewId);      // withdraw your vote
```

## Restock alerts

Notify a visitor by email when an out-of-stock product (or a specific SKU) is back. Works for anonymous visitors too — then `email` is required.

```js
// subscribe(product_id, sku_id?, email?)
await client.restock.subscribe(productId);                       // logged-in, whole product
await client.restock.subscribe(productId, skuId);                // logged-in, one SKU
await client.restock.subscribe(productId, skuId, "me@mail.com"); // anonymous
```
