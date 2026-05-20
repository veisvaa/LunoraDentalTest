require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { verifyConnection } = require('./config/supabase');
const routes = require('./routes/index');
const { startJobs } = require('./jobs/reminderJob');
const logger = require('./config/logger');

const app = express();

// ============================================================
// SECURITY MIDDLEWARE
// ============================================================
app.use(helmet());

app.use(cors({
  origin: process.env.DASHBOARD_URL || '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Clinic-ID']
}));

// Rate limiting — 100 requests per minute per IP
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false
}));

// Raw body for webhook signature verification (Meta requirement)
app.use('/webhook', express.raw({ type: 'application/json' }), (req, res, next) => {
  if (req.body && Buffer.isBuffer(req.body)) {
    req.rawBody = req.body;
    req.body = JSON.parse(req.body.toString());
  }
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================
// ROUTES
// ============================================================
app.use('/', routes);

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================================
// STARTUP
// ============================================================
async function start() {
  await verifyConnection();
  startJobs();

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    logger.info(`Lunora backend running on port ${PORT}`, { env: process.env.NODE_ENV });
  });
}

start().catch(err => {
  logger.error('Failed to start server', { error: err.message });
  process.exit(1);
});

module.exports = app;
