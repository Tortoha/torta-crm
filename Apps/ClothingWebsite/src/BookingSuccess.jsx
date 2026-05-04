import { Link, useLocation, Navigate } from "react-router-dom";
import Header from "./Header";
import "./Style/Booking.css";

export default function BookingSuccess() {
  const location = useLocation();
  const { booking, service, slot } = location.state || {};

  // Direct navigation without state → redirect to /booking.
  if (!booking || !service || !slot) return <Navigate to="/booking" replace />;

  // slot is "YYYY-MM-DDTHH:MM" in business TZ — parse manually to avoid browser-TZ shift.
  const [datePart, timePart] = String(slot).split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d, 12));
  const date = dateObj.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  const time = timePart || "";

  return (
    <>
      <Header />
      <div className="bk-success">
        <div className="bk-success-icon">✓</div>
        <h1 className="bk-success-title">Booking confirmed</h1>
        <p className="bk-success-text">
          We sent the details to your phone{booking?.customer_email ? " and email" : ""}.
        </p>

        <div className="bk-success-card">
          <div className="bk-success-card-row">
            <span className="bk-success-card-label">Service</span>
            <span className="bk-success-card-val">{service.name}</span>
          </div>
          <div className="bk-success-card-row">
            <span className="bk-success-card-label">When</span>
            <span className="bk-success-card-val">{date}, {time}</span>
          </div>
          <div className="bk-success-card-row">
            <span className="bk-success-card-label">Duration</span>
            <span className="bk-success-card-val">{service.duration_minutes} min</span>
          </div>
          <div className="bk-success-card-row">
            <span className="bk-success-card-label">Status</span>
            <span className="bk-success-card-val">{booking.status || "pending"}</span>
          </div>
        </div>

        <Link to="/booking" className="bk-success-btn">Book another</Link>
      </div>
    </>
  );
}
