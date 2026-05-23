# Аналитика

События аналитики под `client.track`. Каждый метод работает по принципу **«отправил и забыл»** — он не возвращает промис, который нужно ждать, и не бросает исключений, поэтому аналитика не может сломать процесс покупки. В браузере SDK автоматически дополняет каждое событие реферером, UTM-метками, языком и шириной экрана.

## Просмотры страниц и товаров

```js
client.track.visit();              // вызывайте один раз на загрузку страницы
client.track.productView(productId); // на странице товара
```

## Поиск

Логируйте, что пользователи вводят в строку поиска. Передавайте `results_count`, чтобы продавец видел запросы без результатов (пробелы в каталоге).

```js
client.track.search("красное платье", results.length);
client.track.search("xyz", 0); // подсвечивает пробел в каталоге
```

## События корзины

```js
// action: add | remove | update_qty | apply_promo | remove_promo
client.track.cartEvent("add", { product_id: 12, quantity: 1 });
```

## Воронка оформления

```js
// step: started | address_filled | promo_tried | submitted | failed
client.track.checkout("started");
client.track.checkout("failed", { fail_reason: "payment_declined" });
```

## Кастомные цели

Отправить кастомное событие. `event_name` должно совпадать с активной целью-кастомным-событием, настроенной в CRM продавца — иначе вызов тихо игнорируется.

```js
client.track.goal("newsletter_signup");
client.track.goal("vip_upgrade", 4990, { plan: "gold" }); // необязательные значение + метаданные
```
