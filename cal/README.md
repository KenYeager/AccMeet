# AccMeet — Calendar Integration (`cal/`)

Standalone Google Calendar integration for the AccMeet meeting copilot.
Allows a user to **connect their Google Calendar via OAuth** and **create events** through a simple web UI.

Later, the AI agent's `schedule_calendar_event` tool will call the
`services/google_calendar.py` module directly.

---

## Directory Structure

```
cal/
├── backend/
│   ├── main.py                      # FastAPI entrypoint
│   ├── routers/
│   │   └── calendar.py              # /api/calendar/* routes
│   ├── services/
│   │   └── google_calendar.py       # ★ Reusable calendar service
│   ├── db/
│   │   └── mongo.py                 # MongoDB token storage
│   ├── models/
│   │   └── event.py                 # Pydantic models
│   ├── .env.example
│   └── requirements.txt
│
├── frontend/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                 # Main UI
│   │   ├── callback/page.tsx        # OAuth callback fallback
│   │   └── globals.css
│   ├── components/
│   │   ├── CalendarStatus.tsx
│   │   └── EventForm.tsx
│   ├── lib/
│   │   └── api.ts                   # Typed API client
│   ├── .env.local.example
│   └── package.json
│
└── README.md                        # ← You are here
```

---

## 1. Google Cloud Console Setup

### A. Create a project and enable the Calendar API

1. Go to <https://console.cloud.google.com/>
2. Create a new project (or select an existing one)
3. Navigate to **APIs & Services → Library**
4. Search for **Google Calendar API** → Click **Enable**

### B. Create OAuth 2.0 credentials

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Application type: **Web application**
3. Under **Authorized redirect URIs**, add:
   ```
   http://localhost:8000/api/calendar/callback
   ```
4. Click **Create**
5. Copy the **Client ID** and **Client Secret**

### C. OAuth consent screen

1. **APIs & Services → OAuth consent screen**
2. User type: **External** (so any Google account can authorize)
3. Fill in App name, support email, developer contact
4. Add scope: `https://www.googleapis.com/auth/calendar.events`
5. Under **Test users**, add your own Google email (required while app is in Testing status)
6. Save

> **Note**: While the app is in "Testing" status, only test users can authorize.
> For production use, publish the app.

---

## 2. Environment Variables

### Backend

```bash
cd cal/backend
cp .env.example .env
# Then edit .env with your values
```

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | OAuth client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_REDIRECT_URI` | Must match exactly: `http://localhost:8000/api/calendar/callback` |
| `MONGODB_URI` | MongoDB connection string (local or Atlas) |
| `MONGODB_DB` | Database name (default: `accmeet_cal`) |
| `FRONTEND_URL` | URL of Next.js app (default: `http://localhost:3000`) |
| `SECRET_KEY` | Random secret for signing cookies |

### Frontend

```bash
cd cal/frontend
cp .env.local.example .env.local
# Edit NEXT_PUBLIC_API_URL if your backend runs on a different port
```

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | URL of FastAPI backend (default: `http://localhost:8000`) |

---

## 3. Running the Project

### Prerequisites

- Python 3.10+
- Node.js 18+
- MongoDB running locally **or** a MongoDB Atlas URI

### Backend

```bash
cd cal/backend

# Create virtual environment
python -m venv venv

# Activate (Windows PowerShell)
.\venv\Scripts\Activate.ps1

# Activate (macOS/Linux)
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Copy and fill in environment variables
cp .env.example .env   # then edit .env

# Start the server
uvicorn main:app --reload --port 8000
```

FastAPI will be available at: <http://localhost:8000>
Interactive API docs: <http://localhost:8000/docs>

### Frontend

```bash
cd cal/frontend

# Install dependencies
npm install

# Copy and fill in environment variables
cp .env.local.example .env.local

# Start Next.js dev server
npm run dev
```

Frontend will be available at: <http://localhost:3000>

---

## 4. Testing the Full Flow

1. Open <http://localhost:3000>
2. Click **"🔗 Connect Google Calendar"**
3. You are redirected to Google's consent screen — authorize
4. Google redirects to `http://localhost:8000/api/calendar/callback?code=...`
5. FastAPI exchanges the code, stores the token in MongoDB, redirects back to `http://localhost:3000?connected=true`
6. The UI shows **"Connected ✓"**
7. Fill in the event form and click **"📅 Add to Google Calendar"**
8. Open Google Calendar — the event should appear

---

## 5. API Reference (for `schedule_calendar_event` teammate)

### Base URL
```
http://localhost:8000
```

All requests to `/api/calendar/events` require the `cal_user_id` cookie
(set automatically on first visit and persisted by the browser).

---

### `GET /api/calendar/status`

Returns whether the current user has authorized Google Calendar.

**Response**
```json
{ "connected": true }
```

---

### `GET /api/calendar/auth`

Returns the Google OAuth 2.0 authorization URL.

**Response**
```json
{ "auth_url": "https://accounts.google.com/o/oauth2/auth?..." }
```

---

### `GET /api/calendar/callback`

> Called by Google after authorization. Not called by the frontend directly.

Exchanges the OAuth code, stores the token, and redirects to `FRONTEND_URL?connected=true`.

---

### `POST /api/calendar/events`

Create a Google Calendar event.

**Request body**
```json
{
  "title": "Project Follow-up",
  "start": "2026-09-10T15:00:00+05:30",
  "end":   "2026-09-10T16:00:00+05:30",
  "description": "Discuss PR feedback",
  "location": "Conference Room A"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `title` | string | ✓ | Event summary shown in Calendar |
| `start` | ISO 8601 datetime | ✓ | Include timezone offset |
| `end` | ISO 8601 datetime | ✓ | Include timezone offset |
| `description` | string | ✗ | Event body / notes |
| `location` | string | ✗ | Physical or virtual location |

**Response**
```json
{
  "success": true,
  "event": {
    "id": "google_event_id_abc123",
    "title": "Project Follow-up",
    "start": "2026-09-10T15:00:00+05:30",
    "end":   "2026-09-10T16:00:00+05:30",
    "calendar_url": "https://www.google.com/calendar/event?eid=..."
  }
}
```

**Error responses**
```json
// 401 — not connected
{ "detail": "Google Calendar not connected. Please authorize first." }

// 502 — Google API error
{ "detail": "Google Calendar API error: ..." }
```

---

### `DELETE /api/calendar/disconnect`

Remove the stored token (disconnects Google Calendar).

**Response**
```json
{ "success": true }
```

---

## 6. Calling the Service from Python (for `schedule_calendar_event`)

The AI agent can import and call the service directly (no HTTP needed):

```python
# In the agent's schedule_calendar_event tool:
import asyncio
from services.google_calendar import create_calendar_event
from models.event import EventCreate
from datetime import datetime, timezone, timedelta

IST = timezone(timedelta(hours=5, minutes=30))

event_data = EventCreate(
    title="Project Follow-up",
    start=datetime(2026, 9, 10, 15, 0, tzinfo=IST),
    end=datetime(2026, 9, 10, 16, 0, tzinfo=IST),
    description="Discuss PR feedback",
    location="",
)

result = asyncio.run(create_calendar_event(user_id="<uuid-from-cookie>", event_data=event_data))
print(result.calendar_url)
```

---

## 7. MongoDB Document Schema (tokens collection)

```json
{
  "user_id": "uuid-string",
  "token": "ya29.access_token...",
  "refresh_token": "1//refresh_token...",
  "token_uri": "https://oauth2.googleapis.com/token",
  "client_id": "xxx.apps.googleusercontent.com",
  "client_secret": "GOCSPX-...",
  "scopes": ["https://www.googleapis.com/auth/calendar.events"],
  "expiry": "2026-09-04T14:00:00",
  "updated_at": "2026-09-04T13:00:00"
}
```

> **Security**: `client_secret` is stored only in this collection.
> It is never sent to the frontend. In production, encrypt tokens at rest.
