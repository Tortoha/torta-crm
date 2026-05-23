# Бронирование

Услуги и записи под `client.booking`. Два неймспейса: `services` (просмотр) и `bookings` (запись).

## Услуги

```js
const { data } = await client.booking.services.list(); // активные услуги

const { data: service } = await client.booking.services.get(serviceId); // + подходящие сотрудники
```

### Свободные слоты

```js
// getSlots(serviceId, date, staffId?)
const { data } = await client.booking.services.getSlots(serviceId, "2026-06-01");

// staffId обязателен для услуг с requires_staff = true
await client.booking.services.getSlots(serviceId, "2026-06-01", staffId);
```

`date` в формате `YYYY-MM-DD`.

## Записи

```js
const r = await client.booking.bookings.create({
  service_id: 4,
  staff_id: 2,                       // необязательно
  starts_at: "2026-06-01T14:30",     // локальное ISO, "YYYY-MM-DDTHH:MM"
  customer_name: "Айжан",            // необязательно
  customer_phone: "+77071234567",    // необязательно
  customer_email: "me@mail.com",     // необязательно
  notes: "Первый визит",             // необязательно
});

const { data } = await client.booking.bookings.list(); // записи текущего пользователя

await client.booking.bookings.cancel(bookingId); // с учётом окна отмены
```
