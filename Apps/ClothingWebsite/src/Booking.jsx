import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Header from "./Header";
import { client } from "./api.js";
import "./Style/Booking.css";

// Format helpers reused inside the picker.
const fmtMoney    = (n) => `$${(+n || 0).toFixed(2)}`;
const fmtDateLong = (d) => d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
const isoDay      = (d) => d.toISOString().slice(0, 10);
const todayStart  = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

export default function Booking() {
  const navigate = useNavigate();

  const [services, setServices] = useState([]);
  const [loadingServices, setLoadingServices] = useState(true);

  const [chosenService, setChosenService] = useState(null);
  const [serviceDetail, setServiceDetail] = useState(null);
  const [chosenStaffId, setChosenStaffId] = useState(null);
  const [chosenDate,    setChosenDate]    = useState(todayStart());
  const [slots,         setSlots]         = useState([]);
  const [slotsDetailed, setSlotsDetailed] = useState([]);
  const [loadingSlots,  setLoadingSlots]  = useState(false);
  const [chosenSlot,    setChosenSlot]    = useState(null);

  // Customer form
  const [name,  setName]  = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // ── Fetch services ──────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { ok, data } = await client.booking.services.list();
      if (ok) setServices(data || []);
      setLoadingServices(false);
    })();
  }, []);

  // ── Fetch service detail (gives eligible staff) ────────────
  useEffect(() => {
    if (!chosenService) { setServiceDetail(null); return; }
    (async () => {
      const { ok, data } = await client.booking.services.get(chosenService.id);
      if (ok) {
        setServiceDetail(data);
        // Auto-select first staff if the service requires one.
        if (data.requires_staff && (data.staff || []).length > 0) {
          setChosenStaffId(data.staff[0].id);
        } else {
          setChosenStaffId(null);
        }
      }
    })();
  }, [chosenService?.id]);

  // ── Fetch slots when service / date / staff changes ────────
  useEffect(() => {
    if (!chosenService) { setSlots([]); return; }
    if (serviceDetail?.requires_staff && !chosenStaffId) { setSlots([]); return; }
    setLoadingSlots(true);
    setChosenSlot(null);
    (async () => {
      const { ok, data } = await client.booking.services.getSlots(
        chosenService.id, isoDay(chosenDate), chosenStaffId
      );
      if (ok) {
        setSlots(data?.slots || []);
        setSlotsDetailed(data?.slots_detailed || []);
      }
      setLoadingSlots(false);
    })();
  }, [chosenService?.id, chosenStaffId, chosenDate]);

  // ── 14-day strip (today + next 13 days) ────────────────────
  const dateStrip = useMemo(() => {
    const days = [];
    const start = todayStart();
    for (let i = 0; i < 14; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    return days;
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!name.trim() || !phone.trim()) {
      setError("Name and phone are required");
      return;
    }
    setSubmitting(true);
    try {
      const { ok, data } = await client.booking.bookings.create({
        service_id:     chosenService.id,
        staff_id:       chosenStaffId || null,
        starts_at:      chosenSlot,
        customer_name:  name.trim(),
        customer_phone: phone.trim(),
        customer_email: email.trim() || null,
        notes:          notes.trim() || null,
      });
      if (ok) {
        navigate("/booking/success", {
          state: { booking: data, service: chosenService, slot: chosenSlot },
        });
      } else {
        setError(data?.detail || "Failed to create booking");
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────
  return (
    <>
      <Header />
      <div className="bk-pkr-page">
        {!chosenService && (
          <ServicesGrid
            services={services} loading={loadingServices}
            onPick={setChosenService} />
        )}
        {chosenService && (
          <BookingFlow
            service={chosenService} detail={serviceDetail}
            staffId={chosenStaffId} setStaffId={setChosenStaffId}
            dateStrip={dateStrip}
            chosenDate={chosenDate} setChosenDate={setChosenDate}
            slots={slots} slotsDetailed={slotsDetailed} loadingSlots={loadingSlots}
            chosenSlot={chosenSlot} setChosenSlot={setChosenSlot}
            onBack={() => { setChosenService(null); setChosenSlot(null); }}
            name={name} setName={setName}
            phone={phone} setPhone={setPhone}
            email={email} setEmail={setEmail}
            notes={notes} setNotes={setNotes}
            error={error} submitting={submitting} onSubmit={submit} />
        )}
      </div>
    </>
  );
}

// ─── Services grid (step 1) ──────────────────────────────────

function ServicesGrid({ services, loading, onPick }) {
  if (loading) return <p className="bk-pkr-loading">Loading services…</p>;
  if (!services.length) {
    return <p className="bk-pkr-empty">No services available right now.</p>;
  }
  return (
    <>
      <h1 className="bk-pkr-title">Book a service</h1>
      <p className="bk-pkr-subtitle">Pick a service to see available times.</p>
      <div className="bk-pkr-grid">
        {services.map((s) => (
          <button key={s.id} type="button" className="bk-pkr-card" onClick={() => onPick(s)}>
            {s.image_url
              ? <img src={s.image_url} alt="" className="bk-pkr-card-img" />
              : <div className="bk-pkr-card-img bk-pkr-card-img--empty" />}
            <div className="bk-pkr-card-body">
              <div className="bk-pkr-card-name">{s.name}</div>
              {s.description && <div className="bk-pkr-card-desc">{s.description}</div>}
              <div className="bk-pkr-card-meta">
                <span>{s.duration_minutes} min</span>
                <span className="bk-pkr-card-pipe">·</span>
                <span className="bk-pkr-card-price">{fmtMoney(s.price)}</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

// ─── Booking flow (step 2): staff → date → slot → form ──────

function BookingFlow({
  service, detail, staffId, setStaffId,
  dateStrip, chosenDate, setChosenDate,
  slots, slotsDetailed = [], loadingSlots, chosenSlot, setChosenSlot,
  onBack,
  name, setName, phone, setPhone, email, setEmail, notes, setNotes,
  error, submitting, onSubmit,
}) {
  const eligibleStaff = detail?.staff || [];
  const requiresStaff = detail?.requires_staff;

  return (
    <>
      <button type="button" className="bk-pkr-back" onClick={onBack}>← Back to services</button>

      <div className="bk-pkr-summary">
        <div className="bk-pkr-summary-name">{service.name}</div>
        <div className="bk-pkr-summary-meta">
          {service.duration_minutes} min · {fmtMoney(service.price)}
        </div>
      </div>

      {/* Staff picker (only when service requires one) */}
      {requiresStaff && eligibleStaff.length > 0 && (
        <section className="bk-pkr-section">
          <h2 className="bk-pkr-h2">Choose a staff member</h2>
          <div className="bk-pkr-staff-row">
            {eligibleStaff.map((m) => (
              <button key={m.id} type="button"
                className={`bk-pkr-staff${staffId === m.id ? " bk-pkr-staff--active" : ""}`}
                onClick={() => setStaffId(m.id)}>
                {m.avatar_url
                  ? <img src={m.avatar_url} alt="" className="bk-pkr-staff-avatar" />
                  : <div className="bk-pkr-staff-avatar bk-pkr-staff-avatar--empty">{(m.name || "?")[0]}</div>}
                <span className="bk-pkr-staff-name">{m.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Date strip */}
      <section className="bk-pkr-section">
        <h2 className="bk-pkr-h2">Pick a date</h2>
        <div className="bk-pkr-date-strip">
          {dateStrip.map((d) => {
            const active = isoDay(d) === isoDay(chosenDate);
            return (
              <button key={isoDay(d)} type="button"
                className={`bk-pkr-day${active ? " bk-pkr-day--active" : ""}`}
                onClick={() => setChosenDate(d)}>
                <span className="bk-pkr-day-dow">{d.toLocaleDateString("en-US", { weekday: "short" })}</span>
                <span className="bk-pkr-day-num">{d.getDate()}</span>
              </button>
            );
          })}
        </div>
        <div className="bk-pkr-day-full">{fmtDateLong(chosenDate)}</div>
      </section>

      {/* Slot grid */}
      <section className="bk-pkr-section">
        <h2 className="bk-pkr-h2">Available times</h2>
        {loadingSlots ? (
          <p className="bk-pkr-loading">Loading slots…</p>
        ) : slots.length === 0 ? (
          <p className="bk-pkr-empty">No times available on this day. Try another date.</p>
        ) : (
          <div className="bk-pkr-slots">
            {slots.map((hhmm) => {
              const isoLocal = `${isoDay(chosenDate)}T${hhmm}`;
              const active = chosenSlot === isoLocal;
              const detail = slotsDetailed.find(s => s.time === hhmm);
              const isGroup = detail && detail.capacity > 1;
              return (
                <button key={hhmm} type="button"
                  className={`bk-pkr-slot${active ? " bk-pkr-slot--active" : ""}${isGroup ? " bk-pkr-slot--group" : ""}`}
                  onClick={() => setChosenSlot(isoLocal)}>
                  <span className="bk-pkr-slot-time">{hhmm}</span>
                  {isGroup && (
                    <span className="bk-pkr-slot-seats">
                      {detail.seats_left} / {detail.capacity} left
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Customer form (visible only when a slot is picked) */}
      {chosenSlot && (
        <form className="bk-pkr-section bk-pkr-form" onSubmit={onSubmit}>
          <h2 className="bk-pkr-h2">Your details</h2>
          <div className="bk-pkr-grid2">
            <label className="bk-pkr-field">
              <span>Name *</span>
              <input className="bk-pkr-input" value={name}
                onChange={(e) => setName(e.target.value)} required maxLength={100} />
            </label>
            <label className="bk-pkr-field">
              <span>Phone *</span>
              <input className="bk-pkr-input" value={phone} type="tel"
                onChange={(e) => setPhone(e.target.value)} required maxLength={32} />
            </label>
            <label className="bk-pkr-field">
              <span>Email</span>
              <input className="bk-pkr-input" value={email} type="email"
                onChange={(e) => setEmail(e.target.value)} maxLength={120} />
            </label>
            <label className="bk-pkr-field bk-pkr-field--wide">
              <span>Notes</span>
              <textarea className="bk-pkr-input bk-pkr-textarea" rows={2} value={notes}
                onChange={(e) => setNotes(e.target.value)} maxLength={500}
                placeholder="Allergies, requests…" />
            </label>
          </div>
          {error && <p className="bk-pkr-error">{error}</p>}
          <button type="submit" className="bk-pkr-submit" disabled={submitting}>
            {submitting ? "Booking…" : `Confirm booking · ${fmtMoney(service.price)}`}
          </button>
        </form>
      )}
    </>
  );
}
