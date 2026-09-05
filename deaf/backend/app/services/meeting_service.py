import random
import string
from datetime import datetime, timezone

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from ..models.meeting import MeetingResponse, ParticipantResponse

MEETING_CODE_LENGTH = 6
MEETING_CODE_CHARS = string.ascii_uppercase + string.digits
MAX_PARTICIPANTS = 6


def generate_meeting_code() -> str:
    return "".join(random.choices(MEETING_CODE_CHARS, k=MEETING_CODE_LENGTH))


async def create_meeting(host_id: str, host_name: str, db: AsyncIOMotorDatabase) -> MeetingResponse:
    for _ in range(5):
        code = generate_meeting_code()
        existing = await db.meetings.find_one({"meeting_code": code, "status": {"$ne": "ended"}})
        if not existing:
            break
    else:
        raise RuntimeError("Failed to generate unique meeting code")

    now = datetime.now(timezone.utc)
    doc = {
        "meeting_code": code,
        "host_id": host_id,
        "host_name": host_name,
        "status": "waiting",
        "created_at": now,
    }
    result = await db.meetings.insert_one(doc)
    return MeetingResponse(
        id=str(result.inserted_id),
        meeting_code=code,
        host_id=host_id,
        host_name=host_name,
        status="waiting",
        created_at=now,
    )


async def get_meeting_by_code(code: str, db: AsyncIOMotorDatabase) -> dict | None:
    return await db.meetings.find_one({"meeting_code": code.upper()})


async def join_meeting(
    code: str, user_id: str, user_name: str, db: AsyncIOMotorDatabase
) -> ParticipantResponse:
    meeting = await get_meeting_by_code(code, db)
    if not meeting:
        return None

    if meeting["status"] == "ended":
        raise ValueError("Meeting has ended")

    active_count = await db.meeting_participants.count_documents({
        "meeting_id": str(meeting["_id"]),
        "left_at": None,
    })
    if active_count >= MAX_PARTICIPANTS:
        raise ValueError(f"Meeting is full (max {MAX_PARTICIPANTS} participants)")

    existing_participant = await db.meeting_participants.find_one({
        "meeting_id": str(meeting["_id"]),
        "user_id": user_id,
        "left_at": None,
    })
    if existing_participant:
        return ParticipantResponse(
            id=str(existing_participant["_id"]),
            meeting_id=str(meeting["_id"]),
            user_id=user_id,
            user_name=user_name,
            joined_at=existing_participant["joined_at"],
            left_at=None,
        )

    now = datetime.now(timezone.utc)
    participant_doc = {
        "meeting_id": str(meeting["_id"]),
        "user_id": user_id,
        "user_name": user_name,
        "joined_at": now,
        "left_at": None,
    }
    result = await db.meeting_participants.insert_one(participant_doc)

    if meeting["status"] == "waiting":
        await db.meetings.update_one(
            {"_id": meeting["_id"]},
            {"$set": {"status": "active"}},
        )

    return ParticipantResponse(
        id=str(result.inserted_id),
        meeting_id=str(meeting["_id"]),
        user_id=user_id,
        user_name=user_name,
        joined_at=now,
        left_at=None,
    )


async def leave_meeting(code: str, user_id: str, db: AsyncIOMotorDatabase) -> bool:
    meeting = await get_meeting_by_code(code, db)
    if not meeting:
        return False

    now = datetime.now(timezone.utc)
    result = await db.meeting_participants.update_one(
        {"meeting_id": str(meeting["_id"]), "user_id": user_id, "left_at": None},
        {"$set": {"left_at": now}},
    )

    if result.modified_count == 0:
        return False

    active_count = await db.meeting_participants.count_documents({
        "meeting_id": str(meeting["_id"]),
        "left_at": None,
    })
    if active_count == 0:
        await db.meetings.update_one(
            {"_id": meeting["_id"]},
            {"$set": {"status": "ended"}},
        )

    return True


async def get_active_participants(code: str, db: AsyncIOMotorDatabase) -> list[ParticipantResponse]:
    meeting = await get_meeting_by_code(code, db)
    if not meeting:
        return []

    cursor = db.meeting_participants.find({
        "meeting_id": str(meeting["_id"]),
        "left_at": None,
    })
    participants = []
    async for doc in cursor:
        participants.append(ParticipantResponse(
            id=str(doc["_id"]),
            meeting_id=str(meeting["_id"]),
            user_id=doc["user_id"],
            user_name=doc["user_name"],
            joined_at=doc["joined_at"],
            left_at=doc.get("left_at"),
        ))
    return participants
