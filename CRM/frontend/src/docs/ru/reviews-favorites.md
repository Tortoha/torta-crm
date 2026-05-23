# Отзывы и избранное

Вовлечение клиентов: списки желаемого, отзывы о товарах с фото и голосованием, уведомления о поступлении.

## Избранное

> Обратите внимание на асимметрию: **добавляют** по числовому id товара, а **удаляют** по hash товара.

```js
const { data } = await client.favorites.list(); // id избранных товаров

await client.favorites.add(productId);     // числовой id
await client.favorites.remove(productHash); // hash
```

## Отзывы

```js
await client.reviews.add(productId, 5, "Отличная посадка, быстрая доставка");
await client.reviews.delete(reviewId); // только свой отзыв
```

### Фото

До 5 фото на отзыв. Сначала загрузите изображение в S3-бакет вашего проекта, затем прикрепите полученный URL — внешние URL отклоняются.

```js
await client.reviews.attachPhoto(reviewId, "https://your-bucket.s3.../photo.jpg");
await client.reviews.deletePhoto(photoId);
```

### Голоса «полезно»

Голосуйте за *чужие* отзывы.

```js
await client.reviews.vote(reviewId, true);  // полезно
await client.reviews.vote(reviewId, false); // не полезно
await client.reviews.unvote(reviewId);      // отозвать свой голос
```

## Уведомления о поступлении

Уведомить посетителя по email, когда товар (или конкретный SKU) снова появится в наличии. Работает и для анонимных посетителей — тогда `email` обязателен.

```js
// subscribe(product_id, sku_id?, email?)
await client.restock.subscribe(productId);                       // вошедший, весь товар
await client.restock.subscribe(productId, skuId);                // вошедший, один SKU
await client.restock.subscribe(productId, skuId, "me@mail.com"); // анонимный
```
