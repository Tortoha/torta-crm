# Booking

Services and appointments under `client.booking`. Two namespaces: `services` (browse) and `bookings` (reserve).

## Services

```js
const { data } = await client.booking.services.list(); // active services

const { data: service } = await client.booking.services.get(serviceId); // + eligible staff
```

### Available slots

```js
// getSlots(serviceId, date, staffId?)
const { data } = await client.booking.services.getSlots(serviceId, "2026-06-01");

// staffId is required for services with requires_staff = true
await client.booking.services.getSlots(serviceId, "2026-06-01", staffId);
```

`date` is `YYYY-MM-DD`.

## Bookings

```js
const r = await client.booking.bookings.create({
  service_id: 4,
  staff_id: 2,                       // optional
  starts_at: "2026-06-01T14:30",     // ISO local, "YYYY-MM-DDTHH:MM"
  customer_name: "Aizhan",           // optional
  customer_phone: "+77071234567",    // optional
  customer_email: "me@mail.com",     // optional
  notes: "First visit",              // optional
});

const { data } = await client.booking.bookings.list(); // current user's bookings

await client.booking.bookings.cancel(bookingId); // subject to the cancellation window
```
