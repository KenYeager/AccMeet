import os
from datetime import datetime, timedelta
from typing import Literal, Optional

import httpx
from langchain_core.tools import tool
from pydantic import BaseModel, Field

RecurrenceFrequency = Literal["daily", "weekly", "monthly"]

CAL_SERVICE_URL = os.getenv("CAL_SERVICE_URL", "http://localhost:8002")
CAL_USER_ID = os.getenv("CAL_USER_ID", "")
DEFAULT_EVENT_DURATION_MINUTES = int(os.getenv("DEFAULT_EVENT_DURATION_MINUTES", "30"))


class ScheduleEventInput(BaseModel):
    title: str = Field(description="Short event title/summary.")
    start: datetime = Field(description="Event start, ISO 8601 with an explicit UTC offset.")
    end: Optional[datetime] = Field(
        default=None,
        description="Event end, ISO 8601 with an explicit UTC offset. Omit if not stated — a default duration is applied.",
    )
    description: Optional[str] = Field(default=None, description="Optional event notes.")
    location: Optional[str] = Field(default=None, description="Optional physical or virtual location.")
    recurrence: Optional[RecurrenceFrequency] = Field(
        default=None,
        description="Set ONLY when the commitment is explicitly repeating — 'every day', "
        "'each week', 'every month'. Omit entirely for a one-time commitment, even one on a "
        "recurring-sounding day like 'every Tuesday' if only ONE Tuesday was actually meant.",
    )


@tool("schedule_calendar_event", args_schema=ScheduleEventInput)
async def schedule_calendar_event(
    title: str,
    start: datetime,
    end: Optional[datetime] = None,
    description: Optional[str] = None,
    location: Optional[str] = None,
    recurrence: Optional[RecurrenceFrequency] = None,
) -> str:
    """Creates a Google Calendar event for an explicit, unambiguous meeting/date commitment.
    Set `recurrence` when the commitment explicitly repeats (daily/weekly/monthly)."""
    if not CAL_USER_ID:
        return "Google Calendar not connected (CAL_USER_ID is unset in rag/backend/.env) — event NOT created."

    resolved_end = end or (start + timedelta(minutes=DEFAULT_EVENT_DURATION_MINUTES))

    body = {
        "title": title,
        "start": start.isoformat(),
        "end": resolved_end.isoformat(),
    }
    if description:
        body["description"] = description
    if location:
        body["location"] = location
    if recurrence:
        body["recurrence"] = recurrence

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"{CAL_SERVICE_URL}/api/calendar/events",
                json=body,
                cookies={"cal_user_id": CAL_USER_ID},
            )
    except httpx.RequestError as e:
        return f"cal service unreachable at {CAL_SERVICE_URL} — event NOT created ({e})."

    if response.status_code == 401:
        return "Google Calendar not connected (CAL_USER_ID missing/invalid) — event NOT created."
    if response.status_code >= 400:
        return f"Google Calendar API error — event NOT created: {response.text}"

    data = response.json()
    calendar_url = data.get("event", {}).get("calendar_url", "")
    repeats = f" (repeats {recurrence})" if recurrence else ""
    return f"Event '{title}' created{repeats}: {calendar_url}"
