import json

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from motor.motor_asyncio import AsyncIOMotorDatabase

from ..database import get_db
from ..services.signaling_service import room_manager
from ..services.meeting_service import get_meeting_by_code

router = APIRouter()

# Message types that get relayed to a specific target peer
RELAY_TYPES = {"offer", "answer", "ice_candidate"}

# Message types that get broadcast to all peers in the room
# caption is critical for deaf users — always broadcast
BROADCAST_TYPES = {"mute_status", "video_status", "caption"}


@router.websocket("/ws/{meeting_code}")
async def websocket_endpoint(
    websocket: WebSocket,
    meeting_code: str,
    user_id: str = Query(...),
    user_name: str = Query(...),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    meeting_code = meeting_code.upper()
    user_id = user_id.strip()
    user_name = user_name.strip()[:50] or "Guest"

    if not user_id:
        await websocket.close(code=4001, reason="Missing identity")
        return

    meeting = await get_meeting_by_code(meeting_code, db)
    if not meeting:
        await websocket.close(code=4004, reason="Meeting not found")
        return
    if meeting["status"] == "ended":
        await websocket.close(code=4003, reason="Meeting has ended")
        return

    if room_manager.is_room_full(meeting_code):
        await websocket.close(code=4002, reason="Meeting room is full")
        return

    await room_manager.connect(meeting_code, user_id, user_name, websocket)

    participants = room_manager.get_participants(meeting_code)
    await room_manager.send_to_self(meeting_code, user_id, {
        "type": "room_state",
        "payload": {
            "participants": [p for p in participants if p["user_id"] != user_id],
            "your_user_id": user_id,
            "your_user_name": user_name,
        }
    })

    await room_manager.broadcast(meeting_code, {
        "type": "participant_joined",
        "payload": {
            "user_id": user_id,
            "user_name": user_name,
        }
    }, exclude_user_id=user_id)

    try:
        while True:
            raw = await websocket.receive_text()

            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = message.get("type")
            payload = message.get("payload", {})
            target_user_id = message.get("target_user_id")

            # Always print to stdout to ensure visibility in uvicorn console
            import sys
            if msg_type == "caption":
                text = payload.get("text", "")
                is_final = payload.get("is_final", False)
                final_tag = "[FINAL]" if is_final else "[INTERIM]"
                sys.stdout.write(f"\n========================================\n🗣️  SPEAKER ({user_name}): {text} {final_tag}\n========================================\n\n")
                sys.stdout.flush()
            else:
                sys.stdout.write(f"[WS MSG] {user_name} -> {msg_type}\n")
                sys.stdout.flush()

            if msg_type in RELAY_TYPES:
                if target_user_id:
                    await room_manager.send_to_user(meeting_code, target_user_id, {
                        "type": msg_type,
                        "from_user_id": user_id,
                        "from_user_name": user_name,
                        "payload": payload,
                    })

            elif msg_type in BROADCAST_TYPES:
                await room_manager.broadcast(meeting_code, {
                    "type": msg_type,
                    "from_user_id": user_id,
                    "from_user_name": user_name,
                    "payload": payload,
                }, exclude_user_id=user_id)

    except WebSocketDisconnect:
        pass
    finally:
        room_manager.disconnect(meeting_code, user_id)

        await room_manager.broadcast(meeting_code, {
            "type": "participant_left",
            "payload": {
                "user_id": user_id,
                "user_name": user_name,
            }
        })
