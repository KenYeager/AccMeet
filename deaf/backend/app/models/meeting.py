from datetime import datetime
from typing import Literal
from pydantic import BaseModel


class MeetingResponse(BaseModel):
    id: str
    meeting_code: str
    host_id: str
    host_name: str
    status: Literal["waiting", "active", "ended"]
    created_at: datetime


class ParticipantResponse(BaseModel):
    id: str
    meeting_id: str
    user_id: str
    user_name: str
    joined_at: datetime
    left_at: datetime | None = None


class MeetingWithParticipants(BaseModel):
    meeting: MeetingResponse
    participants: list[ParticipantResponse]
