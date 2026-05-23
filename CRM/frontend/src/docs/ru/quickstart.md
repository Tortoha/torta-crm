# Быстрый старт

`torta-js` — это официальный JavaScript SDK для API магазина. Все запросы вашего магазина идут через него — никаких сырых `fetch()` не нужно.

## Установка

```bash
npm install torta-js
```

Нет сборщика? Подключите прямо с CDN:

```js
import { createClient } from 'https://cdn.jsdelivr.net/npm/torta-js/+esm';
```

> Используете React, Next.js, Vue, SvelteKit, Astro…? Точная настройка под каждый фреймворк — в разделе [Фреймворки](/docs/frameworks).

## Создание клиента

Нужны два ключа, оба безопасно отдавать в браузер — скопируйте их в разделе **Copy Keys** на странице проекта:

- **Публичный ключ** — указывается в пути URL. Идентифицирует магазин.
- **Publishable-ключ** (`pk_…`) — отправляется заголовком в каждом запросе.

```js
import { createClient } from 'torta-js';

const API_URL = "https://api.example.com/PUBLIC_KEY"; // публичный ключ в пути
const API_PK  = "pk_PUBLISHABLE_KEY";                 // publishable-ключ

export const client = createClient(API_URL, API_PK);
```

Есть ещё третий, **секретный ключ** (`sk_…`) — только для server-to-server. См. [Приём клиентов](/docs/customers). Никогда не размещайте его в браузерном коде.

## Формат ответа

Каждый метод возвращает один и тот же объект, поэтому ошибки обрабатываются без `try/catch`:

```js
const r = await client.products.list();
if (!r.ok) showToast(r.error); // r.error — всегда готовая строка
else       render(r.data);
```

`{ ok, status, data, error }` — `ok` это флаг успеха, `status` HTTP-код, `data` полезная нагрузка (или `null`), `error` готовая к показу строка (или `null` при успехе). Подробнее в разделе [Концепции](/docs/concepts).

## Авторизация

Вход и регистрация по email — двухшаговый процесс: отправить код, затем подтвердить его.

```js
// 1. Отправить 6-значный код на email
await client.auth.sendCode({ name, email, password, type: "register" }); // или type: "login"

// 2. Подтвердить код — при успехе ставит cookie сессии
const res = await client.auth.verifyCode(email, code);

// Кто вошёл? (кешируется после первого вызова)
const user = await client.auth.getUser();
```

Полный набор авторизации — телефон, OAuth, сессии, сброс пароля — в разделе [Авторизация](/docs/auth).

## Товары и корзина

```js
const products = await client.products.list();        // можно { category: 'shoes' }
const one      = await client.products.get(productId);

// add(product_id, variation_id, configuration_id, quantity?, modifierItemIds?)
await client.cart.add(productId, variationId, configurationId, 1);
const cart = await client.cart.get();
```

## Конфигурация магазина

Считайте валюту, название и часовой пояс магазина один раз при старте, чтобы цены сразу отрисовались правильно:

```js
const { data } = await client.config.get(); // { currency, name, timezone, … }
```

---

Дальше: выберите свой [Фреймворк](/docs/frameworks), затем переходите к [Справочнику](/docs/auth).
