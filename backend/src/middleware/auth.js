const logger = require('../config/logger');
const { supabase } = require('../config/supabase');

// ============================================================
// API KEY AUTH MIDDLEWARE
// All dashboard API requests must include:
// Authorization: Bearer <API_SECRET_KEY>
// X-Clinic-ID: <clinic_uuid>
// ============================================================
async function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const clinicId = req.headers['x-clinic-id'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  if (!clinicId) {
    return res.status(401).json({ error: 'Missing X-Clinic-ID header' });
  }

  const token = authHeader.split(' ')[1];

  if (token !== process.env.API_SECRET_KEY) {
    logger.warn('Invalid API key attempt', { clinicId });
    return res.status(403).json({ error: 'Invalid API key' });
  }

  // Verify clinic exists and is active
  const { data: clinic } = await supabase
    .from('clinics')
    .select('id, is_active')
    .eq('id', clinicId)
    .single();

  if (!clinic || !clinic.is_active) {
    return res.status(403).json({ error: 'Clinic not found or inactive' });
  }

  req.clinicId = clinicId;
  next();
}

module.exports = { authenticate };
