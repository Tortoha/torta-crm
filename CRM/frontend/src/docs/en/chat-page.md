# Chat

**Project → Chat** is the inbox where you talk to customers, plus the place you connect messaging channels.

## Channels

The web-chat widget on your storefront is built in — turning it on here is enough to expose it (no external credentials). Beyond that you can connect external channels such as Telegram, Discord, WhatsApp, Instagram, Facebook and more, each through its own connect dialog.

> Some channels (e.g. Telegram, Discord) work in local development; webhook-based ones (WhatsApp, Instagram…) need a public HTTPS URL.

## What you can do

- **Browse** available channels and connect new ones.
- **Reply** to conversations in real time; the storefront widget polls for your answers.
- **Logs** — search and review past conversations.

## From the storefront

The web-chat widget is driven by the SDK's `client.chat` — see [Web Chat](/docs/chat) for the anonymous-visitor model (`bootstrap`, `send`, `list`).
