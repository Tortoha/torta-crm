# Платежи

Как работает оформление заказа через API — и как оно защищено.

У магазина может быть **несколько включённых методов оплаты одновременно** (Stripe, Manual, Other). Клиент выбирает один при оформлении и шлёт его в `payment_method`. Онлайн-методы (карта) требуют проверенной сервером оплаты до создания заказа; офлайн-методы записываются, а мерчант подтверждает их позже.

## Поток

Всегда начинайте с `initPayment`, передавая **тот же payload**, что и в `orders.place` (включая выбранный `payment_method`):

```js
const init = await client.payments.initPayment(payload);
// init.data → { provider, needs_payment_intent, client_secret,
//               publishable_key, amount, currency, is_test_mode }
```

Дальше ветвитесь по `needs_payment_intent`.

### Карта (Stripe) — `needs_payment_intent: true`

Бэкенд создал реальный Stripe PaymentIntent. Соберите карту через Stripe.js, затем оформите заказ с подтверждённым intent id:

```js
import { loadStripe } from "@stripe/stripe-js";

const stripe   = await loadStripe(init.data.publishable_key);
const elements = stripe.elements({ clientSecret: init.data.client_secret });
// смонтируйте <PaymentElement> … затем, на сабмите:
const { paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });

if (paymentIntent?.status === "succeeded") {
  await client.orders.place({ ...payload, payment_intent_id: paymentIntent.id });
}
```

Данные карты идут **браузер → Stripe напрямую** — они не касаются нашего бэкенда. Заказ создаётся как **`paid`**.

### Офлайн (Manual / Other) — `needs_payment_intent: false`

Онлайн-оплаты нет. Просто оформите заказ:

```js
await client.orders.place(payload);   // payload.payment_method = "manual" | "other"
```

Он записывается сразу, со статусом, отражающим метод:

- **`manual`** (наличные / при доставке) → записан как учтённый.
- **`other`** (внешний шлюз) → записан как **`pending`**: есть в CRM, но **не** считается оплаченной выручкой, пока мерчант не подтвердит («Mark as paid» на странице Orders).

## Чтение конфига витрины

`client.config.get()` возвращает методы, включённые у магазина, чтобы ваш чекаут отрисовал правильный выбор:

```js
const cfg = await client.config.get();
// cfg.data.payment_methods → [{ method, label, instructions, online }]
```

Отрисуйте по одной опции на запись. Для `online: true` (Stripe) запускайте поток `initPayment` → карта; иначе оформляйте заказ напрямую и показывайте `instructions` (например, реквизиты Kaspi) покупателю.

## Как это защищено

Для онлайн-метода `POST /orders` повторно запрашивает PaymentIntent **server-to-server** и отклоняет заказ, пока провайдер не подтвердит оплату (Stripe → `succeeded`). Также отклоняется повторно использованный intent id (один intent → один заказ). А выбранный `payment_method` проверяется против **включённых** методов магазина. Итого:

- Нельзя создать **оплаченный** заказ без реальной, подтверждённой провайдером оплаты.
- Нельзя обойти обязательную карту, отправив `payment_method: "manual"` — если у магазина включена только карта, сервер форсит путь с картой; невалидный выбор отклоняется.
- Заказы `other` всегда создаются **pending**, для подтверждения мерчантом.

## Три ключа

В Torta трёхключевая модель. Используйте нужный ключ для нужного контекста:

| Ключ | Где | Заголовок | Для чего |
|---|---|---|---|
| **Public key** | В пути URL | — | Идентифицирует магазин. Можно раскрывать. |
| **Publishable key** | Браузер | `X-Publishable-Key` | Витрина (корзина, оформление, заказы). Проверяется на каждом запросе. |
| **Secret key** | **Только сервер** | `X-Secret-Key` | Доверенные сервер-сервер записи (напр. [приём клиентов](/docs/customers)). **Никогда не отдавайте в браузер.** |

Оформление идёт в браузере, поэтому использует **publishable** ключ — требовать там secret означало бы светить его каждому посетителю, ровно то, ради чего publishable и существует. Publishable только *идентифицирует* магазин: он не может двигать деньги (это может только проверенный сервером PaymentIntent), а созданные им офлайн-заказы не оплачены и подтверждаются мерчантом.

См. также: [Корзина и заказы](/docs/cart-orders) · [Приём клиентов](/docs/customers).
