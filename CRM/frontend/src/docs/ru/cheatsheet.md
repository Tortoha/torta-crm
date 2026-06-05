# Шпаргалка по API

Одна страница со **всеми подключениями магазина** — для чего каждое и как работает — чтобы не прыгать между страницами справочника. Всё висит на одном объекте `client` из [`torta-js`](/docs/quickstart), и каждый метод возвращает одинаковый `{ ok, status, data, error }`.

## Зачем это нужно

Любой запрос вашего магазина идёт через один этот клиент SDK. Он держит ключи, обновление сессии, CSRF и обработку ошибок **в одном месте** — поэтому компоненты просто вызывают `client.что-то()` и никогда не трогают сырой `fetch()`. Создайте клиент один раз в общем модуле и импортируйте везде:

```js
import { createClient } from 'torta-js';
export const client = createClient("https://api.tortacrm.com/PUBLIC_KEY", "pk_PUBLISHABLE_KEY");
```

## Как работает любой вызов

Четыре правила покрывают весь API — выучите один раз (подробно в [Концепциях](/docs/concepts)):

- **Одинаковый формат ответа.** Каждый метод возвращает `{ ok, status, data, error }` и не бросает исключение на HTTP-ошибку. Проверяете `ok`, показываете `error` (всегда обычная строка), используете `data`.
- **Два браузерных ключа.** **Публичный ключ** стоит в пути URL (определяет магазин); **публикуемый ключ** (`pk_…`) шлётся заголовком в каждом запросе. Оба безопасны для браузера.
- **Сессии обновляются сами.** Вход ставит httpOnly-куку. На `401` SDK молча обновляет токен один раз и повторяет запрос — токенами вы не управляете.
- **Трекинг — fire-and-forget.** `client.track.*` ничего не возвращает для await и не бросает ошибок, поэтому аналитика не может сломать оформление заказа.

> Один метод работает **только на сервере** — `client.customers.save`, ему нужен **секретный ключ** (`sk_…`). Никогда не отправляйте этот ключ в браузер. См. [Загрузка клиентов](/docs/customers).

## Все подключения с одного взгляда

### Загрузка магазина — только чтение, без входа
| Вызов | Что делает |
|---|---|
| `client.config.get()` | Валюта, название, часовой пояс магазина, включённые способы оплаты. Вызвать один раз при старте. |
| `client.categories.list()` | Все категории (`id, name, slug, products_count`). |
| `client.products.list(opts?)` | Товары; фильтр по `{ category }` или `{ uncategorized }`. |
| `client.products.get(hash)` | Один товар с вариациями, размерами, фото, группами модификаторов. |

→ Полный гайд: [Каталог](/docs/catalog)

### Аутентификация и сессии — `client.auth`
| Вызов | Что делает |
|---|---|
| `getUser(force?)` · `user` · `invalidateUser()` | Текущий пользователь (кэш); синхронное значение; сброс кэша. |
| `sendCode({ name, email, password, type })` | Email-OTP шаг 1 — `type` это `"register"` или `"login"`. |
| `verifyCode(email, code)` | Шаг 2 — ставит куку сессии. |
| `resendCode(email)` | Переотправить код на email. |
| `sendPhoneCode(phone, name?)` · `verifyPhoneCode(phone, code)` | SMS-OTP (если включил мерчант). |
| `googleLogin()` · `oauthLogin(provider)` | Вход через OAuth с полным редиректом. |
| `forgotPassword(email)` | Отправить ссылку для сброса пароля. |
| `validateResetToken(token)` · `resetPassword(token, pw, repeat)` | Завершить сброс пароля. |
| `logout()` · `logoutAll()` | Выйти на этом устройстве / на всех. |
| `listSessions()` · `revokeSession(id)` | Список устройств / отозвать одно. |
| `methods()` | Какие способы связи принимает магазин (`{ email, phone }`). |

→ Полный гайд: [Аутентификация](/docs/auth)

### Корзина и оформление
| Вызов | Что делает |
|---|---|
| `client.cart.get()` | Текущая корзина с ценами по строкам, модификаторами и суммой. |
| `client.cart.add(productId, variationId, configId, qty?, modifierIds?)` | Добавить позицию. |
| `client.cart.update(itemId, qty, modifierIds?)` · `client.cart.remove(itemId)` | Изменить количество / удалить. |
| `client.promos.apply(code)` | Проверить и применить промокод. |
| `client.addresses.list/add/setDefault/remove` | Сохранённые адреса клиента. |
| `client.payments.initPayment(payload)` | Начать оплату; подскажет, нужна ли оплата картой. |
| `client.orders.place(payload)` | Создать заказ (после подтверждения карты или сразу для офлайн-методов). |
| `client.orders.list()` | История заказов. |
| `client.orders.cancel(id)` | Отменить, пока `new` / `confirmed` / `shipped`. |
| `client.orders.requestReturn/listReturns/cancelReturn` | Возвраты (14 дней). |
| `client.shipping.pickupLocations()` · `client.shipping.deliveryEta()` | Точки самовывоза / оценка доставки. |

→ Полные гайды: [Корзина и заказы](/docs/cart-orders) · [Оплата](/docs/payments-api)

### Вовлечение
| Вызов | Что делает |
|---|---|
| `client.favorites.list()` · `add(productId)` · `remove(productHash)` | Избранное (добавить по id, удалить по hash). |
| `client.reviews.add(productId, rating, text)` · `delete(id)` | Написать / удалить свой отзыв. |
| `client.reviews.attachPhoto(id, url)` · `deletePhoto(id)` | До 5 фото на отзыв. |
| `client.reviews.vote(id, helpful)` · `unvote(id)` | Голоса «полезно» на чужих отзывах. |
| `client.restock.subscribe(productId, skuId?, email?)` | «Сообщить, когда снова в наличии». |

→ Полный гайд: [Отзывы и избранное](/docs/reviews-favorites)

### Бронирование — `client.booking`
| Вызов | Что делает |
|---|---|
| `services.list()` · `services.get(id)` | Список услуг для записи (+ подходящие сотрудники). |
| `services.getSlots(id, date, staffId?)` | Свободные слоты на дату (`YYYY-MM-DD`). |
| `bookings.create(payload)` | Забронировать слот. |
| `bookings.list()` · `bookings.cancel(id)` | Записи пользователя / отменить. |

→ Полный гайд: [Бронирование](/docs/booking)

### Чат поддержки — `client.chat`
| Вызов | Что делает |
|---|---|
| `bootstrap()` | Включён ли виджет? Получить или создать анонимный id. |
| `send(text)` | Отправить сообщение посетителя (сам делает bootstrap). |
| `list(sinceId)` | Опрос новых сообщений (ответы оператора — `direction: 'out'`). |
| `reset()` · `id` | Забыть локальную переписку / текущий анонимный id. |

→ Полный гайд: [Веб-чат](/docs/chat)

### Аналитика — `client.track` (fire-and-forget)
| Вызов | Что делает |
|---|---|
| `visit()` | Один раз на загрузку страницы. |
| `productView(productId)` | На странице товара. |
| `search(query, resultsCount)` | Поисковые запросы (показывает пустые выдачи). |
| `cartEvent(action, data)` | `add` / `remove` / `update_qty` / `apply_promo` / `remove_promo`. |
| `checkout(step, data?)` | `started` / `address_filled` / `promo_tried` / `submitted` / `failed`. |
| `goal(name, value?, meta?)` | Свои события-цели (должны совпадать с целью в CRM). |

→ Полный гайд: [Трекинг](/docs/tracking)

### Сервер-к-серверу — `client.customers` (секретный ключ)
| Вызов | Что делает |
|---|---|
| `client.customers.save(customer)` | Upsert клиента с вашего бэкенда. **Только сервер — использует `sk_…`.** |

→ Полный гайд: [Загрузка клиентов](/docs/customers)

---

Впервые здесь? Начните с [Быстрого старта](/docs/quickstart) и [Концепций](/docs/concepts) — а эту страницу держите открытой как карту.
