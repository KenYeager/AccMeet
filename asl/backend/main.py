"""Standalone Gemini-powered ASL video interpretation API."""
from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
import os
import time

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from starlette.websockets import WebSocketState
from google import genai
from google.genai import types

load_dotenv()
logger = logging.getLogger("asl.websocket")

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
ASL_PROMPT = """Interpret this short video as American Sign Language. Consider hand shape, movement, orientation, both hands, and facial or other non-manual cues. Return only concise natural English for the sign or short phrase. Do not spell out individual letters unless the signer is clearly fingerspelling. Do not hallucinate: if the signing is unclear, return exactly [NO_CLEAR_SIGN]. Do not repeat a previous translation unless the video clearly contains a new occurrence. Do not add explanations, confidence scores, markdown, or quotation marks."""

app = FastAPI(title="AccMeet ASL Translator", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _is_transient_service_error(exc: Exception) -> bool:
    status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    return status == 503 or "503" in str(exc) or "UNAVAILABLE" in str(exc).upper()


def _uncertain_result(text: str) -> bool:
    normalized = text.strip().upper()
    return normalized in {"[NO_CLEAR_SIGN]", "UNCERTAIN", "[UNCERTAIN]"}


def _interpret_clip(video_bytes: bytes, mime_type: str, previous: list[str]) -> str:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured in asl/backend/.env")
    client = genai.Client(api_key=api_key)
    recent = ", ".join(previous[-5:]) if previous else "none"
    prompt = f"{ASL_PROMPT}\nPrevious translations to avoid repeating: {recent}."
    for attempt in range(3):
        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=[types.Part.from_bytes(data=video_bytes, mime_type=mime_type), prompt],
                config=types.GenerateContentConfig(temperature=0.1),
            )
            return (response.text or "").strip()
        except Exception as exc:
            if not _is_transient_service_error(exc) or attempt == 2:
                raise
            time.sleep(2**attempt)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "gemini_configured": bool(os.getenv("GEMINI_API_KEY")), "model": GEMINI_MODEL}


def _socket_is_open(websocket: WebSocket) -> bool:
    return (
        websocket.client_state == WebSocketState.CONNECTED
        and websocket.application_state == WebSocketState.CONNECTED
    )


async def _send_if_open(websocket: WebSocket, payload: dict) -> bool:
    """Send only while both sides still consider the WebSocket connected."""
    if not _socket_is_open(websocket):
        return False
    try:
        await websocket.send_json(payload)
        return True
    except (WebSocketDisconnect, RuntimeError, ConnectionError) as exc:
        logger.info("WebSocket send skipped after disconnect: %s", exc)
        return False


@app.websocket("/ws/recognize")
async def recognize(websocket: WebSocket) -> None:
    await websocket.accept()
    configured = bool(os.getenv("GEMINI_API_KEY"))
    previous_translations: list[str] = []
    try:
        if not await _send_if_open(websocket, {"type": "status", "status": "ready" if configured else "error", "error": None if configured else "GEMINI_API_KEY is not configured in asl/backend/.env"}):
            return
        while True:
            message = await websocket.receive_text()
            try:
                payload = json.loads(message)
                clip = base64.b64decode(payload["clip"], validate=True)
                mime_type = payload.get("mime_type", "video/webm")
                logger.info("Clip received: %d bytes, mime_type=%s", len(clip), mime_type)
                logger.info("Gemini request started: model=%s", GEMINI_MODEL)
                gemini_task = asyncio.create_task(
                    asyncio.to_thread(_interpret_clip, clip, mime_type, previous_translations)
                )
                disconnect_task = asyncio.create_task(websocket.receive_text())
                try:
                    done, pending = await asyncio.wait(
                        {gemini_task, disconnect_task},
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                except asyncio.CancelledError:
                    gemini_task.cancel()
                    disconnect_task.cancel()
                    await asyncio.gather(gemini_task, disconnect_task, return_exceptions=True)
                    logger.info("Recognition task cancelled while Gemini request was processing")
                    raise
                if disconnect_task in done:
                    try:
                        disconnect_task.result()
                    except WebSocketDisconnect:
                        gemini_task.cancel()
                        with contextlib.suppress(asyncio.CancelledError):
                            await gemini_task
                        logger.info("Client disconnected while Gemini request was processing")
                        return
                disconnect_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await disconnect_task
                translation = gemini_task.result()
                logger.info("Gemini request completed")
                if not translation:
                    logger.info("Gemini translation result: EMPTY")
                    response_text = ""
                elif _uncertain_result(translation):
                    logger.info("Gemini translation result: UNCERTAIN")
                    response_text = "UNCERTAIN"
                else:
                    logger.info("Gemini translation result: %s", translation)
                    response_text = translation
                if response_text and response_text != "UNCERTAIN":
                    previous_translations.append(response_text)
                    del previous_translations[:-5]
                if not await _send_if_open(websocket, {"type": "translation", "text": response_text}):
                    logger.info("Response not sent: WebSocket unavailable")
                    return
                logger.info("Response sent")
            except (KeyError, ValueError, json.JSONDecodeError, RuntimeError) as exc:
                if not await _send_if_open(websocket, {"type": "error", "error": str(exc)}):
                    return
            except Exception as exc:
                logger.exception("Gemini/API error while interpreting clip")
                if not await _send_if_open(websocket, {"type": "error", "error": f"Gemini interpretation failed: {exc}"}):
                    return
    except WebSocketDisconnect:
        logger.info("Client disconnected")
        return
    except asyncio.CancelledError:
        logger.info("Recognition task cancelled after client disconnect or server shutdown")
        raise
