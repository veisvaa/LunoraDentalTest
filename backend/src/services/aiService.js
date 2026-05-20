const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../config/supabase');
const { getAvailableSlots } = require('./bookingService');
const logger = require('../config/logger');
const { DateTime } = require('luxon');

const client = new Anthropic();

// ============================================================
// BUILD SYSTEM PROMPT
// Personalised per clinic, injected with real-time context
// ============================================================
async function buildSystemPrompt(clinic, doctor, todayDate) {
  return `You are a professional and friendly dental clinic assistant for ${clinic.name}. Your name is Luna.

Your job is to help patients via WhatsApp. You can:
1. Answer general questions about the clinic
2. Book appointments
3. Cancel or reschedule appointments
4. Provide clinic hours and contact info

CLINIC INFORMATION:
- Name: ${clinic.name}
- Address: ${clinic.address || 'Please call the clinic for the address'}
- Phone: ${clinic.phone || 'Please contact us via WhatsApp'}
- Doctor: ${doctor?.name || 'Our dentist'}${doctor?.specialization ? ` (${doctor.specialization})` : ''}
- Appointment duration: ${clinic.appointment_duration_mins} minutes per session
- Today's date: ${todayDate}

BOOKING FLOW:
When a patient wants to book, collect these in order:
1. Their full name
2. Preferred date (confirm it is a working day first)
3. Preferred time (show available slots for that date)
4. Reason for visit

Once you have all four, confirm the details with the patient before finalising. Say: "Just to confirm: [name], [date], [time], [reason] - shall I go ahead and book this?"

If the patient confirms, respond ONLY with this exact JSON block (nothing else after it):
BOOK_APPOINTMENT:{"name":"<name>","date":"<YYYY-MM-DD>","time":"<HH:MM>","reason":"<reason>"}

CANCELLATION / RESCHEDULE:
If a patient wants to cancel or reschedule, ask for their name and the date of their appointment. Then respond with:
CANCEL_APPOINTMENT:{"name":"<name>","date":"<YYYY-MM-DD>"}
or
RESCHEDULE_APPOINTMENT:{"name":"<name>","old_date":"<YYYY-MM-DD>","new_date":"<YYYY-MM-DD>","new_time":"<HH:MM>"}

RULES:
- Always write in plain text. No markdown, no asterisks, no bullet symbols, no formatting characters.
- Be warm, concise, and professional. This is a healthcare setting.
- If a patient asks something outside your scope (medical advice, pricing breakdown, insurance), politely say the receptionist will assist and offer to take a message.
- Never make up availability. Always base slot availability on what the system provides you.
- If the clinic is closed on a requested day, say so clearly and suggest the next available day.
- Keep responses short. Patients are on mobile.
- Do not repeat yourself. Do not over-explain.`;
}

// ============================================================
// GET CLINIC + DOCTOR FOR AI CONTEXT
// ============================================================
async function getClinicContext(clinicId) {
  const { data: clinic } = await supabase
    .from('clinics')
    .select('*')
    .eq('id', clinicId)
    .single();

  const { data: doctor } = await supabase
    .from('doctors')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .single();

  return { clinic, doctor };
}

// ============================================================
// MAIN AI RESPONSE FUNCTION
// ============================================================
async function getAIResponse(clinicId, conversationHistory, incomingMessage) {
  const { clinic, doctor } = await getClinicContext(clinicId);

  if (!clinic) throw new Error('Clinic not found');

  const todayDate = DateTime.now().setZone(clinic.timezone).toFormat('cccc, d MMMM yyyy');
  const systemPrompt = await buildSystemPrompt(clinic, doctor, todayDate);

  // Build messages array: history + new message
  const messages = [
    ...conversationHistory,
    { role: 'user', content: incomingMessage }
  ];

  logger.debug('Calling Claude', { clinicId, messageCount: messages.length });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    system: systemPrompt,
    messages
  });

  const aiText = response.content[0]?.text || '';

  logger.debug('Claude response', { clinicId, response: aiText.substring(0, 100) });

  return aiText;
}

// ============================================================
// PARSE AI RESPONSE FOR BOOKING COMMANDS
// Returns { type, payload, message }
// ============================================================
function parseAIResponse(aiText) {
  // Check for booking command
  const bookMatch = aiText.match(/BOOK_APPOINTMENT:(\{.*?\})/s);
  if (bookMatch) {
    try {
      const payload = JSON.parse(bookMatch[1]);
      const message = aiText.replace(/BOOK_APPOINTMENT:\{.*?\}/s, '').trim();
      return { type: 'BOOK_APPOINTMENT', payload, message };
    } catch (e) {
      logger.error('Failed to parse BOOK_APPOINTMENT payload', { raw: bookMatch[1] });
    }
  }

  const cancelMatch = aiText.match(/CANCEL_APPOINTMENT:(\{.*?\})/s);
  if (cancelMatch) {
    try {
      const payload = JSON.parse(cancelMatch[1]);
      const message = aiText.replace(/CANCEL_APPOINTMENT:\{.*?\}/s, '').trim();
      return { type: 'CANCEL_APPOINTMENT', payload, message };
    } catch (e) {
      logger.error('Failed to parse CANCEL_APPOINTMENT payload', { raw: cancelMatch[1] });
    }
  }

  const rescheduleMatch = aiText.match(/RESCHEDULE_APPOINTMENT:(\{.*?\})/s);
  if (rescheduleMatch) {
    try {
      const payload = JSON.parse(rescheduleMatch[1]);
      const message = aiText.replace(/RESCHEDULE_APPOINTMENT:\{.*?\}/s, '').trim();
      return { type: 'RESCHEDULE_APPOINTMENT', payload, message };
    } catch (e) {
      logger.error('Failed to parse RESCHEDULE_APPOINTMENT payload', { raw: rescheduleMatch[1] });
    }
  }

  return { type: 'MESSAGE', payload: null, message: aiText };
}

module.exports = {
  getAIResponse,
  parseAIResponse,
  getAvailableSlots
};
