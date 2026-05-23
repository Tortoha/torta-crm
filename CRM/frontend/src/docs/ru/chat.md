# Веб-чат

Анонимный виджет поддержки под `client.chat`. Вход не требуется — личность посетителя это случайный UUID, хранящийся в `localStorage` (`torta_web_chat_id`). Оператор в CRM видит переписку в реальном времени; виджет опрашивает `list()`, чтобы получать ответы.

## Bootstrap

Проверяет, включён ли виджет поддержки для этого магазина, и получает (или генерирует) анонимный id.

```js
const r = await client.chat.bootstrap();
if (!r.ok) return; // виджет отключён для этого магазина

client.chat.id; // сохранённый web_chat_id или "" если ещё не задан
```

## Отправить сообщение

`send` сам вызывает bootstrap при необходимости, поэтому его можно вызывать сразу.

```js
await client.chat.send("Здравствуйте, это есть в наличии?");
```

## Опрос ответов

Получить сообщения новее последнего виденного id.

```js
const { data } = await client.chat.list(sinceId);
// { messages: [{ id, direction: 'in' | 'out', text, created_at }] }
```

`direction: 'out'` — ответ оператора; `'in'` — собственное сообщение посетителя. Запоминайте наибольший полученный `id` и передавайте его как `sinceId` при следующем опросе.

```js
let lastId = 0;
setInterval(async () => {
  const { data } = await client.chat.list(lastId);
  for (const m of data.messages) {
    lastId = Math.max(lastId, m.id);
    if (m.direction === 'out') showOperatorMessage(m.text);
  }
}, 4000);
```

## Сброс

Забыть локальную переписку (в следующий раз будет новая личность).

```js
client.chat.reset();
```
