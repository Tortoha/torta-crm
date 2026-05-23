# Приём клиентов (на сервере)

Если у вас **своя** авторизация и вы просто хотите, чтобы клиенты появлялись в CRM, можно загружать их со своего бэкенда — переносить вход к нам не нужно.

## Используйте секретный ключ

Это **server-to-server** вызов. Он использует **секретный ключ** проекта (`sk_…`), отправляемый заголовком `X-Secret-Key`. Никогда не размещайте секретный ключ в браузерном коде — держите его на сервере.

```js
import { createClient } from 'torta-js';

// secretKey передаётся третьим аргументом — только на сервере
const client = createClient(API_URL, API_PK, { secretKey: process.env.TORTA_SECRET_KEY });

await client.customers.save({
  email: "ann@example.com",
  name: "Ann",
  surname: "Lee",
  phone: "+10000000000",
  birthdate: "1995-03-01",   // YYYY-MM-DD
  address: "1 Market St",
  metadata: { tier: "gold" } // любые произвольные поля
});
```

Или вызовите эндпоинт напрямую:

```bash
curl -X POST "https://api.example.com/PUBLIC_KEY/customers" \
  -H "Content-Type: application/json" \
  -H "X-Secret-Key: sk_YOUR_SECRET_KEY" \
  -d '{"email":"ann@example.com","name":"Ann","surname":"Lee","metadata":{"tier":"gold"}}'
```

## Поведение

- **Upsert по email** (затем по телефону): повторная отправка того же клиента **обновляет** существующую запись, а не создаёт дубликат.
- Пустые поля не затирают существующие значения, а `metadata` **объединяется**, а не заменяется.
- Такие клиенты сохраняются как **внешние** (без пароля и входа здесь) — они появляются на странице «Клиенты» в CRM наравне с остальными.
- Требуется хотя бы одно из `email` или `phone`.

## Поля

| Поле | Примечания |
|------|------------|
| `email` / `phone` | идентификация — обязательно хотя бы одно |
| `name`, `surname` | имя / фамилия |
| `birthdate` | дата ISO, `YYYY-MM-DD` |
| `address` | адрес одной строкой |
| `metadata` | произвольный объект для ваших полей |
