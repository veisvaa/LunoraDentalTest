-- ============================================================
-- LUNORA SCHEMA
-- Run this in your Supabase SQL editor (top to bottom, once)
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ============================================================
-- CLINICS
-- One row per paying client clinic
-- ============================================================
CREATE TABLE clinics (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                        TEXT NOT NULL,
  whatsapp_number             TEXT UNIQUE NOT NULL, -- clinic's WA Business number e.g. +60123456789
  phone                       TEXT,
  address                     TEXT,
  timezone                    TEXT NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  appointment_duration_mins   INT NOT NULL DEFAULT 30,
  ai_resume_after_mins        INT NOT NULL DEFAULT 30, -- minutes of staff silence before AI resumes
  welcome_message             TEXT, -- custom first message the AI opens with
  is_active                   BOOLEAN NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- CLINIC WORKING HOURS
-- Per day of week. 0 = Sunday, 6 = Saturday
-- ============================================================
CREATE TABLE clinic_hours (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  day_of_week   INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time     TIME NOT NULL,
  close_time    TIME NOT NULL,
  is_open       BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (clinic_id, day_of_week)
);


-- ============================================================
-- CLINIC BLOCKED DATES
-- Public holidays, clinic closures, etc.
-- ============================================================
CREATE TABLE clinic_blocked_dates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  blocked_date  DATE NOT NULL,
  reason        TEXT,
  UNIQUE (clinic_id, blocked_date)
);


-- ============================================================
-- DOCTORS
-- One doctor for now. Schema supports multiple for future.
-- ============================================================
CREATE TABLE doctors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  specialization  TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- DOCTOR AVAILABILITY
-- Which days the doctor works (can differ from clinic hours)
-- ============================================================
CREATE TABLE doctor_availability (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id     UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  day_of_week   INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  is_available  BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (doctor_id, day_of_week)
);


-- ============================================================
-- PATIENTS
-- Auto-created when a new number contacts the clinic
-- ============================================================
CREATE TABLE patients (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  whatsapp_number   TEXT NOT NULL,
  name              TEXT,
  notes             TEXT, -- receptionist notes about this patient
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, whatsapp_number)
);


-- ============================================================
-- APPOINTMENTS
-- Core booking table
-- ============================================================
CREATE TABLE appointments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id       UUID REFERENCES doctors(id) ON DELETE SET NULL,
  appointment_at  TIMESTAMPTZ NOT NULL,  -- full datetime of booking
  duration_mins   INT NOT NULL DEFAULT 30,
  reason          TEXT,                  -- reason for visit from patient
  status          TEXT NOT NULL DEFAULT 'confirmed'
                  CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show')),
  booked_by       TEXT NOT NULL DEFAULT 'ai'
                  CHECK (booked_by IN ('ai', 'receptionist')),
  notes           TEXT,                  -- internal notes
  reminder_sent   BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent double-booking: no two confirmed appointments at same time for same doctor
CREATE UNIQUE INDEX no_double_booking
  ON appointments (doctor_id, appointment_at)
  WHERE status = 'confirmed';

-- Fast lookups by clinic + date range (dashboard calendar queries)
CREATE INDEX idx_appointments_clinic_time
  ON appointments (clinic_id, appointment_at);


-- ============================================================
-- CONVERSATIONS
-- Tracks AI/human state per patient chat
-- ============================================================
CREATE TABLE conversations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id             UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id            UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  whatsapp_number       TEXT NOT NULL,
  human_active          BOOLEAN NOT NULL DEFAULT false,  -- true = AI is paused
  human_last_replied_at TIMESTAMPTZ,                    -- when staff last messaged
  ai_context            JSONB,                           -- last N messages for Claude context window
  booking_state         JSONB,                           -- partial booking in progress
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, whatsapp_number)
);


-- ============================================================
-- STAFF NUMBERS
-- Numbers registered as clinic staff (receptionist, doctor)
-- Messages from these numbers trigger human takeover
-- ============================================================
CREATE TABLE staff_numbers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  whatsapp_number TEXT NOT NULL,
  name            TEXT,
  role            TEXT DEFAULT 'receptionist'
                  CHECK (role IN ('receptionist', 'doctor', 'admin')),
  UNIQUE (clinic_id, whatsapp_number)
);


-- ============================================================
-- AUDIT LOG
-- Every important action logged for traceability
-- ============================================================
CREATE TABLE audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID REFERENCES clinics(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,   -- e.g. 'appointment_created', 'human_takeover', 'reminder_sent'
  entity_type TEXT,            -- e.g. 'appointment', 'conversation'
  entity_id   UUID,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- AUTO-UPDATE updated_at on appointments and conversations
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- SEED: Example clinic (replace with real data)
-- ============================================================
INSERT INTO clinics (name, whatsapp_number, phone, address, appointment_duration_mins, ai_resume_after_mins, welcome_message)
VALUES (
  'Klinik Pergigian Harmoni',
  '+60123456789',
  '03-12345678',
  'No. 12, Jalan Harmoni, Shah Alam, Selangor',
  30,
  30,
  'Hello! Welcome to Klinik Pergigian Harmoni. I am the clinic assistant. How can I help you today? You can ask me to book an appointment, check your schedule, or ask any questions.'
);

-- Seed working hours (Mon-Fri 9am-6pm, Sat 9am-1pm, Sun closed)
INSERT INTO clinic_hours (clinic_id, day_of_week, open_time, close_time, is_open)
SELECT id, 0, '09:00', '18:00', false FROM clinics WHERE whatsapp_number = '+60123456789' -- Sun
UNION ALL
SELECT id, 1, '09:00', '18:00', true  FROM clinics WHERE whatsapp_number = '+60123456789' -- Mon
UNION ALL
SELECT id, 2, '09:00', '18:00', true  FROM clinics WHERE whatsapp_number = '+60123456789' -- Tue
UNION ALL
SELECT id, 3, '09:00', '18:00', true  FROM clinics WHERE whatsapp_number = '+60123456789' -- Wed
UNION ALL
SELECT id, 4, '09:00', '18:00', true  FROM clinics WHERE whatsapp_number = '+60123456789' -- Thu
UNION ALL
SELECT id, 5, '09:00', '18:00', true  FROM clinics WHERE whatsapp_number = '+60123456789' -- Fri
UNION ALL
SELECT id, 6, '09:00', '13:00', true  FROM clinics WHERE whatsapp_number = '+60123456789'; -- Sat

-- Seed one doctor
INSERT INTO doctors (clinic_id, name, specialization)
SELECT id, 'Dr. Amirah Binti Zulkifli', 'General Dentistry'
FROM clinics WHERE whatsapp_number = '+60123456789';

-- Doctor available Mon-Sat
INSERT INTO doctor_availability (doctor_id, day_of_week, is_available)
SELECT d.id, days.dow, (days.dow != 0)
FROM doctors d
CROSS JOIN (SELECT generate_series(0,6) AS dow) days
WHERE d.name = 'Dr. Amirah Binti Zulkifli';
