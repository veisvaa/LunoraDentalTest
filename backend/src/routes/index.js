const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const appointmentController = require('../controllers/appointmentController');
const { verifyWebhook, handleWebhook } = require('../controllers/webhookController');

// ============================================================
// WHATSAPP WEBHOOK (no auth — Meta calls this directly)
// ============================================================
router.get('/webhook', verifyWebhook);
router.post('/webhook', handleWebhook);

// ============================================================
// DASHBOARD API (requires auth)
// ============================================================
router.use('/api', authenticate);

// Appointments
router.get('/api/appointments', appointmentController.getAppointments);
router.post('/api/appointments', appointmentController.createAppointment);
router.patch('/api/appointments/:id/cancel', appointmentController.cancelAppointment);
router.patch('/api/appointments/:id/reschedule', appointmentController.rescheduleAppointment);
router.get('/api/appointments/slots', appointmentController.getSlots);

// Conversations / AI control
router.post('/api/conversations/:patientNumber/resume-ai', appointmentController.resumeAI);

// Health check (no auth)
router.get('/health', (req, res) => res.json({ status: 'ok', service: 'lunora-backend' }));

module.exports = router;
