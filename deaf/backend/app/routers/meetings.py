from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, field_validator

from ..database import get_db
from ..models.meeting import MeetingResponse, MeetingWithParticipants, ParticipantResponse
from ..services import meeting_service

router = APIRouter()


class GuestIdentity(BaseModel):
    """Self-declared identity — no server-side verification, just a nametag."""
    user_id: str
    user_name: str

    @field_validator("user_id")
    @classmethod
    def user_id_must_be_present(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("user_id is required")
        return v

    @field_validator("user_name")
    @classmethod
    def user_name_must_be_valid(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name is required")
        if len(v) > 50:
            raise ValueError("Name must be 50 characters or fewer")
        return v


class LeaveRequest(BaseModel):
    user_id: str


@router.post("", response_model=MeetingResponse, status_code=status.HTTP_201_CREATED)
async def create_meeting(
    identity: GuestIdentity,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    meeting = await meeting_service.create_meeting(
        host_id=identity.user_id,
        host_name=identity.user_name,
        db=db,
    )
    return meeting


@router.get("/{code}", response_model=MeetingWithParticipants)
async def get_meeting(
    code: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    meeting_doc = await meeting_service.get_meeting_by_code(code, db)
    if not meeting_doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")

    participants = await meeting_service.get_active_participants(code, db)

    return MeetingWithParticipants(
        meeting=MeetingResponse(
            id=str(meeting_doc["_id"]),
            meeting_code=meeting_doc["meeting_code"],
            host_id=meeting_doc["host_id"],
            host_name=meeting_doc["host_name"],
            status=meeting_doc["status"],
            created_at=meeting_doc["created_at"],
        ),
        participants=participants,
    )


@router.post("/{code}/join", response_model=ParticipantResponse)
async def join_meeting(
    code: str,
    identity: GuestIdentity,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    try:
        participant = await meeting_service.join_meeting(
            code=code,
            user_id=identity.user_id,
            user_name=identity.user_name,
            db=db,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if participant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")

    return participant


@router.post("/{code}/leave", status_code=status.HTTP_204_NO_CONTENT)
async def leave_meeting(
    code: str,
    body: LeaveRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    success = await meeting_service.leave_meeting(code=code, user_id=body.user_id, db=db)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting or participant not found")
    return None


@router.get("/{code}/participants", response_model=list[ParticipantResponse])
async def get_participants(
    code: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    meeting_doc = await meeting_service.get_meeting_by_code(code, db)
    if not meeting_doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    return await meeting_service.get_active_participants(code, db)
