# Pushing Customers (server-side)

If you run your **own** authentication and just want your customers to show up in the CRM, you can push them in from your backend — no need to move your login to us.

## Use the secret key

This is a **server-to-server** call. It uses the project's **secret key** (`sk_…`), sent as the `X-Secret-Key` header. Never put the secret key in browser code — keep it on your server.

```js
import { createClient } from 'torta-js';

// secretKey goes in the 3rd argument — server-side only
const client = createClient(API_URL, API_PK, { secretKey: process.env.TORTA_SECRET_KEY });

await client.customers.save({
  email: "ann@example.com",
  name: "Ann",
  surname: "Lee",
  phone: "+10000000000",
  birthdate: "1995-03-01",   // YYYY-MM-DD
  address: "1 Market St",
  metadata: { tier: "gold" } // any custom fields you want
});
```

Or call the endpoint directly:

```bash
curl -X POST "https://api.example.com/PUBLIC_KEY/customers" \
  -H "Content-Type: application/json" \
  -H "X-Secret-Key: sk_YOUR_SECRET_KEY" \
  -d '{"email":"ann@example.com","name":"Ann","surname":"Lee","metadata":{"tier":"gold"}}'
```

## Behavior

- **Upsert by email** (then phone): sending the same customer again **updates** the existing record instead of creating a duplicate.
- Empty fields don't overwrite existing values, and `metadata` is **merged**, not replaced.
- These customers are stored as **external** (no password, no login here) — they show up in the CRM Customers page like any other.
- At least one of `email` or `phone` is required.

## Fields

| Field | Notes |
|-------|-------|
| `email` / `phone` | identity — at least one required |
| `name`, `surname` | given / family name |
| `birthdate` | ISO date, `YYYY-MM-DD` |
| `address` | single-line address |
| `metadata` | free-form object for your own custom fields |
