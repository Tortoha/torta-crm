# Authentication

**Project → Authentication** controls how shoppers sign in to your storefront, and the URLs your store uses. Two tabs: **Auth Providers** and **URL Configuration.**

## Auth Providers

A list of every sign-in method. Each row has an Enabled/Disabled badge; click it to open a configuration modal.

### Email & Phone (one-time codes)

- **Email** — passwordless sign-in via a code sent by email. In the panel you set your sending **domain**, from-name and from-email, with a live preview. On save, Torta generates DNS records (DKIM, SPF, DMARC) shown in a table with copy buttons and a **Check DNS** button. The badge reads **Verified** only when all three records pass — without DMARC especially, Gmail/Outlook may spam-folder your mail. ("DNS can take a while to propagate.")
- **Phone** — sign-in via SMS code. Pick an **SMS provider** from a long, region-grouped list (Twilio, Vonage, AWS SNS, Plivo; SMSC.ru / SMS.ru; Mobizon.kz; Eskiz; MSG91; WhatsApp Business; Telegram Gateway; and more) and fill in its credentials. You can also set OTP expiry, code length, the SMS message template, and **test phone numbers** to try it without sending real texts.

### Google & other OAuth

- **Google** gets its own panel: enable it, paste the **Client ID** and **Client Secret**, and copy the **Redirect URI** into your Google Cloud Console.
- A further **~17 OAuth providers** share a common panel — GitHub, Discord, Facebook, GitLab, Bitbucket, LinkedIn, Twitch, Spotify, Slack, Notion, Figma, Zoom, Microsoft Azure, **Apple**, X (Twitter), Kakao, KeyCloak. Each is configured the same way: enable, paste Client ID / Secret, and add the shown Redirect URI in that provider's developer console (a link is provided per provider).

What you enable here is exactly what the storefront reads via `client.auth.methods()`.

## URL Configuration

- **Site URL** — your storefront's base URL, used to build the links in emails and OAuth redirects (the backend never hardcodes them).
- **Redirect URLs** — an allowlist of permitted OAuth callback URLs (wildcards like `https://*.yourdomain.com` are supported). It's a security control — only listed URLs can complete a login.

## From the storefront

Sign-in itself runs through the SDK — see the [Authentication reference](/docs/auth) for `sendCode`, `verifyCode`, `oauthLogin`, phone OTP, sessions and password reset.

> In a multi-branch organization with shared customers, these provider settings are shared across branches.
