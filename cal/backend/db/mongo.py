"""
MongoDB connection and token storage.

Only OAuth tokens (access_token, refresh_token, expiry, scopes) are stored
here — never Google client secrets.

Token document schema:
{
    "_id": ObjectId,
    "user_id": str,           # UUID cookie value — links browser session to token
    "token": str,             # encrypted-at-rest in production; plaintext here for simplicity
    "refresh_token": str,
    "token_uri": str,
    "client_id": str,         # non-secret, already public in OAuth flow
    "scopes": [str],
    "expiry": datetime | null
}
"""
from __future__ import annotations

import os
from datetime import datetime
from typing import Optional

import motor.motor_asyncio
from dotenv import load_dotenv

load_dotenv()

_MONGODB_URI: str = os.environ["MONGODB_URI"]
_MONGODB_DB: str = os.environ.get("MONGODB_DB", "accmeet_cal")

_client: Optional[motor.motor_asyncio.AsyncIOMotorClient] = None


def get_client() -> motor.motor_asyncio.AsyncIOMotorClient:
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(_MONGODB_URI)
    return _client


def get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:
    return get_client()[_MONGODB_DB]


def get_tokens_collection() -> motor.motor_asyncio.AsyncIOMotorCollection:
    return get_db()["calendar_tokens"]


# ── CRUD ──────────────────────────────────────────────────────────────────────

async def save_token(user_id: str, creds_data: dict) -> None:
    """Upsert a token document for a given user_id."""
    col = get_tokens_collection()
    await col.update_one(
        {"user_id": user_id},
        {"$set": {**creds_data, "user_id": user_id, "updated_at": datetime.utcnow()}},
        upsert=True,
    )


async def load_token(user_id: str) -> Optional[dict]:
    """Return the token document for a given user_id, or None."""
    col = get_tokens_collection()
    doc = await col.find_one({"user_id": user_id})
    if doc:
        doc.pop("_id", None)  # remove MongoDB ObjectId before returning
    return doc


async def delete_token(user_id: str) -> None:
    """Remove a token document (i.e., disconnect the calendar)."""
    col = get_tokens_collection()
    await col.delete_one({"user_id": user_id})


async def token_exists(user_id: str) -> bool:
    """Return True if valid token exists for user_id."""
    col = get_tokens_collection()
    doc = await col.find_one({"user_id": user_id}, {"_id": 1})
    return doc is not None
