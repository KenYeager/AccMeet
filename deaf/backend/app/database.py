from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, IndexModel
from .config import get_settings

_client: AsyncIOMotorClient | None = None


async def connect_db() -> None:
    global _client
    settings = get_settings()
    _client = AsyncIOMotorClient(settings.mongo_uri)
    db = _client.get_default_database()

    await db.meetings.create_indexes([
        IndexModel([("meeting_code", ASCENDING)], unique=True),
    ])
    await db.meeting_participants.create_indexes([
        IndexModel([("meeting_id", ASCENDING), ("user_id", ASCENDING)]),
    ])
    print("✅ MongoDB connected (DeafMeet) and indexes created")


async def close_db() -> None:
    global _client
    if _client:
        _client.close()
        print("🔌 MongoDB connection closed")


def get_db() -> AsyncIOMotorDatabase:
    if _client is None:
        raise RuntimeError("Database not connected. Call connect_db() first.")
    return _client.get_default_database()
