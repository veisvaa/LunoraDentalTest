const { createClient } = require('@supabase/supabase-js');
const logger = require('./logger');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false }
  }
);

// Verify connection on startup
async function verifyConnection() {
  const { error } = await supabase.from('clinics').select('id').limit(1);
  if (error) {
    logger.error('Supabase connection failed', { error: error.message });
    process.exit(1);
  }
  logger.info('Supabase connected');
}

module.exports = { supabase, verifyConnection };
