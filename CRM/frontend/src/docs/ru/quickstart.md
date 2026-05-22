# Быстрый старт torta-js

`torta-js` — официальный JavaScript-SDK для API витрины. Все запросы витрины идут через него — никаких «голых» `fetch()`.

## Установка

```bash
npm install torta-js
```

Или с CDN (чистый HTML, без сборщика):

```js
import { createClient } from 'https://cdn.jsdelivr.net/npm/torta-js/+esm';
```

## Создание клиента

Используйте **публичный ключ** (в URL) и **публикуемый ключ** (заголовок). Оба безопасно отдавать в браузер. Найти их можно в *Copy Keys* на обзоре проекта.

```js
import { createClient } from 'torta-js';

const API_URL = "https://api.example.com/PUBLIC_KEY"; // публичный ключ в пути
const API_PK  = "pk_PUBLISHABLE_KEY";                 // публикуемый ключ

export const client = createClient(API_URL, API_PK);
```

## Аутентификация

Регистрация и вход — в два шага: отправить код, затем подтвердить.

```js
// 1. Отправить 6-значный код на email
await client.auth.sendCode({ name, email, password, type: "register" }); // или type: "login"

// 2. Подтвердить код — при успехе ставит cookie сессии
const res = await client.auth.verifyCode(email, code);

// Кто вошёл?
const { data } = await client.auth.getUser();
```

При регистрации можно собрать дополнительные поля — все необязательные:

```js
await client.auth.sendCode({
  name, email, password,
  surname, address, birthdate,   // доп. поля
  type: "register",
});
```

## Товары и корзина

```js
const products = await client.products.list();
const one      = await client.products.get(id);

await client.cart.add({ /* ... */ });
const cart = await client.cart.get();
```

Каждый метод возвращает `{ ok, status, data, error }` — ошибки можно обрабатывать без try/catch:

```js
const r = await client.products.list();
if (!r.ok) showToast(r.error);
else render(r.data);
```

Дальше: [Приём клиентов](/docs/customers) — для магазинов со своей аутентификацией.
