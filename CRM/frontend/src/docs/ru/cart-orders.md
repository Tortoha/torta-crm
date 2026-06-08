# Корзина и заказы

Полный путь покупки: корзина → промокод → оформление → история заказов → возвраты.

## Корзина

```js
const { data: cart } = await client.cart.get();
```

Каждая строка содержит `base_price` (цена SKU без модификаторов), `price` (цена за единицу *с учётом* надбавок модификаторов) и `modifiers` (выбранные модификаторы с `name`, `price_delta`, `group_name`). Корзина также возвращает `subtotal`.

### Добавить товар

`add` принимает позиционные аргументы — ID берутся со страницы товара ([Каталог](/docs/catalog)):

```js
// add(product_id, variation_id, configuration_id, quantity = 1, modifierItemIds = [])
await client.cart.add(productId, variationId, configurationId, 1);

// С модификаторами (id из product.modifier_groups[*].items[*].id)
await client.cart.add(productId, variationId, configurationId, 1, [12, 47]);
```

Сервер проверяет каждый id модификатора против групп товара (правила min/max/required/radio). Две строки с одинаковым SKU, но разными наборами модификаторов остаются раздельными; одинаковые наборы объединяются (количество увеличивается).

### Обновить / удалить

```js
await client.cart.update(cartItemId, 3);           // изменить количество
await client.cart.update(cartItemId, 3, [12, 47]); // и заменить набор модификаторов
await client.cart.remove(cartItemId);
```

## Промокоды

```js
const r = await client.promos.apply("SUMMER10");
if (!r.ok) toast(r.error); // неверные / просроченные коды приходят строкой
```

## Сохранённые адреса

Адресная книга пользователя, чтобы клиенты не вводили адрес заново при оформлении.

```js
const { data } = await client.addresses.list();

await client.addresses.add({
  label: "Дом",             // необязательно
  country: "KZ",            // необязательно
  city: "Алматы",           // обязательно
  postal_code: "050000",    // необязательно
  street: "Абая 10",        // обязательно
  apartment: "12",          // необязательно
  is_default: true,         // необязательно
});

await client.addresses.setDefault(id); // снимает «по умолчанию» с остальных
await client.addresses.remove(id);
```

## Оформить заказ

```js
const r = await client.orders.place({
  recipient_name: "Айжан",           // обязательно
  phone: "+77071234567",
  delivery_method: "courier",        // "courier" | "postal" (по умолчанию courier)
  address_country: "KZ",
  address_city: "Алматы",
  address_postal_code: "050000",
  address_street: "Абая 10",
  address_apartment: "12",
  comment: "Позвонить перед приездом",
  payment_method: "stripe",          // выбранный метод: "stripe" | "manual" | "other"
  promo_code: "SUMMER10",            // необязательно
});
```

> Предпочтительны структурированные поля `address_*`. Устаревшая единая строка `address` тоже работает — бэкенд соберёт её за вас.

> `payment_method` — это метод, который выбрал клиент; список включённых берите из `client.config.get().payment_methods`. Для заказа картой (`stripe`) сначала запустите поток `initPayment`; офлайн-методы (`manual` / `other`) оформляются напрямую. См. [Платежи](/docs/payments-api).

## История заказов

```js
const { data: orders } = await client.orders.list();
```

Каждый заказ содержит `items`, статус и суммы. Заказ с **цифровыми товарами** дополнительно включает массив `downloads` — `[{ label, url }]`, готовый к отрисовке как ссылки на скачивание (одна запись на ZIP-архив или по одной на файл). Витрина показывает их на странице успеха заказа и в «Мои заказы»; они же приходят на почту.

## Отмена заказа

Разрешена, пока заказ в статусе `new`, `confirmed` или `shipped`. Последствия для склада откатываются автоматически (резерв снимается, а для отгруженного — единицы возвращаются на склад). Доставленные (`delivered`) заказы отменить нельзя — оформляйте возврат.

```js
await client.orders.cancel(orderId);
```

## Возвраты

Окно 14 дней после доставки.

```js
await client.orders.requestReturn(orderId, {
  reason: "damaged", // damaged | wrong_item | not_as_described | changed_mind | arrived_late | quality_issue | other
  customer_message: "Коробка пришла помятой",
  items: [{ order_item_id: 88, quantity: 1 }],
  customer_photos: ["https://…/proof.jpg"], // необязательно, загружается отдельно
});

const { data } = await client.orders.listReturns(orderId);

// Отменить свой запрос на возврат — только пока статус ещё "requested"
await client.orders.cancelReturn(orderId, returnId);
```

## Доставка и самовывоз

```js
// Склады, открытые продавцом для самовывоза (адрес + часы + телефон)
const { data: spots } = await client.shipping.pickupLocations();

// Сводная оценка доставки для подсказки «Доставка за 2–4 дня»
const { data } = await client.shipping.deliveryEta(); // { min_days, max_days }
```

`deliveryEta` возвращает `null` в полях, если ни на одном складе не настроена оценка — в этом случае подсказку стоит скрыть.
