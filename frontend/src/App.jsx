import { useState, useEffect, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";
const API_KEY = import.meta.env.VITE_API_KEY || "";
const CLINIC_ID = import.meta.env.VITE_CLINIC_ID || "";

function apiHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
    "X-Clinic-ID": CLINIC_ID,
  };
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...apiHeaders(), ...(options.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

function toDateStr(date) {
  return date.toISOString().split("T")[0];
}

function formatTime(isoStr) {
  return new Date(isoStr).toLocaleTimeString("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDate(isoStr) {
  return new Date(isoStr).toLocaleDateString("en-MY", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const STATUS_COLORS = {
  confirmed: "#0F6E56",
  cancelled: "#A32D2D",
  completed: "#185FA5",
  no_show: "#854F0B",
};

const STATUS_BG = {
  confirmed: "#E1F5EE",
  cancelled: "#FCEBEB",
  completed: "#E6F1FB",
  no_show: "#FAEEDA",
};

// ─── BOOKING MODAL ────────────────────────────────────────────
function BookingModal({ onClose, onSave, slots, slotsDate, loadSlots }) {
  const [form, setForm] = useState({
    patientName: "",
    patientPhone: "",
    date: toDateStr(new Date()),
    time: "",
    reason: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadSlots(form.date);
  }, [form.date]);

  async function handleSave() {
    if (!form.patientName || !form.patientPhone || !form.date || !form.time) {
      setError("Please fill in all required fields.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiFetch("/api/appointments", {
        method: "POST",
        body: JSON.stringify(form),
      });
      onSave();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const availableSlots = (slots || []).filter((s) => s.available);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "var(--color-background-primary)", borderRadius: 16, padding: "2rem", width: 480, maxWidth: "95vw", border: "0.5px solid var(--color-border-tertiary)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>New appointment</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--color-text-secondary)" }}>✕</button>
        </div>

        {error && (
          <div style={{ background: "#FCEBEB", color: "#A32D2D", padding: "0.75rem 1rem", borderRadius: 8, marginBottom: "1rem", fontSize: 14 }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 13, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Patient name *</label>
            <input value={form.patientName} onChange={e => setForm(f => ({ ...f, patientName: e.target.value }))} placeholder="Full name" style={{ width: "100%", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>WhatsApp number *</label>
            <input value={form.patientPhone} onChange={e => setForm(f => ({ ...f, patientPhone: e.target.value }))} placeholder="+601XXXXXXXX" style={{ width: "100%", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Date *</label>
            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value, time: "" })) } style={{ width: "100%", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Time *</label>
            {availableSlots.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0 }}>No available slots on this date.</p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {availableSlots.map(s => (
                  <button
                    key={s.datetime}
                    onClick={() => setForm(f => ({ ...f, time: s.datetime.split("T")[1].substring(0, 5) }))}
                    style={{
                      padding: "6px 14px", borderRadius: 8, fontSize: 13, cursor: "pointer",
                      background: form.time === s.datetime.split("T")[1].substring(0, 5) ? "#1D9E75" : "var(--color-background-secondary)",
                      color: form.time === s.datetime.split("T")[1].substring(0, 5) ? "#fff" : "var(--color-text-primary)",
                      border: "0.5px solid var(--color-border-tertiary)"
                    }}
                  >
                    {s.time}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Reason for visit</label>
            <input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="e.g. Tooth extraction, checkup" style={{ width: "100%", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Internal notes</label>
            <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="For clinic use only" style={{ width: "100%", boxSizing: "border-box" }} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: "1.5rem", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 20px" }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: "8px 20px", background: "#1D9E75", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 500 }}>
            {saving ? "Booking..." : "Confirm booking"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── RESCHEDULE MODAL ────────────────────────────────────────
function RescheduleModal({ appointment, onClose, onSave, slots, loadSlots }) {
  const [date, setDate] = useState(toDateStr(new Date()));
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { loadSlots(date); }, [date]);

  async function handleSave() {
    if (!date || !time) { setError("Select a date and time."); return; }
    setSaving(true);
    try {
      await apiFetch(`/api/appointments/${appointment.id}/reschedule`, {
        method: "PATCH",
        body: JSON.stringify({ date, time }),
      });
      onSave();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const availableSlots = (slots || []).filter(s => s.available);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "var(--color-background-primary)", borderRadius: 16, padding: "2rem", width: 420, border: "0.5px solid var(--color-border-tertiary)" }}>
        <h2 style={{ margin: "0 0 1.5rem", fontSize: 18, fontWeight: 500 }}>Reschedule appointment</h2>
        <p style={{ margin: "0 0 1rem", fontSize: 14, color: "var(--color-text-secondary)" }}>Patient: {appointment.patients?.name || appointment.patients?.whatsapp_number}</p>
        {error && <div style={{ background: "#FCEBEB", color: "#A32D2D", padding: "0.75rem", borderRadius: 8, marginBottom: "1rem", fontSize: 14 }}>{error}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 13, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>New date</label>
            <input type="date" value={date} onChange={e => { setDate(e.target.value); setTime(""); }} style={{ width: "100%", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>New time</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {availableSlots.map(s => (
                <button key={s.datetime} onClick={() => setTime(s.datetime.split("T")[1].substring(0, 5))}
                  style={{ padding: "6px 14px", borderRadius: 8, fontSize: 13, cursor: "pointer",
                    background: time === s.datetime.split("T")[1].substring(0, 5) ? "#1D9E75" : "var(--color-background-secondary)",
                    color: time === s.datetime.split("T")[1].substring(0, 5) ? "#fff" : "var(--color-text-primary)",
                    border: "0.5px solid var(--color-border-tertiary)" }}>
                  {s.time}
                </button>
              ))}
              {availableSlots.length === 0 && <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>No slots available.</p>}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: "1.5rem", justifyContent: "flex-end" }}>
          <button onClick={onClose}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: "8px 20px", background: "#1D9E75", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 500 }}>
            {saving ? "Saving..." : "Reschedule"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── APPOINTMENT CARD ─────────────────────────────────────────
function AppointmentCard({ appt, onCancel, onReschedule }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 12, padding: "1rem 1.25rem", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }} onClick={() => setExpanded(e => !e)}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ textAlign: "center", minWidth: 44 }}>
            <div style={{ fontSize: 18, fontWeight: 500 }}>{formatTime(appt.appointment_at)}</div>
          </div>
          <div>
            <div style={{ fontWeight: 500, fontSize: 15 }}>{appt.patients?.name || appt.patients?.whatsapp_number}</div>
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{appt.reason || "General visit"} · {appt.doctors?.name}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 20, background: STATUS_BG[appt.status], color: STATUS_COLORS[appt.status], fontWeight: 500, textTransform: "capitalize" }}>
            {appt.status}
          </span>
          <span style={{ fontSize: 16, color: "var(--color-text-secondary)" }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "0.5px solid var(--color-border-tertiary)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem 1.5rem", fontSize: 13, marginBottom: "1rem" }}>
            <div><span style={{ color: "var(--color-text-secondary)" }}>Phone: </span>{appt.patients?.whatsapp_number}</div>
            <div><span style={{ color: "var(--color-text-secondary)" }}>Booked by: </span>{appt.booked_by}</div>
            <div><span style={{ color: "var(--color-text-secondary)" }}>Duration: </span>{appt.duration_mins} min</div>
            <div><span style={{ color: "var(--color-text-secondary)" }}>Reminder: </span>{appt.reminder_sent ? "Sent" : "Pending"}</div>
            {appt.notes && <div style={{ gridColumn: "1/-1" }}><span style={{ color: "var(--color-text-secondary)" }}>Notes: </span>{appt.notes}</div>}
          </div>
          {appt.status === "confirmed" && (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => onReschedule(appt)} style={{ fontSize: 13, padding: "6px 14px" }}>Reschedule</button>
              <button onClick={() => onCancel(appt)} style={{ fontSize: 13, padding: "6px 14px", color: "#A32D2D", borderColor: "#F0959580" }}>Cancel appointment</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── MAIN DASHBOARD ───────────────────────────────────────────
export default function App() {
  const [selectedDate, setSelectedDate] = useState(toDateStr(new Date()));
  const [appointments, setAppointments] = useState([]);
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showBooking, setShowBooking] = useState(false);
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [toast, setToast] = useState(null);
  const [stats, setStats] = useState({ today: 0, confirmed: 0, cancelled: 0 });

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadAppointments = useCallback(async () => {
    setLoading(true);
    try {
      const from = selectedDate + "T00:00:00.000Z";
      const to = selectedDate + "T23:59:59.999Z";
      const data = await apiFetch(`/api/appointments?from=${from}&to=${to}`);
      setAppointments(data.appointments || []);
      const appts = data.appointments || [];
      setStats({
        today: appts.length,
        confirmed: appts.filter(a => a.status === "confirmed").length,
        cancelled: appts.filter(a => a.status === "cancelled").length,
      });
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  const loadSlots = useCallback(async (date) => {
    try {
      const data = await apiFetch(`/api/appointments/slots?date=${date}`);
      setSlots(data.slots || []);
    } catch {
      setSlots([]);
    }
  }, []);

  useEffect(() => { loadAppointments(); }, [loadAppointments]);

  async function handleCancel(appt) {
    if (!window.confirm(`Cancel appointment for ${appt.patients?.name || appt.patients?.whatsapp_number}?`)) return;
    try {
      await apiFetch(`/api/appointments/${appt.id}/cancel`, { method: "PATCH", body: JSON.stringify({ notifyPatient: true }) });
      showToast("Appointment cancelled. Patient notified.");
      loadAppointments();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  function getDatesInWeek() {
    const today = new Date();
    const days = [];
    for (let i = -3; i <= 10; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      days.push(d);
    }
    return days;
  }

  const weekDays = getDatesInWeek();

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-background-tertiary)", fontFamily: "var(--font-sans)" }}>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 20, right: 20, zIndex: 2000, padding: "12px 20px", borderRadius: 10, fontSize: 14, fontWeight: 500,
          background: toast.type === "error" ? "#FCEBEB" : "#E1F5EE",
          color: toast.type === "error" ? "#A32D2D" : "#0F6E56",
          border: `0.5px solid ${toast.type === "error" ? "#F0959580" : "#5DCAA580"}` }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ background: "var(--color-background-primary)", borderBottom: "0.5px solid var(--color-border-tertiary)", padding: "0 2rem" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "#1D9E75", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "#fff", fontSize: 16 }}>☽</span>
            </div>
            <span style={{ fontWeight: 500, fontSize: 16 }}>Lunora</span>
            <span style={{ color: "var(--color-text-secondary)", fontSize: 14 }}>/ Appointments</span>
          </div>
          <button onClick={() => setShowBooking(true)}
            style={{ background: "#1D9E75", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontWeight: 500, fontSize: 14, cursor: "pointer" }}>
            + New appointment
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "2rem" }}>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: "1.5rem" }}>
          {[
            { label: "Total today", value: stats.today },
            { label: "Confirmed", value: stats.confirmed },
            { label: "Cancelled", value: stats.cancelled },
          ].map(s => (
            <div key={s.label} style={{ background: "var(--color-background-secondary)", borderRadius: 10, padding: "1rem 1.25rem" }}>
              <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 26, fontWeight: 500 }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Date picker strip */}
        <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: "1.5rem", paddingBottom: 4 }}>
          {weekDays.map(d => {
            const str = toDateStr(d);
            const isToday = str === toDateStr(new Date());
            const isSelected = str === selectedDate;
            return (
              <button key={str} onClick={() => setSelectedDate(str)}
                style={{ minWidth: 54, padding: "8px 6px", borderRadius: 10, cursor: "pointer", flexShrink: 0, textAlign: "center",
                  background: isSelected ? "#1D9E75" : "var(--color-background-primary)",
                  color: isSelected ? "#fff" : isToday ? "#1D9E75" : "var(--color-text-primary)",
                  border: isSelected ? "none" : `0.5px solid ${isToday ? "#1D9E75" : "var(--color-border-tertiary)"}`,
                  fontWeight: isSelected || isToday ? 500 : 400 }}>
                <div style={{ fontSize: 11 }}>{d.toLocaleDateString("en-MY", { weekday: "short" })}</div>
                <div style={{ fontSize: 16 }}>{d.getDate()}</div>
              </button>
            );
          })}
        </div>

        {/* Appointment list */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>
              {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-MY", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </h2>
            <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{appointments.length} appointment{appointments.length !== 1 ? "s" : ""}</span>
          </div>

          {loading && <div style={{ textAlign: "center", padding: "3rem", color: "var(--color-text-secondary)" }}>Loading...</div>}

          {!loading && appointments.length === 0 && (
            <div style={{ textAlign: "center", padding: "3rem", color: "var(--color-text-secondary)", background: "var(--color-background-primary)", borderRadius: 12, border: "0.5px solid var(--color-border-tertiary)" }}>
              No appointments on this day.
            </div>
          )}

          {!loading && appointments.map(a => (
            <AppointmentCard key={a.id} appt={a} onCancel={handleCancel} onReschedule={setRescheduleTarget} />
          ))}
        </div>
      </div>

      {showBooking && (
        <BookingModal
          onClose={() => setShowBooking(false)}
          onSave={() => { setShowBooking(false); showToast("Appointment booked. Patient notified via WhatsApp."); loadAppointments(); }}
          slots={slots}
          slotsDate={selectedDate}
          loadSlots={loadSlots}
        />
      )}

      {rescheduleTarget && (
        <RescheduleModal
          appointment={rescheduleTarget}
          onClose={() => setRescheduleTarget(null)}
          onSave={() => { setRescheduleTarget(null); showToast("Appointment rescheduled. Patient notified."); loadAppointments(); }}
          slots={slots}
          loadSlots={loadSlots}
        />
      )}
    </div>
  );
}
