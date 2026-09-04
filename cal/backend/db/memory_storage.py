"""
In-memory OAuth token storage for development and prototyping.

This module provides temporary token storage using a simple in-memory dictionary.
It implements the same interface as db/mongo.py for drop-in compatibility.

Production deployment will replace this with MongoDB persistence.

Token document structure (same as MongoDB):
{
    "user_id": str,           # UUID cookie value
    "token": str,             # access token
    "refresh_token": str,     # refresh token (allows obtaining new access tokens)
    "token_uri": str,         # token endpoint
    "client_id": str,         # OAuth client ID
    "scopes": [str],          # OAuth scopes granted
    "expiry": str | None      # ISO 8601 expiry datetime
}
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

# Global in-memory storage: user_id -> token_data dict
_tokens: dict[str, dict] = {}


async def save_token(user_id: str, creds_data: dict) -> None:
    """
    Upsert a token document for a given user_id.
    
    Args:
        user_id: UUID identifying the browser session
        creds_data: Dictionary with keys: token, refresh_token, token_uri, 
                    client_id, scopes, expiry
    """
    _tokens[user_id] = {
        **creds_data,
        "user_id": user_id,
        "updated_at": datetime.utcnow().isoformat(),
    }


async def load_token(user_id: str) -> Optional[dict]:
    """
    Return the token document for a given user_id, or None.
    
    Args:
        user_id: UUID identifying the browser session
        
    Returns:
        Token dictionary or None if not found
    """
    if user_id not in _tokens:
        return None
    return _tokens[user_id].copy()


async def delete_token(user_id: str) -> None:
    """
    Remove a token document (i.e., disconnect the calendar).
    
    Args:
        user_id: UUID identifying the browser session
    """
    _tokens.pop(user_id, None)


async def token_exists(user_id: str) -> bool:
    """
    Return True if valid token exists for user_id.
    
    Args:
        user_id: UUID identifying the browser session
        
    Returns:
        True if a token is stored for this user_id
    """
    return user_id in _tokens
