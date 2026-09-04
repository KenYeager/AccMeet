"""
FastAPI application entrypoint for the AccMeet Calendar service.

Run with:
    uvicorn main:app --reload --port 8000
"""
from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers.calendar import router as calendar_router

load_dotenv()

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="AccMeet Calendar API",
    description=(
        "Google Calendar integration for the AccMeet meeting copilot.\n\n"
        "This service handles:\n"
        "- Google OAuth 2.0 authorization\n"
        "- Token storage (in-memory for development; MongoDB optional for production)\n"
        "- Google Calendar event creation\n\n"
        "The `schedule_calendar_event` AI agent tool calls this service's "
        "underlying `google_calendar.py` module directly."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
# Allow the Next.js frontend to call this API in development.
# In production, restrict to your actual domain.

_FRONTEND_URL: str = os.environ.get("FRONTEND_URL", "http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[_FRONTEND_URL],
    allow_credentials=True,   # required so cookies are sent cross-origin
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(calendar_router)


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health", tags=["health"])
async def health() -> dict:
    return {"status": "ok", "service": "accmeet-calendar"}
