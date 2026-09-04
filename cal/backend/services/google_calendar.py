"""
Google Calendar Service — reusable module.

This service contains all Google Calendar API logic.
It is designed to be called from:
  1. The FastAPI router (via HTTP API)
  2. The AI agent's schedule_calendar_event tool (directly, in a future iteration)

Public interface
----------------
    get_auth_url() -> str
    exchange_code(code: str) -> dict
    get_credentials(user_id: str) -> google.oauth2.credentials.Credentials
    create_calendar_event(user_id: str, event_data: EventCreate) -> EventResult
    is_connected(user_id: str) -> bool
"""
from __future__ import annotations

import os
from datetime import datetime
from typing import Optional

from dotenv import load_dotenv
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build

from db.memory_storage import load_token, save_token, token_exists
from models.event import EventCreate, EventResult

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────

_CLIENT_ID: str = os.environ["GOOGLE_CLIENT_ID"]
_CLIENT_SECRET: str = os.environ["GOOGLE_CLIENT_SECRET"]
_REDIRECT_URI: str = os.environ["GOOGLE_REDIRECT_URI"]

# Minimum scope required to create events in Google Calendar
_SCOPES: list[str] = ["https://www.googleapis.com/auth/calendar.events"]


def _make_flow() -> Flow:
    """Create a Google OAuth flow object from environment credentials."""
    return Flow.from_client_config(
        client_config={
            "web": {
                "client_id": _CLIENT_ID,
                "client_secret": _CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [_REDIRECT_URI],
            }
        },
        scopes=_SCOPES,
        redirect_uri=_REDIRECT_URI,
    )


# ── Auth ──────────────────────────────────────────────────────────────────────

def get_auth_url() -> str:
    """
    Return the Google OAuth 2.0 authorization URL.

    The user should be redirected to this URL to start the OAuth flow.
    `access_type=offline` ensures we receive a refresh_token so we don't
    need to re-authorize after the access token expires.
    """
    flow = _make_flow()
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",  # force consent screen so refresh_token is always returned
    )
    return auth_url


async def exchange_code(user_id: str, code: str) -> None:
    """
    Exchange the authorization code for tokens and store them in memory.

    Called once after the user returns from Google's consent screen.
    For production, implement persistent storage via MongoDB or another backend.
    """
    flow = _make_flow()
    flow.fetch_token(code=code)
    creds = flow.credentials
    await _persist_credentials(user_id, creds)


async def _persist_credentials(user_id: str, creds: Credentials) -> None:
    """Serialize and store credentials in memory (development) or MongoDB (production)."""
    data = {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": list(creds.scopes) if creds.scopes else _SCOPES,
        "expiry": creds.expiry.isoformat() if creds.expiry else None,
    }
    await save_token(user_id, data)


async def get_credentials(user_id: str) -> Optional[Credentials]:
    """
    Load credentials from memory for a user and refresh if expired.

    Returns None if no credentials are stored for this user.
    (Production: will load from MongoDB or another persistent backend)
    """
    data = await load_token(user_id)
    if not data:
        return None

    expiry = None
    if data.get("expiry"):
        try:
            expiry = datetime.fromisoformat(data["expiry"])
        except ValueError:
            expiry = None

    creds = Credentials(
        token=data.get("token"),
        refresh_token=data.get("refresh_token"),
        token_uri=data.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=data.get("client_id", _CLIENT_ID),
        client_secret=data.get("client_secret", _CLIENT_SECRET),
        scopes=data.get("scopes", _SCOPES),
        expiry=expiry,
    )

    # Refresh the token if it has expired
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        await _persist_credentials(user_id, creds)  # persist refreshed token

    return creds


async def is_connected(user_id: str) -> bool:
    """Return True if the user has a stored Google Calendar token."""
    return await token_exists(user_id)


# ── Calendar API ──────────────────────────────────────────────────────────────

async def create_calendar_event(user_id: str, event_data: EventCreate) -> EventResult:
    """
    Create a Google Calendar event for the given user.

    This is the primary function that the AI agent's schedule_calendar_event
    tool will call in a future iteration.

    Parameters
    ----------
    user_id : str
        The UUID that links a browser session (or agent session) to stored tokens.
    event_data : EventCreate
        Structured event data (title, start, end, description, location).

    Returns
    -------
    EventResult
        Structured result including the Google event ID and a link to open
        the event in Google Calendar.

    Raises
    ------
    ValueError
        If no credentials are found for the given user_id.
    RuntimeError
        If the Google Calendar API call fails.
    """
    creds = await get_credentials(user_id)
    if not creds:
        raise ValueError(f"No Google Calendar credentials found for user '{user_id}'. "
                         "The user must complete OAuth authorization first.")

    service = build("calendar", "v3", credentials=creds)

    # Build the Google Calendar API event body
    event_body: dict = {
        "summary": event_data.title,
        "start": {
            "dateTime": event_data.start.isoformat(),
            "timeZone": str(event_data.start.tzinfo) if event_data.start.tzinfo else "UTC",
        },
        "end": {
            "dateTime": event_data.end.isoformat(),
            "timeZone": str(event_data.end.tzinfo) if event_data.end.tzinfo else "UTC",
        },
    }
    if event_data.description:
        event_body["description"] = event_data.description
    if event_data.location:
        event_body["location"] = event_data.location

    try:
        created = service.events().insert(calendarId="primary", body=event_body).execute()
    except Exception as exc:
        raise RuntimeError(f"Google Calendar API error: {exc}") from exc

    return EventResult(
        id=created["id"],
        title=created.get("summary", event_data.title),
        start=created["start"].get("dateTime", created["start"].get("date", "")),
        end=created["end"].get("dateTime", created["end"].get("date", "")),
        calendar_url=created.get("htmlLink", "https://calendar.google.com"),
    )
