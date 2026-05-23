# Authentication

Everything under `client.auth`. Sessions are cookie-based and refresh automatically — see [Concepts](/docs/concepts).

## Current user

```js
// Cached after the first call. Pass true to force a refetch (e.g. after login).
const user = await client.auth.getUser();
const user = await client.auth.getUser(true);

client.auth.user;            // synchronous cached value (undefined = not fetched, null = logged out)
client.auth.invalidateUser(); // drop the cache
```

`getUser()` returns the user object or `null` when logged out.

## Email OTP (login & register)

A two-step flow: send a 6-digit code, then verify it. `verifyCode` sets the session cookie on success.

```js
// type: "register" | "login"
await client.auth.sendCode({ name, email, password, type: "register" });

const r = await client.auth.verifyCode(email, code);
if (r.ok) { /* logged in */ }

await client.auth.resendCode(email); // didn't arrive?
```

At registration you may collect extra profile fields — all optional:

```js
await client.auth.sendCode({
  name, email, password,
  surname, address, birthdate, // optional
  type: "register",
});
```

## Logout

```js
await client.auth.logout();    // this device
await client.auth.logoutAll(); // every device for this user
```

## Password reset

```js
await client.auth.forgotPassword(email);              // emails a reset link

const { ok, data } = await client.auth.validateResetToken(token); // data: { email }
await client.auth.resetPassword(token, password, repeatPassword);
```

## OAuth

Full-page redirects to the provider, then back to the store.

```js
client.auth.googleLogin();         // Google shortcut
client.auth.oauthLogin('github');  // any supported provider
```

Supported providers: `github`, `discord`, `facebook`, `gitlab`, `bitbucket`, `linkedin`, `twitch`, `spotify`, `slack`, `notion`, `figma`, `zoom`, `azure`, `apple`, `x`, `kakao`, `keycloak`.

> A provider only works if the merchant has configured it in the CRM. Check `methods()` (below) or the provider config before showing a button.

## Phone OTP (SMS)

```js
await client.auth.sendPhoneCode("+77071234567", name); // name optional, used for new users
const r = await client.auth.verifyPhoneCode("+77071234567", code); // sets the cookie
```

Phone numbers must be E.164 format. SMS login is only available when the merchant enabled it.

## Sessions

```js
const { data } = await client.auth.listSessions();
// [{ id, is_current, created_at, last_used_at, expires_at, user_agent, ip, label }]

await client.auth.revokeSession(sessionId); // log one device out
```

## Manual refresh

```js
await client.auth.refresh();
```

You rarely need this — the SDK refreshes automatically on 401.

## Available methods

Which contact methods the merchant accepts for login/checkout. Email is always `true`; phone toggles with SMS-OTP enablement.

```js
const { data } = await client.auth.methods(); // { email: true, phone: false }
```
