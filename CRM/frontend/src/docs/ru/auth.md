# Авторизация

Всё, что под `client.auth`. Сессии работают на cookie и обновляются автоматически — см. [Концепции](/docs/concepts).

## Текущий пользователь

```js
// Кешируется после первого вызова. Передайте true для принудительного перезапроса (например, после входа).
const user = await client.auth.getUser();
const user = await client.auth.getUser(true);

client.auth.user;            // синхронное кешированное значение (undefined = не запрашивали, null = не вошёл)
client.auth.invalidateUser(); // сбросить кеш
```

`getUser()` возвращает объект пользователя или `null`, если он не вошёл.

## Email OTP (вход и регистрация)

Двухшаговый процесс: отправить 6-значный код, затем подтвердить его. `verifyCode` при успехе ставит cookie сессии.

```js
// type: "register" | "login"
await client.auth.sendCode({ name, email, password, type: "register" });

const r = await client.auth.verifyCode(email, code);
if (r.ok) { /* вошли */ }

await client.auth.resendCode(email); // не пришёл код?
```

При регистрации можно собрать дополнительные поля профиля — все необязательные:

```js
await client.auth.sendCode({
  name, email, password,
  surname, address, birthdate, // необязательные
  type: "register",
});
```

## Выход

```js
await client.auth.logout();    // это устройство
await client.auth.logoutAll(); // все устройства пользователя
```

## Сброс пароля

```js
await client.auth.forgotPassword(email);              // отправляет ссылку на сброс

const { ok, data } = await client.auth.validateResetToken(token); // data: { email }
await client.auth.resetPassword(token, password, repeatPassword);
```

## OAuth

Полностраничные редиректы на провайдера и обратно в магазин.

```js
client.auth.googleLogin();         // сокращение для Google
client.auth.oauthLogin('github');  // любой поддерживаемый провайдер
```

Поддерживаемые провайдеры: `github`, `discord`, `facebook`, `gitlab`, `bitbucket`, `linkedin`, `twitch`, `spotify`, `slack`, `notion`, `figma`, `zoom`, `azure`, `apple`, `x`, `kakao`, `keycloak`.

> Провайдер работает только если продавец настроил его в CRM. Проверяйте `methods()` (ниже) или конфигурацию провайдера, прежде чем показывать кнопку.

## Телефон OTP (SMS)

```js
await client.auth.sendPhoneCode("+77071234567", name); // name необязателен, используется для новых пользователей
const r = await client.auth.verifyPhoneCode("+77071234567", code); // ставит cookie
```

Номера должны быть в формате E.164. Вход по SMS доступен, только если продавец его включил.

## Сессии

```js
const { data } = await client.auth.listSessions();
// [{ id, is_current, created_at, last_used_at, expires_at, user_agent, ip, label }]

await client.auth.revokeSession(sessionId); // выйти на одном устройстве
```

## Ручной рефреш

```js
await client.auth.refresh();
```

Обычно не нужен — SDK обновляет сессию автоматически при 401.

## Доступные методы

Какие способы связи продавец принимает для входа/оформления. Email всегда `true`; телефон зависит от включённого SMS-OTP.

```js
const { data } = await client.auth.methods(); // { email: true, phone: false }
```
