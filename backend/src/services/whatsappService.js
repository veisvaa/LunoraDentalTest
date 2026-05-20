const axios = require('axios');
const logger = require('../config/logger');

const WA_BASE_URL = 'https://graph.facebook.com/v19.0';

// ============================================================
// SEND TEXT MESSAGE
// ============================================================
async function sendMessage(toNumber, message) {
  try {
    const response = await axios.post(
      `${WA_BASE_URL}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toNumber,
        type: 'text',
        text: { body: message }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    logger.info('WhatsApp message sent', { to: toNumber, messageId: response.data?.messages?.[0]?.id });
    return response.data;
  } catch (error) {
    const detail = error.response?.data || error.message;
    logger.error('Failed to send WhatsApp message', { to: toNumber, error: detail });
    throw new Error('WhatsApp send failed');
  }
}

// ============================================================
// SEND APPOINTMENT CONFIRMATION
// ============================================================
async function sendBookingConfirmation(toNumber, { patientName, clinicName, appointmentAt, doctorName, reason }) {
  const message =
    `Hi ${patientName || 'there'}! Your appointment has been confirmed.\n\n` +
    `Clinic: ${clinicName}\n` +
    `Doctor: ${doctorName}\n` +
    `Date & Time: ${appointmentAt}\n` +
    (reason ? `Reason: ${reason}\n` : '') +
    `\nIf you need to reschedule or cancel, just reply to this message. See you soon!`;

  return sendMessage(toNumber, message);
}

// ============================================================
// SEND APPOINTMENT REMINDER (24hr before)
// ============================================================
async function sendReminder(toNumber, { patientName, clinicName, appointmentAt, doctorName }) {
  const message =
    `Hi ${patientName || 'there'}! This is a reminder for your appointment tomorrow.\n\n` +
    `Clinic: ${clinicName}\n` +
    `Doctor: ${doctorName}\n` +
    `Time: ${appointmentAt}\n\n` +
    `Reply YES to confirm or NO to cancel.`;

  return sendMessage(toNumber, message);
}

// ============================================================
// SEND CANCELLATION NOTICE
// ============================================================
async function sendCancellationNotice(toNumber, { patientName, clinicName, appointmentAt }) {
  const message =
    `Hi ${patientName || 'there'}. Your appointment at ${clinicName} on ${appointmentAt} has been cancelled.\n\n` +
    `To book a new appointment, just reply to this message.`;

  return sendMessage(toNumber, message);
}

module.exports = {
  sendMessage,
  sendBookingConfirmation,
  sendReminder,
  sendCancellationNotice
};
