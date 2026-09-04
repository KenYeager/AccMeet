"""
Pydantic models for the Calendar service.

These models define the contract for:
  - Creating calendar events (used by the API endpoint AND the AI agent's
    schedule_calendar_event tool in the future)
  - API responses
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# ── Request ───────────────────────────────────────────────────────────────────

class EventCreate(BaseModel):
    """
    Structured input for creating a Google Calendar event.

    This is the data contract the AI agent's schedule_calendar_event tool
    will also use when it calls the calendar service directly.
    """
    title: str = Field(..., description="Event title / summary")
    start: datetime = Field(..., description="Start datetime (ISO 8601 with timezone)")
    end: datetime = Field(..., description="End datetime (ISO 8601 with timezone)")
    description: Optional[str] = Field(None, description="Optional event body / notes")
    location: Optional[str] = Field(None, description="Optional physical or virtual location")


# ── Response ──────────────────────────────────────────────────────────────────

class EventResult(BaseModel):
    """Structured response returned after a calendar event is created."""
    id: str = Field(..., description="Google Calendar event ID")
    title: str
    start: str
    end: str
    calendar_url: str = Field(..., description="Link to open the event in Google Calendar")


class CreateEventResponse(BaseModel):
    success: bool
    event: Optional[EventResult] = None
    error: Optional[str] = None


class AuthStatusResponse(BaseModel):
    connected: bool


class AuthUrlResponse(BaseModel):
    auth_url: str
