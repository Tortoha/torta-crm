# Платежи

Как работает оформление заказа через API — и как оно защищено.

У магазина может быть **несколько подключённых шлюзов одновременно**. Клиент выбирает один при оформлении и шлёт его в `payment_method`. Есть шесть **онлайн**-шлюзов (`stripe`, `apipay`, `halyk_epay`, `cloudpayments`, `robokassa`, `paypal`) — все они требуют проверенной сервером оплаты до создания заказа — и один **офлайн**-метод (`manual`), который записывается сразу.

Поток всегда из трёх шагов:

```
config.get()  →  payments.initPayment(payload)  →  завершить оплату  →  orders.place(payload + intent id)
```

## 1. Прочитать включённые методы магазина

```js
const cfg = await client.config.get();
// cfg.data → {
//   currency, project_name, timezone,
//   payment_methods: [{ method, label, instructions, online }],
//   payment_provider, online_payment, payment_test_mode
// }
```

Отрисуйте по одной опции чекаута на запись `payment_methods`.

- `online: true` → запускайте поток `initPayment` ниже.
- `online: false` → оформляйте заказ напрямую и покажите клиенту `instructions`.

> Онлайн-шлюз, который мерчант включил, но так и не подключил, **полностью отсутствует** в `payment_methods`. Если он в списке — его креды рабочие.

## 2. Начать оплату

Вызовите `initPayment` с **тем же payload**, что и `orders.place`, включая выбранный `payment_method`. Требуется сессия (залогиненный или гость), лимит — 15 вызовов/мин.

```js
const init = await client.payments.initPayment(payload);
// опционально: client.payments.initPayment(payload, { idempotencyKey })
```

### Ответ — всегда присутствует

| Поле | Примечание |
|---|---|
| `provider` | Шлюз, который реально будет использован — **не обязательно тот, что вы просили** (см. фоллбэки) |
| `intent_id` | Id, который позже передаётся как `payment_intent_id`. Пустой для `manual` |
| `amount`, `currency` | Сумма корзины, посчитанная сервером. Никогда не доверяйте клиентскому итогу |
| `needs_payment_intent` | `true` **только для Stripe** |
| `client_secret`, `redirect_url`, `publishable_key` | Заполняются под конкретный шлюз, иначе `""` |
| `is_test_mode` | Есть у каждого онлайн-шлюза |

### Ответ — блок под конкретный шлюз

| `provider` | Доп. поле | Что несёт |
|---|---|---|
| `stripe` | `client_secret`, `publishable_key`, `needs_payment_intent: true` | Stripe PaymentIntent |
| `apipay` | `kaspi_poll: true` | Опрашивайте `payments.status(intent_id)`, пока не оплатят |
| `halyk_epay` | `halyk_pay { auth, invoiceId, amount, currency, terminal, postLink, backLink, failureBackLink, description, language, paymentApiJs }` | Конфиг хостируемой страницы Halyk |
| `cloudpayments` | `cloudpayments_widget { public_terminal_id, external_id, account_id, amount, currency, description, payment_schema, widget_js }` | Конфиг попап-виджета TipTop Pay |
| `robokassa` | `redirect_url` + `robokassa_redirect { url, invoice_id }` | Подписанный URL хостируемой страницы |
| `paypal` | `redirect_url` + `paypal_redirect { url, order_id }` | PayPal approve-URL |
| `manual` | — | Ничего дополнительно |

> ⚠️ **Ветвитесь по `provider`, а не по `needs_payment_intent`.** Этот флаг `true` только у Stripe — остальные онлайн-шлюзы завершаются редиректом, виджетом или поллингом.

### Мягкие фоллбэки

`initPayment` никогда не блокирует продажу. Он возвращает `provider: "manual"` плюс строку `warning`, когда:

- запрошенный шлюз **не подключён** → `"Card payments not connected; falling back to manual"`
- шлюз **не умеет валюту магазина** → `"<gateway> settles only in KZT; falling back to manual."`

Обрабатывайте такой ответ как офлайн-заказ.

## 3. Завершить оплату

### Stripe — инлайн-карта, без редиректа

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

Данные карты идут **браузер → Stripe напрямую** — они не касаются нашего бэкенда.

### ApiPay (Kaspi) — телефон + async-пуш, затем поллинг

Клиент обязан передать `payload.phone` (номер Kaspi) — без него `initPayment` вернёт **400**. ApiPay отправляет списание в его Kaspi-приложение; вы опрашиваете статус, пока он не подтвердит.

```js
const intentId = init.data.intent_id;         // init.data.kaspi_poll === true

const timer = setInterval(async () => {
  const res = await client.payments.status(intentId);
  // res.data → { status, paid, account_name }

  if (res.data.paid) {
    clearInterval(timer);
    await client.orders.place({ ...payload, payment_intent_id: intentId });
  }
  if (["expired", "canceled", "error"].includes(res.data.status)) {
    clearInterval(timer);   // клиент отклонил или счёт протух
  }
}, 3000);                    // сдаваться примерно через 3 минуты
```

Статус всегда перезапрашивается у ApiPay на сервере — он никогда не берётся от клиента.

### TipTop Pay — попап-виджет, без редиректа

```js
const cfg = init.data.cloudpayments_widget;
await loadScript(cfg.widget_js);              // https://widget.tiptoppay.kz/bundles/widget.js

const widget = new window.tiptop.Widget();
widget.oncomplete = async (result) => {
  if (result.type === "payment" && result.status === "success") {
    await client.orders.place({
      ...payload,
      payment_intent_id: String(result.data.transactionId),
    });
  }
};
widget.start({
  publicTerminalId: cfg.public_terminal_id,
  amount:           cfg.amount,
  currency:         cfg.currency,
  paymentSchema:    cfg.payment_schema,
  description:      cfg.description,
  externalId:       cfg.external_id,
  receiptEmail:     cfg.account_id,
});
```

Обратите внимание: intent id здесь — это **`transactionId` от TipTop**, а не `init.data.intent_id`.

### ePay (Halyk) — редирект на хостируемую страницу

```js
const cfg = init.data.halyk_pay;
await loadScript(cfg.paymentApiJs);           // payment-api.js от Halyk

stashPending({ payload, intentId: init.data.intent_id });   // см. ниже

window.halyk.pay({
  invoiceId:  cfg.invoiceId,
  backLink:   cfg.backLink,                   // …/checkout/return?status=success
  failureBackLink: cfg.failureBackLink,       // …/checkout/return?status=failure
  postLink:   cfg.postLink,
  failurePostLink: cfg.postLink,
  language:   cfg.language,
  description: cfg.description,
  accountId:  cfg.invoiceId,
  terminal:   cfg.terminal,
  amount:     cfg.amount,
  currency:   cfg.currency,
  auth:       cfg.auth,
});
```

### Robokassa и PayPal — обычный редирект

```js
stashPending({ payload, intentId: init.data.intent_id });
window.location.href = init.data.redirect_url;
```

### Manual

```js
await client.orders.place(payload);   // payload.payment_method = "manual"
```

### Возврат после редиректа

Halyk, Robokassa и PayPal возвращают клиента на `…/checkout/return?status=success|failure`. Браузер уходил из вашего приложения, поэтому **сохраните payload и intent id до редиректа** (например, в `sessionStorage`) и завершите заказ по возврату:

```js
// перед редиректом
const stashPending = (v) => sessionStorage.setItem("checkout_pending", JSON.stringify(v));

// на /checkout/return
const { payload, intentId } = JSON.parse(sessionStorage.getItem("checkout_pending"));
if (new URLSearchParams(location.search).get("status") === "success") {
  await client.orders.place({ ...payload, payment_intent_id: intentId });
}
```

## 4. Оформить заказ

```js
await client.orders.place({ ...payload, payment_intent_id: intentId });
// → { success: true, order_id }
```

`payment_method` принимает алиасы: `card` → `stripe`, `cash` / `cod` → `manual`.

Итоговый статус оплаты:

| Метод | Статус |
|---|---|
| Любой онлайн-шлюз, проверен | `paid` — сразу идёт в выручку |
| `manual` | `manual` — оплачено офлайн |
| Онлайн-метод, чей шлюз не подключён | Тихо понижается до `manual` (записан, но **не** проверен) |
| `other` *(легаси)* | `pending` — мерчант подтверждает через «Mark as paid» |

> Поскольку сломанный шлюз понижается до `manual`, никогда не считайте, что `payment_method: "stripe"` в вашем запросе означает, что карта реально списана. Проверяйте `provider` в ответе `initPayment`.

## 5. Опросить async-платёж

```js
const res = await client.payments.status(intentId);
// res.data → { status, paid, account_name }
```

Имеет смысл только для **ApiPay (Kaspi)**. Любой другой провайдер вернёт `{ status: "manual", paid: false }`.

## 6. Правила валют

| Шлюз | Проводит в |
|---|---|
| `apipay`, `halyk_epay`, `robokassa` | `KZT` |
| `cloudpayments` | `KZT`, `RUB` |
| `stripe` | много |
| `paypal` | много — **никогда `KZT`** (PayPal сам отклонит) |

Проверяется дважды. `initPayment` понижает до `manual` с полем `warning`. `orders.place` — авторитетное решение по деньгам, поскольку клиент может дёрнуть его напрямую — отклоняет с **400**:

> `apipay settles only in KZT; store currency is USD — cannot verify this payment safely. Use a matching-currency gateway.`

## 7. Как это защищено

Для любого онлайн-метода `POST /orders` перезапрашивает платёж **server-to-server** и отказывается создавать оплаченный заказ, пока сам провайдер не отрапортует терминальный успех:

| Шлюз | Требуемый статус |
|---|---|
| `stripe` | `succeeded` |
| `apipay` | `paid` |
| `halyk_epay` | `paid` |
| `cloudpayments` | `paid` |
| `robokassa` | `paid` |
| `paypal` | `COMPLETED` — статуса `APPROVED` **недостаточно** |

Сверх того:

- **Проверка суммы.** Итог корзины пересчитывается на сервере по живой корзине и сверяется с тем, что провайдер реально списал (допуск 0.02; Kaspi сверяется в целых тенге). Расхождение → **409**.
- **Защита от повтора.** Один intent → один заказ. Переиспользование `payment_intent_id` → **409**.
- **Валидация метода.** Выбранный `payment_method` проверяется против *включённых* методов магазина — нельзя обойти обязательную карту, отправив `manual`.
- **Креды не покидают сервер.** В браузер уходят только Stripe `publishable_key` (безопасен по замыслу) и одноразовый `auth`-токен Halyk, ограниченный конкретным счётом.

Итого: **нельзя** создать заказ `paid` без реальной, подтверждённой провайдером оплаты на нужную сумму.

## 8. Ошибки, которые вы реально встретите

| Статус | Где | Что значит |
|---|---|---|
| `401` | `initPayment` | Нет сессии — `"Login required to place an order"` |
| `429` | оба | Рейт-лимит (15/мин init, 12/мин place) |
| `400` | `initPayment` | `"Kaspi phone number is required"` |
| `400` | `initPayment` | Шлюз отклонил создание платежа (`"PayPal payment error: …"`) |
| `400` | оба | `"Selected payment method is not available."` |
| `400` | `orders.place` | Несовпадение валюты и шлюза |
| `402` | `orders.place` | `"Payment intent required for card payment. Call POST /orders/init-payment first."` |
| `402` | `orders.place` | `"Payment not completed (provider status: …)"` |
| `409` | `orders.place` | `"Intent … already used for order #…"` |
| `409` | `orders.place` | `"Cart total changed since payment…"` — перезапустите `initPayment` |

## 9. Один нюанс, который стоит заложить в архитектуру

У **Kaspi, Halyk, TipTop Pay и Robokassa** деньги списываются **на стороне шлюза** ещё до того, как отработает `orders.place`. Если клиент закроет вкладку в этот момент — платёж есть, а заказа нет: вебхук шлюза умеет только *обновить* существующий заказ, но не создать его.

Поэтому: сохраняйте payload и intent id перед уходом со страницы и завершайте `orders.place` по возврату (или при следующем визите). Эталонная витрина делает именно так, через `sessionStorage`.

**PayPal — исключение:** списание происходит на нашем сервере *во время* `orders.place`, поэтому подтверждённый, но брошенный чекаут не спишет ничего.

## Три ключа

В Torta трёхключевая модель. Используйте нужный ключ для нужного контекста:

| Ключ | Где | Заголовок | Для чего |
|---|---|---|---|
| **Public key** | В пути URL | — | Идентифицирует магазин. Можно раскрывать. |
| **Publishable key** | Браузер | `X-Publishable-Key` | Витрина (корзина, оформление, заказы). Проверяется на каждом запросе. |
| **Secret key** | **Только сервер** | `X-Secret-Key` | Доверенные сервер-сервер записи (напр. [приём клиентов](/docs/customers)). **Никогда не отдавайте в браузер.** |

Оформление идёт в браузере, поэтому использует **publishable** ключ — требовать там secret означало бы светить его каждому посетителю, ровно то, ради чего publishable и существует. Publishable только *идентифицирует* магазин: он не может двигать деньги (это может только проверенный сервером платёж), а созданные им офлайн-заказы не оплачены и подтверждаются мерчантом.

См. также: [Корзина и заказы](/docs/cart-orders) · [Настройка платежей](/docs/payments) · [Приём клиентов](/docs/customers).
