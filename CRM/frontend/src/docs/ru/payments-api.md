# Платежи

Как работает оформление через API — и как оно защищено.

Платежи работают в **строгом режиме**: если у магазина подключён реальный провайдер, заказ **нельзя** создать без оплаты, проверенной сервером. Это решает *провайдер магазина* (заданный в CRM), а не поле в запросе — поэтому клиент не может «понизить» себя до manual, чтобы не платить.

## Поток

Всегда начинайте с `initPayment`, передавая **тот же payload**, что и в `orders.place`:

```js
const init = await client.payments.initPayment(payload);
// init.data → { provider, needs_payment_intent, client_secret,
//               publishable_key, amount, currency, is_test_mode }
```

Дальше ветвитесь по `needs_payment_intent`.

### Stripe — `needs_payment_intent: true`

Бэкенд создал реальный Stripe PaymentIntent. Соберите карту через Stripe.js и оформите заказ с подтверждённым intent id:

```js
import { loadStripe } from "@stripe/stripe-js";

const stripe   = await loadStripe(init.data.publishable_key);
const elements = stripe.elements({ clientSecret: init.data.client_secret });
// смонтируйте <PaymentElement> … затем, на сабмите:
const { paymentIntent } = await stripe.confirmPayment({
  elements,
  redirect: "if_required",
});

if (paymentIntent?.status === "succeeded") {
  await client.orders.place({ ...payload, payment_intent_id: paymentIntent.id });
}
```

Данные карты идут **браузер → Stripe напрямую** — они не касаются нашего бэкенда.

### Manual / Other — `needs_payment_intent: false`

Онлайн-оплаты нет. Просто оформляйте заказ — он записывается со `payment_status: "manual"` (ожидает, **не** оплачен). Мерчант подтверждает деньги офлайн.

```js
await client.orders.place(payload);
```

## Как проверяется оплата

Для подключённого провайдера `POST /orders` **сервер-сервер** перезапрашивает PaymentIntent и отклоняет заказ, пока провайдер не сообщит об оплате (Stripe → `succeeded`). Повторно использованный intent id тоже отклоняется (один intent — один заказ). Итого:

- **Нельзя** создать *оплаченный* заказ без реальной, подтверждённой провайдером оплаты.
- **Нельзя** пропустить оплату, прислав `payment_method: "manual"` — решает провайдер магазина.
- Manual-заказы всегда **ожидают** подтверждения мерчантом.

## Три ключа

В Torta трёхключевая модель. Используйте нужный ключ для нужного контекста:

| Ключ | Где | Заголовок | Для чего |
|---|---|---|---|
| **Public key** | В пути URL | — | Идентифицирует магазин. Можно раскрывать. |
| **Publishable key** | Браузер | `X-Publishable-Key` | Витрина (корзина, оформление, заказы). Проверяется на каждом запросе. |
| **Secret key** | **Только сервер** | `X-Secret-Key` | Доверенные сервер-сервер записи (напр. [импорт клиентов](/docs/customers)). **Никогда не отдавайте в браузер.** |

Оформление идёт в браузере, поэтому использует **publishable** ключ — требовать там secret означало бы светить его каждому посетителю, ровно то, ради чего publishable и существует. Publishable только *идентифицирует* магазин: он не может двигать деньги (это может только проверенный сервером PaymentIntent), а созданные им Manual-заказы не оплачены и подтверждаются мерчантом.

Всё чувствительное, что **не** должно идти из браузера — массовый импорт клиентов, серверное создание заказов — спрятано за **secret** ключом (`X-Secret-Key`), так что утёкший publishable до него не дотянется.

См. также: [Корзина и заказы](/docs/cart-orders) · [Импорт клиентов](/docs/customers).
