const cron = require('node-cron');
const { supabase } = require('../config/supabase');
const whatsappService = require('../services/whatsappService');
const logger = require('../config/logger');
const { DateTime } = require('luxon');

// ============================================================
// REMINDER JOB
// Runs every hour
// Finds appointments 23-25 hours from now with no reminder sent
// Sends WhatsApp reminder and marks reminder_sent = true
// ============================================================
async function sendPendingReminders() {
  logger.info('Running reminder job');

  try {
    const now = DateTime.utc();
    const windowStart = now.plus({ hours: 23 }).toISO();
    const windowEnd = now.plus({ hours: 25 }).toISO();

    const { data: appointments, error } = await supabase
      .from('appointments')
      .select(`
        id, appointment_at, reason,
        clinics (id, name, timezone),
        patients (name, whatsapp_number),
        doctors (name)
      `)
      .eq('status', 'confirmed')
      .eq('reminder_sent', false)
      .gte('appointment_at', windowStart)
      .lte('appointment_at', windowEnd);

    if (error) {
      logger.error('Reminder query failed', { error: error.message });
      return;
    }

    if (!appointments || appointments.length === 0) {
      logger.info('No reminders to send');
      return;
    }

    logger.info(`Sending ${appointments.length} reminders`);

    for (const appt of appointments) {
      try {
        const tz = appt.clinics?.timezone || 'Asia/Kuala_Lumpur';
        const formattedTime = DateTime.fromISO(appt.appointment_at, { zone: tz }).toFormat('h:mm a');

        await whatsappService.sendReminder(appt.patients.whatsapp_number, {
          patientName: appt.patients.name,
          clinicName: appt.clinics.name,
          appointmentAt: formattedTime,
          doctorName: appt.doctors?.name
        });

        // Mark as sent
        await supabase
          .from('appointments')
          .update({ reminder_sent: true })
          .eq('id', appt.id);

        // Log it
        await supabase.from('audit_log').insert({
          clinic_id: appt.clinics.id,
          action: 'reminder_sent',
          entity_type: 'appointment',
          entity_id: appt.id
        });

        logger.info('Reminder sent', { appointmentId: appt.id, patient: appt.patients.whatsapp_number });
      } catch (err) {
        logger.error('Failed to send individual reminder', { appointmentId: appt.id, error: err.message });
        // Continue with others even if one fails
      }
    }
  } catch (error) {
    logger.error('Reminder job crashed', { error: error.message });
  }
}

// ============================================================
// AUTO-RESUME AI CRON
// Runs every 5 minutes
// Finds conversations where human_active = true but staff has
// been silent longer than the clinic's ai_resume_after_mins
// ============================================================
async function autoResumeAI() {
  try {
    const { data: clinics } = await supabase
      .from('clinics')
      .select('id, ai_resume_after_mins')
      .eq('is_active', true);

    if (!clinics) return;

    for (const clinic of clinics) {
      const cutoff = DateTime.utc().minus({ minutes: clinic.ai_resume_after_mins }).toISO();

      const { data: staleConversations } = await supabase
        .from('conversations')
        .select('id')
        .eq('clinic_id', clinic.id)
        .eq('human_active', true)
        .lt('human_last_replied_at', cutoff);

      if (!staleConversations || staleConversations.length === 0) continue;

      for (const conv of staleConversations) {
        await supabase
          .from('conversations')
          .update({ human_active: false, human_last_replied_at: null })
          .eq('id', conv.id);

        await supabase.from('audit_log').insert({
          clinic_id: clinic.id,
          action: 'ai_auto_resumed',
          entity_type: 'conversation',
          entity_id: conv.id
        });

        logger.info('AI auto-resumed after staff silence', { conversationId: conv.id });
      }
    }
  } catch (error) {
    logger.error('Auto-resume AI job failed', { error: error.message });
  }
}

// ============================================================
// REGISTER CRON JOBS
// ============================================================
function startJobs() {
  // Reminders: every hour at :00
  cron.schedule('0 * * * *', sendPendingReminders, {
    timezone: 'Asia/Kuala_Lumpur'
  });

  // Auto-resume AI: every 5 minutes
  cron.schedule('*/5 * * * *', autoResumeAI);

  logger.info('Cron jobs started: reminders (hourly), AI auto-resume (every 5 min)');
}

module.exports = { startJobs, sendPendingReminders, autoResumeAI };
