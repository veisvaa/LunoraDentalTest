const { supabase } = require('../config/supabase');
const logger = require('../config/logger');

const MAX_CONTEXT_MESSAGES = 20; // keep last 20 messages for Claude context

// ============================================================
// GET OR CREATE CONVERSATION
// ============================================================
async function getOrCreateConversation(clinicId, whatsappNumber, patientId) {
  const { data: existing } = await supabase
    .from('conversations')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('whatsapp_number', whatsappNumber)
    .single();

  if (existing) return existing;

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({
      clinic_id: clinicId,
      patient_id: patientId,
      whatsapp_number: whatsappNumber,
      human_active: false,
      ai_context: [],
      booking_state: null
    })
    .select()
    .single();

  if (error) throw new Error('Failed to create conversation');
  return created;
}

// ============================================================
// APPEND MESSAGE TO CONTEXT WINDOW
// Keeps rolling window of last N messages
// ============================================================
async function appendToContext(conversationId, role, content) {
  const { data: conv } = await supabase
    .from('conversations')
    .select('ai_context')
    .eq('id', conversationId)
    .single();

  const currentContext = conv?.ai_context || [];
  const updated = [...currentContext, { role, content }].slice(-MAX_CONTEXT_MESSAGES);

  await supabase
    .from('conversations')
    .update({ ai_context: updated })
    .eq('id', conversationId);

  return updated;
}

// ============================================================
// CHECK IF NUMBER IS STAFF
// ============================================================
async function isStaffNumber(clinicId, whatsappNumber) {
  const { data } = await supabase
    .from('staff_numbers')
    .select('id, role')
    .eq('clinic_id', clinicId)
    .eq('whatsapp_number', whatsappNumber)
    .single();

  return data || null;
}

// ============================================================
// ACTIVATE HUMAN TAKEOVER
// Called when a staff member sends a message in a patient chat
// ============================================================
async function activateHumanTakeover(conversationId, clinicId) {
  await supabase
    .from('conversations')
    .update({
      human_active: true,
      human_last_replied_at: new Date().toISOString()
    })
    .eq('id', conversationId);

  await supabase.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'human_takeover',
    entity_type: 'conversation',
    entity_id: conversationId
  });

  logger.info('Human takeover activated', { conversationId });
}

// ============================================================
// RESUME AI
// Called manually via dashboard or automatically by cron
// ============================================================
async function resumeAI(conversationId, clinicId) {
  await supabase
    .from('conversations')
    .update({
      human_active: false,
      human_last_replied_at: null
    })
    .eq('id', conversationId);

  await supabase.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'ai_resumed',
    entity_type: 'conversation',
    entity_id: conversationId
  });

  logger.info('AI resumed', { conversationId });
}

// ============================================================
// UPDATE BOOKING STATE
// Stores partial booking data while AI is collecting info
// ============================================================
async function updateBookingState(conversationId, state) {
  await supabase
    .from('conversations')
    .update({ booking_state: state })
    .eq('id', conversationId);
}

// ============================================================
// CLEAR BOOKING STATE
// Called after appointment is confirmed or conversation resets
// ============================================================
async function clearBookingState(conversationId) {
  await supabase
    .from('conversations')
    .update({ booking_state: null })
    .eq('id', conversationId);
}

module.exports = {
  getOrCreateConversation,
  appendToContext,
  isStaffNumber,
  activateHumanTakeover,
  resumeAI,
  updateBookingState,
  clearBookingState
};
