const bookingService = require('../services/bookingService');
const whatsappService = require('../services/whatsappService');
const conversationService = require('../services/conversationService');
const { supabase } = require('../config/supabase');
const logger = require('../config/logger');
const { DateTime } = require('luxon');

// ============================================================
// GET APPOINTMENTS (for dashboard calendar)
// GET /api/appointments?from=2024-01-01&to=2024-01-31
// ============================================================
async function getAppointments(req, res) {
  try {
    const { clinicId } = req;
    const { from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'from and to dates are required' });
    }

    const appointments = await bookingService.getAppointments(clinicId, from, to);
    res.json({ appointments });
  } catch (error) {
    logger.error('getAppointments error', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
}

// ============================================================
// CREATE APPOINTMENT (receptionist manual booking)
// POST /api/appointments
// ============================================================
async function createAppointment(req, res) {
  try {
    const { clinicId } = req;
    const { patientName, patientPhone, date, time, reason, notes } = req.body;

    if (!patientName || !patientPhone || !date || !time) {
      return res.status(400).json({ error: 'patientName, patientPhone, date, and time are required' });
    }

    // Format phone number
    const phone = patientPhone.startsWith('+') ? patientPhone : `+${patientPhone}`;

    // Get or create patient
    const patient = await bookingService.getOrCreatePatient(clinicId, phone, patientName);

    // Get clinic + doctor
    const { data: clinic } = await supabase.from('clinics').select('*').eq('id', clinicId).single();
    const { data: doctor } = await supabase.from('doctors').select('*').eq('clinic_id', clinicId).eq('is_active', true).single();

    if (!doctor) return res.status(400).json({ error: 'No active doctor found for this clinic' });

    // Build datetime
    const datetimeISO = DateTime.fromISO(`${date}T${time}:00`, { zone: clinic.timezone }).toISO();

    const appointment = await bookingService.createAppointment({
      clinicId,
      patientId: patient.id,
      doctorId: doctor.id,
      datetimeISO,
      reason,
      bookedBy: 'receptionist',
      notes
    });

    // Send confirmation via WhatsApp
    const formattedTime = DateTime.fromISO(datetimeISO, { zone: clinic.timezone }).toFormat('cccc, d MMMM yyyy h:mm a');
    await whatsappService.sendBookingConfirmation(phone, {
      patientName,
      clinicName: clinic.name,
      appointmentAt: formattedTime,
      doctorName: doctor.name,
      reason
    });

    res.status(201).json({ appointment });
  } catch (error) {
    if (error.message === 'SLOT_TAKEN') {
      return res.status(409).json({ error: 'That time slot is already booked' });
    }
    logger.error('createAppointment error', { error: error.message });
    res.status(500).json({ error: 'Failed to create appointment' });
  }
}

// ============================================================
// CANCEL APPOINTMENT
// PATCH /api/appointments/:id/cancel
// ============================================================
async function cancelAppointment(req, res) {
  try {
    const { clinicId } = req;
    const { id } = req.params;
    const { notifyPatient = true } = req.body;

    const appointment = await bookingService.cancelAppointment(id, clinicId);

    if (notifyPatient) {
      const { data: clinic } = await supabase.from('clinics').select('name, timezone').eq('id', clinicId).single();
      const { data: patient } = await supabase.from('patients').select('name, whatsapp_number').eq('id', appointment.patient_id).single();

      const formattedTime = DateTime.fromISO(appointment.appointment_at, { zone: clinic.timezone }).toFormat('cccc, d MMMM yyyy h:mm a');

      await whatsappService.sendCancellationNotice(patient.whatsapp_number, {
        patientName: patient.name,
        clinicName: clinic.name,
        appointmentAt: formattedTime
      });
    }

    res.json({ success: true, appointment });
  } catch (error) {
    logger.error('cancelAppointment error', { error: error.message });
    res.status(500).json({ error: 'Failed to cancel appointment' });
  }
}

// ============================================================
// RESCHEDULE APPOINTMENT
// PATCH /api/appointments/:id/reschedule
// ============================================================
async function rescheduleAppointment(req, res) {
  try {
    const { clinicId } = req;
    const { id } = req.params;
    const { date, time, notifyPatient = true } = req.body;

    if (!date || !time) return res.status(400).json({ error: 'date and time are required' });

    const { data: clinic } = await supabase.from('clinics').select('*').eq('id', clinicId).single();
    const newDatetimeISO = DateTime.fromISO(`${date}T${time}:00`, { zone: clinic.timezone }).toISO();

    const appointment = await bookingService.rescheduleAppointment(id, clinicId, newDatetimeISO);

    if (notifyPatient) {
      const { data: patient } = await supabase.from('patients').select('name, whatsapp_number').eq('id', appointment.patient_id).single();
      const { data: doctor } = await supabase.from('doctors').select('name').eq('id', appointment.doctor_id).single();
      const formattedTime = DateTime.fromISO(newDatetimeISO, { zone: clinic.timezone }).toFormat('cccc, d MMMM yyyy h:mm a');

      await whatsappService.sendBookingConfirmation(patient.whatsapp_number, {
        patientName: patient.name,
        clinicName: clinic.name,
        appointmentAt: formattedTime,
        doctorName: doctor?.name,
        reason: appointment.reason
      });
    }

    res.json({ success: true, appointment });
  } catch (error) {
    if (error.message === 'SLOT_TAKEN') {
      return res.status(409).json({ error: 'That time slot is already booked' });
    }
    logger.error('rescheduleAppointment error', { error: error.message });
    res.status(500).json({ error: 'Failed to reschedule appointment' });
  }
}

// ============================================================
// GET AVAILABLE SLOTS
// GET /api/appointments/slots?date=2024-01-15
// ============================================================
async function getSlots(req, res) {
  try {
    const { clinicId } = req;
    const { date } = req.query;

    if (!date) return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });

    const result = await bookingService.getAvailableSlots(clinicId, date);
    res.json(result);
  } catch (error) {
    logger.error('getSlots error', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch slots' });
  }
}

// ============================================================
// RESUME AI FOR A CONVERSATION (dashboard button)
// POST /api/conversations/:patientNumber/resume-ai
// ============================================================
async function resumeAI(req, res) {
  try {
    const { clinicId } = req;
    const { patientNumber } = req.params;

    const { data: conv } = await supabase
      .from('conversations')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('whatsapp_number', patientNumber)
      .single();

    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    await conversationService.resumeAI(conv.id, clinicId);
    res.json({ success: true });
  } catch (error) {
    logger.error('resumeAI error', { error: error.message });
    res.status(500).json({ error: 'Failed to resume AI' });
  }
}

module.exports = {
  getAppointments,
  createAppointment,
  cancelAppointment,
  rescheduleAppointment,
  getSlots,
  resumeAI
};
