# Web Chat

An anonymous support widget under `client.chat`. No login required — the visitor's identity is a random UUID kept in `localStorage` (`torta_web_chat_id`). The CRM operator sees the conversation live; the widget polls `list()` for replies.

## Bootstrap

Checks whether the support widget is enabled for this store and gets (or generates) the anonymous id.

```js
const r = await client.chat.bootstrap();
if (!r.ok) return; // widget disabled for this store

client.chat.id; // the persisted web_chat_id, or "" if not set yet
```

## Send a message

`send` bootstraps automatically if needed, so you can call it directly.

```js
await client.chat.send("Hi, is this in stock?");
```

## Poll for replies

Fetch messages newer than the last id you've seen.

```js
const { data } = await client.chat.list(sinceId);
// { messages: [{ id, direction: 'in' | 'out', text, created_at }] }
```

`direction: 'out'` is an operator reply; `'in'` is the visitor's own message. Track the highest `id` you've received and pass it as `sinceId` next poll.

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

## Reset

Forget the local conversation (new identity next time).

```js
client.chat.reset();
```
