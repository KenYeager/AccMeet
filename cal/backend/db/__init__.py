"""Storage backend selector.

Both db.mongo and db.memory_storage expose the same async interface
(save_token, load_token, delete_token, token_exists). Which one backs the
rest of the app is decided once, here, based on whether MONGODB_URI is set —
every other module should import from `db`, never from `db.mongo` or
`db.memory_storage` directly, so this stays the single source of truth.
"""
import os

from dotenv import load_dotenv

# main.py loads .env too, but only *after* it imports routers.calendar, which
# imports this module — without this call, MONGODB_URI isn't in the
# environment yet at the moment this check runs, and it silently falls back
# to in-memory storage regardless of what's actually configured.
load_dotenv()

if os.environ.get("MONGODB_URI"):
    from db.mongo import save_token, load_token, delete_token, token_exists
else:
    from db.memory_storage import save_token, load_token, delete_token, token_exists

__all__ = ["save_token", "load_token", "delete_token", "token_exists"]
