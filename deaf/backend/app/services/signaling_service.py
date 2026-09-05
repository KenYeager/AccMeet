import asyncio
import json
from typing import Any

from fastapi import WebSocket

MAX_ROOM_SIZE = 6


class RoomManager:
    """
    In-memory manager for WebSocket signaling rooms.
    Maps meeting_code → { user_id: { ws, user_name } }
    """

    def __init__(self):
        self._rooms: dict[str, dict[str, dict]] = {}

    def get_room_size(self, meeting_code: str) -> int:
        return len(self._rooms.get(meeting_code, {}))

    def is_room_full(self, meeting_code: str) -> bool:
        return self.get_room_size(meeting_code) >= MAX_ROOM_SIZE

    async def connect(self, meeting_code: str, user_id: str, user_name: str, ws: WebSocket) -> None:
        await ws.accept()
        if meeting_code not in self._rooms:
            self._rooms[meeting_code] = {}
        self._rooms[meeting_code][user_id] = {"ws": ws, "user_name": user_name}
        import sys
        sys.stdout.write(f"\n🔌 [CONNECTED] {user_name} joined room {meeting_code}\n")
        sys.stdout.flush()

    def disconnect(self, meeting_code: str, user_id: str) -> None:
        if meeting_code in self._rooms:
            user = self._rooms[meeting_code].pop(user_id, None)
            if user:
                import sys
                sys.stdout.write(f"\n❌ [DISCONNECTED] {user.get('user_name', user_id)} left room {meeting_code}\n")
                sys.stdout.flush()
            if not self._rooms[meeting_code]:
                del self._rooms[meeting_code]

    def get_participants(self, meeting_code: str) -> list[dict]:
        room = self._rooms.get(meeting_code, {})
        return [
            {"user_id": uid, "user_name": info["user_name"]}
            for uid, info in room.items()
        ]

    async def broadcast(self, meeting_code: str, message: dict, exclude_user_id: str | None = None) -> None:
        """Send a message to all users in the room except the excluded one."""
        room = self._rooms.get(meeting_code, {})
        dead_connections: list[str] = []

        for uid, info in room.items():
            if uid == exclude_user_id:
                continue
            try:
                await info["ws"].send_text(json.dumps(message))
            except Exception:
                dead_connections.append(uid)

        for uid in dead_connections:
            self.disconnect(meeting_code, uid)

    async def send_to_user(self, meeting_code: str, target_user_id: str, message: dict) -> bool:
        """Send a message to a specific user. Returns False if user not found."""
        room = self._rooms.get(meeting_code, {})
        target = room.get(target_user_id)
        if not target:
            return False
        try:
            await target["ws"].send_text(json.dumps(message))
            return True
        except Exception:
            self.disconnect(meeting_code, target_user_id)
            return False

    async def send_to_self(self, meeting_code: str, user_id: str, message: dict) -> None:
        """Send a message to a specific user (e.g., initial room state)."""
        room = self._rooms.get(meeting_code, {})
        info = room.get(user_id)
        if info:
            try:
                await info["ws"].send_text(json.dumps(message))
            except Exception:
                self.disconnect(meeting_code, user_id)


# Global singleton — shared across all WebSocket connections
room_manager = RoomManager()
