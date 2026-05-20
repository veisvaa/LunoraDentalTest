# Lunora — Setup Guide

## What was built

| File | What it does |
|------|-------------|
| `schema.sql` | Full database schema — run once in Supabase |
| `backend/src/index.js` | Express server entry point |
| `backend/src/config/` | Supabase + logger config |
| `backend/src/services/bookingService.js` | All appointment logic (slots, create, cancel, reschedule) |
| `backend/src/services/conversationService.js` | AI/human takeover state management |
| `backend/src/services/aiService.js` | Claude integration + booking command parsing |
| `backend/src/services/whatsappService.js` | Sends WhatsApp messages via Meta API |
| `backend/src/controllers/webhookController.js` | Handles every incoming WhatsApp message |
| `backend/src/controllers/appointmentController.js` | Dashboard API endpoints |
| `backend/src/middleware/auth.js` | API key authentication |
| `backend/src/jobs/reminderJob.js` | 24hr reminders + AI auto-resume cron |
| `backend/src/routes/index.js` | All route definitions |
| `frontend/src/App.jsx` | Full clinic dashboard (React) |

---

## Step 1 — Supabase

1. Go to https://supabase.com and create a free account
2. Create a new project (choose Singapore region)
3. Once the project loads, go to **SQL Editor**
4. Open `schema.sql` from this project and paste the entire contents
5. Click **Run**
6. Go to **Project Settings → API**
7. Copy:
   - **Project URL** → this is your `SUPABASE_URL`
   - **service_role** key (under API Keys) → this is your `SUPABASE_SERVICE_ROLE_KEY`

---

## Step 2 — Backend on Render

1. Push this entire project to a GitHub repo
2. Go to https://render.com, create a free account
3. Click **New → Web Service** → connect your GitHub repo
4. Set:
   - Root directory: `backend`
   - Build command: `npm install`
   - Start command: `npm start`
   - Region: **Singapore**
5. Add these environment variables (under Environment tab):

```
NODE_ENV=production
SUPABASE_URL=<from Supabase>
SUPABASE_SERVICE_ROLE_KEY=<from Supabase>
ANTHROPIC_API_KEY=<from console.anthropic.com>
WHATSAPP_ACCESS_TOKEN=<from Meta developer portal>
WHATSAPP_PHONE_NUMBER_ID=<from Meta developer portal>
WHATSAPP_VERIFY_TOKEN=lunora_verify_2024
API_SECRET_KEY=<generate a random 32-char string>
DASHBOARD_URL=<your Vercel dashboard URL, added after Step 3>
```

6. Deploy. Once live, copy the Render URL (e.g. https://lunora-backend.onrender.com)

---

## Step 3 — Frontend on Vercel

1. Go to https://vercel.com
2. Import your GitHub repo
3. Set root directory to `frontend`
4. Add environment variables:

```
VITE_API_URL=<your Render backend URL>
VITE_API_KEY=<same API_SECRET_KEY you used in Render>
VITE_CLINIC_ID=<the clinic UUID from Supabase — run: SELECT id FROM clinics LIMIT 1>
```

5. Deploy. Copy the Vercel URL and add it to Render as `DASHBOARD_URL`.

---

## Step 4 — Meta WhatsApp Business API

1. Go to https://developers.facebook.com
2. Create a new app → choose **Business** type
3. Add the **WhatsApp** product
4. Under WhatsApp → Configuration:
   - Webhook URL: `https://your-render-url.onrender.com/webhook`
   - Verify token: `lunora_verify_2024`
   - Subscribe to: `messages`
5. Under WhatsApp → API Setup, get:
   - **Phone Number ID** → `WHATSAPP_PHONE_NUMBER_ID`
   - **Access Token** → `WHATSAPP_ACCESS_TOKEN`
6. Update these in your Render environment variables

---

## Step 5 — Register clinic staff numbers

In Supabase SQL Editor, run:

```sql
-- Replace with actual clinic staff WhatsApp numbers
INSERT INTO staff_numbers (clinic_id, whatsapp_number, name, role)
SELECT id, '+60123456789', 'Dr. Amirah', 'doctor'
FROM clinics WHERE name = 'Klinik Pergigian Harmoni';

INSERT INTO staff_numbers (clinic_id, whatsapp_number, name, role)
SELECT id, '+60198765432', 'Receptionist Siti', 'receptionist'
FROM clinics WHERE name = 'Klinik Pergigian Harmoni';
```

---

## How the human takeover works

When a staff number sends a message in a patient chat, the AI pauses for that conversation.

The AI resumes automatically after 30 minutes of staff silence.

Staff can also control it manually by sending these to the clinic number:
- `/pause +60XXXXXXXXX` — pause AI for a specific patient
- `/resume +60XXXXXXXXX` — resume AI for a specific patient

---

## Updating clinic details

In Supabase, go to the **clinics** table and edit the row directly. Change hours in **clinic_hours**. Block dates in **clinic_blocked_dates**.

---

## Adding a new clinic client

```sql
INSERT INTO clinics (name, whatsapp_number, phone, address, welcome_message)
VALUES ('New Clinic Name', '+601XXXXXXXXX', '03-XXXXXXXX', 'Address here', 'Welcome message here');
```

Then seed their hours and doctor the same way as the schema.sql example.
