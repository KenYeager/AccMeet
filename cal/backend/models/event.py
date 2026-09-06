"""
Pydantic models for the Calendar service.

These models define the contract for:
  - Creating calendar events (used by the API endpoint AND the AI agent's
    schedule_calendar_event tool in the future)
  - API responses
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

# A closed set rather than a free-form RRULE string: the caller (an LLM tool
# call, ultimately) only ever needs to express "repeats every day/week/month",
# and generating raw RRULE syntax is an easy place for a model to make a
# subtly-wrong string that silently creates the wrong recurrence. Mapping
# happens once, in one place (google_calendar.py's _RRULE_BY_FREQUENCY).
RecurrenceFrequency = Literal["daily", "weekly", "monthly"]


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
    recurrence: Optional[RecurrenceFrequency] = Field(
        None,
        description="Set when the event repeats — omit entirely for a one-time event. "
        "The first occurrence is still `start`/`end`; this only controls repetition after that.",
    )


# ── Response ──────────────────────────────────────────────────────────────────

class EventResult(BaseModel):
    """Structured response returned after a calendar event is created."""
    id: str = Field(..., description="Google Calendar event ID")
    title: str
    start: str
    end: str
    calendar_url: str = Field(..., description="Link to open the event in Google Calendar")
    recurrence: Optional[RecurrenceFrequency] = Field(
        None, description="Echoes the recurrence that was actually applied, if any."
    )


class CreateEventResponse(BaseModel):
    success: bool
    event: Optional[EventResult] = None
    error: Optional[str] = None


class AuthStatusResponse(BaseModel):
    connected: bool


class AuthUrlResponse(BaseModel):
    auth_url: str
