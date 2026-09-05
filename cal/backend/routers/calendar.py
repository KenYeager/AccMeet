"""
FastAPI router for Google Calendar endpoints.

All routes are mounted at /api/calendar/* via the main.py app.

Endpoints
---------
GET  /api/calendar/status    → {connected: bool}
GET  /api/calendar/auth      → {auth_url: str}
GET  /api/calendar/callback  → redirects to frontend after exchanging code
POST /api/calendar/events    → create a calendar event
GET  /api/calendar/events    → list upcoming events (optional)
DELETE /api/calendar/disconnect → remove stored token
"""
from __future__ import annotations

import os
import uuid
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Cookie, HTTPException, Response
from fastapi.responses import RedirectResponse

from db import delete_token
from models.event import (
    AuthStatusResponse,
    AuthUrlResponse,
    CreateEventResponse,
    EventCreate,
)
from services import google_calendar as cal_service

load_dotenv()

_FRONTEND_URL: str = os.environ.get("FRONTEND_URL", "http://localhost:3000")

router = APIRouter(prefix="/api/calendar", tags=["calendar"])

# ── Helpers ───────────────────────────────────────────────────────────────────

def _ensure_user_id(response: Response, user_id: Optional[str]) -> str:
    """
    Return the existing user_id from the cookie, or create + set a new one.
    The cookie is HttpOnly so it is never readable by frontend JS.
    """
    if user_id:
        return user_id
    new_id = str(uuid.uuid4())
    response.set_cookie(
        key="cal_user_id",
        value=new_id,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 365,  # 1 year
    )
    return new_id


# ── Status ────────────────────────────────────────────────────────────────────

@router.get("/status", response_model=AuthStatusResponse)
async def get_status(
    response: Response,
    cal_user_id: Optional[str] = Cookie(default=None),
) -> AuthStatusResponse:
    """
    Return whether the current browser session has authorized Google Calendar.
    Also ensures the user_id cookie is set.
    """
    user_id = _ensure_user_id(response, cal_user_id)
    connected = await cal_service.is_connected(user_id)
    return AuthStatusResponse(connected=connected)


# ── Auth URL ──────────────────────────────────────────────────────────────────

@router.get("/auth", response_model=AuthUrlResponse)
async def get_auth_url(
    response: Response,
    cal_user_id: Optional[str] = Cookie(default=None),
) -> AuthUrlResponse:
    """
    Return the Google OAuth 2.0 authorization URL.
    The frontend should redirect the user to this URL.
    """
    # Ensure a user_id cookie exists before the OAuth round-trip begins
    _ensure_user_id(response, cal_user_id)
    auth_url = cal_service.get_auth_url()
    return AuthUrlResponse(auth_url=auth_url)


# ── OAuth Callback ────────────────────────────────────────────────────────────

@router.get("/callback")
async def oauth_callback(
    code: str,
    response: Response,
    cal_user_id: Optional[str] = Cookie(default=None),
    error: Optional[str] = None,
) -> RedirectResponse:
    """
    Google redirects here after the user authorizes (or denies) access.

    Exchanges the authorization code for tokens, stores them in memory
    (development) or MongoDB (production), then redirects back to the
    frontend with a ?connected=true query param.
    """
    if error:
        return RedirectResponse(url=f"{_FRONTEND_URL}?error={error}")

    user_id = _ensure_user_id(response, cal_user_id)

    try:
        await cal_service.exchange_code(user_id, code)
    except Exception as exc:
        return RedirectResponse(url=f"{_FRONTEND_URL}?error=token_exchange_failed")

    # Redirect back to frontend — the cookie will travel with this response
    redirect = RedirectResponse(url=f"{_FRONTEND_URL}?connected=true")
    # Re-set the cookie on the redirect response so the browser keeps it
    redirect.set_cookie(
        key="cal_user_id",
        value=user_id,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 365,
    )
    return redirect


# ── Create Event ──────────────────────────────────────────────────────────────

@router.post("/events", response_model=CreateEventResponse)
async def create_event(
    event: EventCreate,
    response: Response,
    cal_user_id: Optional[str] = Cookie(default=None),
) -> CreateEventResponse:
    """
    Create a Google Calendar event for the current user.

    Expected JSON body:
    {
        "title": "Project Follow-up",
        "start": "2026-09-10T15:00:00+05:30",
        "end":   "2026-09-10T16:00:00+05:30",
        "description": "Discuss PR feedback",
        "location": ""
    }
    """
    user_id = _ensure_user_id(response, cal_user_id)

    if not await cal_service.is_connected(user_id):
        raise HTTPException(
            status_code=401,
            detail="Google Calendar not connected. Please authorize first.",
        )

    try:
        result = await cal_service.create_calendar_event(user_id, event)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    return CreateEventResponse(success=True, event=result)


# ── Disconnect ────────────────────────────────────────────────────────────────

@router.delete("/disconnect")
async def disconnect(
    response: Response,
    cal_user_id: Optional[str] = Cookie(default=None),
) -> dict:
    """Remove stored Google Calendar token (disconnect)."""
    if cal_user_id:

        await delete_token(cal_user_id)
    return {"success": True}
