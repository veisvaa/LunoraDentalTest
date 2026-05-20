const { supabase } = require('../config/supabase');
const logger = require('../config/logger');
const { DateTime } = require('luxon');

// ============================================================
// SLOT AVAILABILITY
// Returns array of available time slots for a given date
// ============================================================
async function getAvailableSlots(clinicId, dateStr) {
  // dateStr format: 'YYYY-MM-DD'

  const { data: clinic, error: clinicErr } = await supabase
    .from('clinics')
    .select('appointment_duration_mins, timezone')
    .eq('id', clinicId)
    .single();

  if (clinicErr || !clinic) throw new Error('Clinic not found');

  const tz = clinic.timezone;
  const date = DateTime.fromISO(dateStr, { zone: tz });
  const dayOfWeek = date.weekday % 7; // luxon: 1=Mon, 7=Sun → convert to 0=Sun

  // Check if clinic is blocked on this date
  const { data: blocked } = await supabase
    .from('clinic_blocked_dates')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('blocked_date', dateStr)
    .single();

  if (blocked) return { available: false, reason: 'Clinic is closed on this date', slots: [] };

  // Get clinic hours for this day
  const { data: hours } = await supabase
    .from('clinic_hours')
    .select('open_time, close_time, is_open')
    .eq('clinic_id', clinicId)
    .eq('day_of_week', dayOfWeek)
    .single();

  if (!hours || !hours.is_open) {
    return { available: false, reason: 'Clinic is closed on this day', slots: [] };
  }

  // Get all confirmed appointments for this date
  const dayStart = date.startOf('day').toISO();
  const dayEnd = date.endOf('day').toISO();

  const { data: existingAppointments } = await supabase
    .from('appointments')
    .select('appointment_at, duration_mins')
    .eq('clinic_id', clinicId)
    .eq('status', 'confirmed')
    .gte('appointment_at', dayStart)
    .lte('appointment_at', dayEnd);

  // Build set of booked slot start times (ISO strings)
  const bookedTimes = new Set(
    (existingAppointments || []).map(a =>
      DateTime.fromISO(a.appointment_at, { zone: tz }).toISO()
    )
  );

  // Generate all possible slots from open to close
  const [openH, openM] = hours.open_time.split(':').map(Number);
  const [closeH, closeM] = hours.close_time.split(':').map(Number);
  const durationMins = clinic.appointment_duration_mins;

  let current = date.set({ hour: openH, minute: openM, second: 0, millisecond: 0 });
  const closeTime = date.set({ hour: closeH, minute: closeM, second: 0, millisecond: 0 });
  const now = DateTime.now().setZone(tz);

  const slots = [];

  while (current < closeTime) {
    const slotEnd = current.plus({ minutes: durationMins });
    if (slotEnd > closeTime) break;

    // Don't show past slots
    if (current > now) {
      const isoTime = current.toISO();
      slots.push({
        time: current.toFormat('h:mm a'),
        datetime: isoTime,
        available: !bookedTimes.has(isoTime)
      });
    }

    current = current.plus({ minutes: durationMins });
  }

  return {
    available: true,
    date: date.toFormat('cccc, d MMMM yyyy'),
    slots
  };
}

// ============================================================
// CREATE APPOINTMENT
// Used by both AI and receptionist dashboard
// ============================================================
async function createAppointment({ clinicId, patientId, doctorId, datetimeISO, reason, bookedBy = 'ai', notes = null }) {
  // Double-check the slot is still free
  const { data: conflict } = await supabase
    .from('appointments')
    .select('id')
    .eq('doctor_id', doctorId)
    .eq('appointment_at', datetimeISO)
    .eq('status', 'confirmed')
    .single();

  if (conflict) {
    throw new Error('SLOT_TAKEN');
  }

  const { data: clinic } = await supabase
    .from('clinics')
    .select('appointment_duration_mins')
    .eq('id', clinicId)
    .single();

  const { data: appointment, error } = await supabase
    .from('appointments')
    .insert({
      clinic_id: clinicId,
      patient_id: patientId,
      doctor_id: doctorId,
      appointment_at: datetimeISO,
      duration_mins: clinic.appointment_duration_mins,
      reason,
      booked_by: bookedBy,
      notes,
      status: 'confirmed'
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create appointment', { error: error.message });
    throw new Error('Failed to create appointment');
  }

  // Audit log
  await supabase.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'appointment_created',
    entity_type: 'appointment',
    entity_id: appointment.id,
    metadata: { booked_by: bookedBy, reason }
  });

  return appointment;
}

// ============================================================
// CANCEL APPOINTMENT
// ============================================================
async function cancelAppointment(appointmentId, clinicId) {
  const { data, error } = await supabase
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)
    .select()
    .single();

  if (error || !data) throw new Error('Appointment not found or could not be cancelled');

  await supabase.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'appointment_cancelled',
    entity_type: 'appointment',
    entity_id: appointmentId
  });

  return data;
}

// ============================================================
// RESCHEDULE APPOINTMENT
// ============================================================
async function rescheduleAppointment(appointmentId, clinicId, newDatetimeISO) {
  // Check the new slot is free
  const { data: existing } = await supabase
    .from('appointments')
    .select('doctor_id')
    .eq('id', appointmentId)
    .single();

  if (!existing) throw new Error('Appointment not found');

  const { data: conflict } = await supabase
    .from('appointments')
    .select('id')
    .eq('doctor_id', existing.doctor_id)
    .eq('appointment_at', newDatetimeISO)
    .eq('status', 'confirmed')
    .neq('id', appointmentId)
    .single();

  if (conflict) throw new Error('SLOT_TAKEN');

  const { data, error } = await supabase
    .from('appointments')
    .update({ appointment_at: newDatetimeISO, reminder_sent: false })
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)
    .select()
    .single();

  if (error) throw new Error('Failed to reschedule');

  await supabase.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'appointment_rescheduled',
    entity_type: 'appointment',
    entity_id: appointmentId,
    metadata: { new_time: newDatetimeISO }
  });

  return data;
}

// ============================================================
// GET APPOINTMENTS FOR DASHBOARD (date range)
// ============================================================
async function getAppointments(clinicId, fromDate, toDate) {
  const { data, error } = await supabase
    .from('appointments')
    .select(`
      id, appointment_at, duration_mins, reason, status, booked_by, notes, reminder_sent, created_at,
      patients (id, name, whatsapp_number),
      doctors (id, name)
    `)
    .eq('clinic_id', clinicId)
    .gte('appointment_at', fromDate)
    .lte('appointment_at', toDate)
    .order('appointment_at', { ascending: true });

  if (error) throw new Error('Failed to fetch appointments');
  return data;
}

// ============================================================
// GET OR CREATE PATIENT
// ============================================================
async function getOrCreatePatient(clinicId, whatsappNumber, name = null) {
  const { data: existing } = await supabase
    .from('patients')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('whatsapp_number', whatsappNumber)
    .single();

  if (existing) {
    // Update name if we now know it and didn't before
    if (name && !existing.name) {
      await supabase.from('patients').update({ name }).eq('id', existing.id);
      existing.name = name;
    }
    return existing;
  }

  const { data: created, error } = await supabase
    .from('patients')
    .insert({ clinic_id: clinicId, whatsapp_number: whatsappNumber, name })
    .select()
    .single();

  if (error) throw new Error('Failed to create patient');
  return created;
}

module.exports = {
  getAvailableSlots,
  createAppointment,
  cancelAppointment,
  rescheduleAppointment,
  getAppointments,
  getOrCreatePatient
};
