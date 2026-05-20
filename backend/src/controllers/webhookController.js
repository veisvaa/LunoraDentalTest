const { supabase } = require('../config/supabase');
const bookingService = require('../services/bookingService');
const conversationService = require('../services/conversationService');
const aiService = require('../services/aiService');
const whatsappService = require('../services/whatsappService');
const logger = require('../config/logger');
const { DateTime } = require('luxon');

// ============================================================
// WEBHOOK VERIFICATION (Meta requires this on setup)
// ============================================================
function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    logger.info('WhatsApp webhook verified');
    return res.status(200).send(challenge);
  }

  logger.warn('Webhook verification failed', { mode, token });
  res.sendStatus(403);
}

// ============================================================
// HANDLE INCOMING WEBHOOK EVENT
// ============================================================
async function handleWebhook(req, res) {
  // Always respond 200 immediately — Meta will retry if you don't
  res.sendStatus(200);

  try {
    const body = req.body;
    if (!body?.entry?.[0]?.changes?.[0]?.value?.messages) return;

    const value = body.entry[0].changes[0].value;
    const message = value.messages[0];
    const metadata = value.metadata;

    // Only handle text messages for now
    if (message.type !== 'text') return;

    const fromNumber = message.from;         // patient or staff number
    const toNumber = metadata.display_phone_number; // clinic's WA number
    const messageText = message.text.body.trim();

    logger.info('Incoming WhatsApp message', { from: fromNumber, to: toNumber, text: messageText });

    // Find which clinic this belongs to
    const { data: clinic } = await supabase
      .from('clinics')
      .select('*')
      .eq('whatsapp_number', `+${toNumber}`)
      .eq('is_active', true)
      .single();

    if (!clinic) {
      logger.warn('No active clinic found for number', { toNumber });
      return;
    }

    // --------------------------------------------------------
    // STAFF MESSAGE DETECTION
    // If sender is a registered staff number, activate takeover
    // --------------------------------------------------------
    const staffMember = await conversationService.isStaffNumber(clinic.id, `+${fromNumber}`);

    if (staffMember) {
      logger.info('Staff message detected — human takeover', { staffNumber: fromNumber, role: staffMember.role });

      // Find the conversation they are replying in
      // Staff messages come through the business number, so we need context
      // The staff member types: /reply +60123456789 <message> to target a patient
      // OR we detect based on the thread context Meta sends
      // For now: staff messages to the main number are handled as commands
      await handleStaffCommand(clinic, staffMember, fromNumber, messageText);
      return;
    }

    // --------------------------------------------------------
    // PATIENT MESSAGE
    // --------------------------------------------------------
    const patient = await bookingService.getOrCreatePatient(clinic.id, `+${fromNumber}`);
    const conversation = await conversationService.getOrCreateConversation(clinic.id, `+${fromNumber}`, patient.id);

    // Append patient message to context
    await conversationService.appendToContext(conversation.id, 'user', messageText);

    // --------------------------------------------------------
    // HUMAN ACTIVE — AI is paused, do nothing
    // --------------------------------------------------------
    if (conversation.human_active) {
      logger.info('AI paused for conversation — human is active', { conversationId: conversation.id });
      return;
    }

    // --------------------------------------------------------
    // AI HANDLES THE MESSAGE
    // --------------------------------------------------------
    const context = conversation.ai_context || [];
    const aiRawResponse = await aiService.getAIResponse(clinic.id, context, messageText);
    const parsed = aiService.parseAIResponse(aiRawResponse);

    // Handle booking commands from AI
    if (parsed.type === 'BOOK_APPOINTMENT') {
      await handleBookingCommand(clinic, patient, conversation, parsed.payload, parsed.message);
    } else if (parsed.type === 'CANCEL_APPOINTMENT') {
      await handleCancellationCommand(clinic, patient, conversation, parsed.payload, parsed.message);
    } else {
      // Plain response
      await whatsappService.sendMessage(`+${fromNumber}`, parsed.message);
      await conversationService.appendToContext(conversation.id, 'assistant', parsed.message);
    }

  } catch (error) {
    logger.error('Webhook handler error', { error: error.message, stack: error.stack });
  }
}

// ============================================================
// HANDLE BOOKING COMMAND
// ============================================================
async function handleBookingCommand(clinic, patient, conversation, payload, confirmMessage) {
  try {
    const { name, date, time, reason } = payload;

    // Get the clinic's doctor
    const { data: doctor } = await supabase
      .from('doctors')
      .select('*')
      .eq('clinic_id', clinic.id)
      .eq('is_active', true)
      .single();

    if (!doctor) throw new Error('No active doctor found');

    // Construct appointment datetime in clinic timezone
    const datetimeISO = DateTime.fromISO(`${date}T${time}:00`, { zone: clinic.timezone }).toISO();

    // Create the appointment
    const appointment = await bookingService.createAppointment({
      clinicId: clinic.id,
      patientId: patient.id,
      doctorId: doctor.id,
      datetimeISO,
      reason,
      bookedBy: 'ai'
    });

    // Update patient name if we got it from the booking
    if (name && !patient.name) {
      await supabase.from('patients').update({ name }).eq('id', patient.id);
    }

    // Format confirmation message
    const formattedTime = DateTime.fromISO(datetimeISO, { zone: clinic.timezone }).toFormat('cccc, d MMMM yyyy h:mm a');

    const confirmText = confirmMessage ||
      `Your appointment has been booked!\n\n` +
      `Name: ${name}\n` +
      `Doctor: ${doctor.name}\n` +
      `Date & Time: ${formattedTime}\n` +
      `Reason: ${reason}\n\n` +
      `We will send you a reminder 24 hours before. See you soon!`;

    await whatsappService.sendMessage(patient.whatsapp_number, confirmText);
    await conversationService.appendToContext(conversation.id, 'assistant', confirmText);
    await conversationService.clearBookingState(conversation.id);

    logger.info('Appointment booked via AI', { appointmentId: appointment.id, patient: patient.whatsapp_number });

  } catch (error) {
    if (error.message === 'SLOT_TAKEN') {
      const sorry = 'Sorry, that time slot was just taken. Please choose another time.';
      await whatsappService.sendMessage(patient.whatsapp_number, sorry);
      await conversationService.appendToContext(conversation.id, 'assistant', sorry);
    } else {
      logger.error('Booking command failed', { error: error.message });
      const sorry = 'I was unable to complete your booking. Please call the clinic directly or try again.';
      await whatsappService.sendMessage(patient.whatsapp_number, sorry);
    }
  }
}

// ============================================================
// HANDLE CANCELLATION COMMAND
// ============================================================
async function handleCancellationCommand(clinic, patient, conversation, payload, message) {
  try {
    const { name, date } = payload;
    const dayStart = DateTime.fromISO(date, { zone: clinic.timezone }).startOf('day').toISO();
    const dayEnd = DateTime.fromISO(date, { zone: clinic.timezone }).endOf('day').toISO();

    const { data: appointment } = await supabase
      .from('appointments')
      .select('id, appointment_at')
      .eq('clinic_id', clinic.id)
      .eq('patient_id', patient.id)
      .eq('status', 'confirmed')
      .gte('appointment_at', dayStart)
      .lte('appointment_at', dayEnd)
      .single();

    if (!appointment) {
      const notFound = 'I could not find a confirmed appointment on that date for you. Please check the date or contact the clinic.';
      await whatsappService.sendMessage(patient.whatsapp_number, notFound);
      return;
    }

    await bookingService.cancelAppointment(appointment.id, clinic.id);

    const cancelText = message || `Your appointment on ${date} has been cancelled. If you would like to rebook, just let me know.`;
    await whatsappService.sendMessage(patient.whatsapp_number, cancelText);
    await conversationService.appendToContext(conversation.id, 'assistant', cancelText);

  } catch (error) {
    logger.error('Cancellation command failed', { error: error.message });
  }
}

// ============================================================
// HANDLE STAFF COMMANDS
// Staff can type commands to control the system
// Commands: /pause <patient_number>, /resume <patient_number>
// ============================================================
async function handleStaffCommand(clinic, staffMember, staffNumber, messageText) {
  const text = messageText.trim().toLowerCase();

  const pauseMatch = messageText.match(/^\/pause\s+(\+?\d+)/i);
  const resumeMatch = messageText.match(/^\/resume\s+(\+?\d+)/i);

  if (pauseMatch) {
    const targetNumber = pauseMatch[1].startsWith('+') ? pauseMatch[1] : `+${pauseMatch[1]}`;
    const { data: conv } = await supabase
      .from('conversations')
      .select('id')
      .eq('clinic_id', clinic.id)
      .eq('whatsapp_number', targetNumber)
      .single();

    if (conv) {
      await conversationService.activateHumanTakeover(conv.id, clinic.id);
      await whatsappService.sendMessage(`+${staffNumber}`, `AI paused for ${targetNumber}. Type /resume ${targetNumber} to hand back.`);
    }
    return;
  }

  if (resumeMatch) {
    const targetNumber = resumeMatch[1].startsWith('+') ? resumeMatch[1] : `+${resumeMatch[1]}`;
    const { data: conv } = await supabase
      .from('conversations')
      .select('id')
      .eq('clinic_id', clinic.id)
      .eq('whatsapp_number', targetNumber)
      .single();

    if (conv) {
      await conversationService.resumeAI(conv.id, clinic.id);
      await whatsappService.sendMessage(`+${staffNumber}`, `AI resumed for ${targetNumber}.`);
    }
    return;
  }

  logger.info('Unrecognised staff command', { text: messageText });
}

module.exports = { verifyWebhook, handleWebhook };
