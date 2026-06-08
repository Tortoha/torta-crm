# Каталог

Данные о товарах, категориях и конфигурации магазина — только чтение. Ни один из этих вызовов не требует входа пользователя.

## Конфигурация магазина

Вызовите один раз при старте, чтобы цены сразу отрисовались в нужной валюте (иначе они мигнут с `$100` на `100₸` при гидратации).

```js
const { data } = await client.config.get();
// { currency, name, timezone, … }
```

## Товары

```js
// Все товары
const { data } = await client.products.list();

// Только одна категория (по slug)
await client.products.list({ category: 'trousers' });

// Только товары без категории
await client.products.list({ uncategorized: true });
```

Получить полную страницу одного товара по его hash-id:

```js
const { data: product } = await client.products.get(productHash);
```

Объект товара содержит свои вариации, размеры/конфигурации, изображения и `modifier_groups` (с `items`, на которые вы ссылаетесь при добавлении в корзину — см. [Корзина и заказы](/docs/cart-orders)).

Для **цифрового** товара (`product_type: "digital"`) объект также включает массив `downloads` — `[{ label, url }]`, ссылки на скачивание для покупателя (одна запись на ZIP-архив или по одной на файл). Пустой для физических / услуг.

## Категории

```js
const { data } = await client.categories.list();
// [{ id, name, slug, products_count }, …]
```

Передавайте `slug` категории прямо в `client.products.list({ category: slug })`.
