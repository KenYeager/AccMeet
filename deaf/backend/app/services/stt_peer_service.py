"""
Server-side WebRTC audio ingestion for live captioning.

Each participant's browser opens a dedicated RTCPeerConnection to this
backend (separate from the browser-to-browser mesh used for the actual
call) carrying only their own mic audio. Incoming frames are resampled to
16-bit/16kHz/mono, buffered into fixed 3-second chunks, transcribed via the
existing stt_service.transcribe_wav_bytes, and broadcast to the room as
"caption" messages — replacing the old browser-side SpeechRecognition path.
"""
import asyncio
import io
import os
import time
import wave
from typing import Optional

import av
from aiortc import RTCPeerConnection, RTCSessionDescription

from .asl_service import caption_to_asl
from .signaling_service import room_manager
from .stt_service import transcribe_wav_bytes

CHUNK_SECONDS = 3.0
TARGET_SAMPLE_RATE = 16000

# Temporary diagnostic: dump every chunk's WAV + peak/RMS amplitude so we can
# tell whether "no speech detected" is an audio-quality problem (silence/
# clipping/garbling from the browser->aiortc->resample pipeline) or just the
# free recognizer failing on legitimately fine audio. Remove once resolved.
_DEBUG_DIR = "/tmp/deaf_stt_debug"
_DEBUG_DUMP = os.environ.get("STT_DEBUG_DUMP", "1") == "1"
if _DEBUG_DUMP:
    os.makedirs(_DEBUG_DIR, exist_ok=True)

_connections: dict[tuple[str, str], "SttPeerConnection"] = {}


class SttPeerConnection:
    def __init__(self, meeting_code: str, user_id: str, user_name: str):
        self.meeting_code = meeting_code
        self.user_id = user_id
        self.user_name = user_name
        self.pc = RTCPeerConnection()
        # One resampler per connection — handles Opus-decoded audio (whatever
        # format/rate aiortc hands back) down to exactly what
        # transcribe_wav_bytes expects. Skipping this is the most likely way
        # to get silently garbled audio (see deaf refactor plan, Risks §1).
        self.resampler = av.AudioResampler(format="s16", layout="mono", rate=TARGET_SAMPLE_RATE)
        self.pcm_buffer = bytearray()
        self.chunk_start = time.monotonic()
        self._recv_task: Optional[asyncio.Task] = None

    def start_receiving(self, track) -> None:
        self._recv_task = asyncio.create_task(self._recv_loop(track))

    async def _recv_loop(self, track) -> None:
        try:
            while True:
                frame = await track.recv()
                resampled = self.resampler.resample(frame)
                # PyAV's resample() can return a single frame or a list
                # depending on version/buffering — normalize to a list.
                frames = resampled if isinstance(resampled, list) else [resampled]
                for f in frames:
                    if f is None:
                        continue
                    self.pcm_buffer.extend(f.to_ndarray().tobytes())

                if self.pcm_buffer and time.monotonic() - self.chunk_start >= CHUNK_SECONDS:
                    chunk = bytes(self.pcm_buffer)
                    self.pcm_buffer.clear()
                    self.chunk_start = time.monotonic()
                    asyncio.create_task(self._transcribe_chunk(chunk))
        except Exception:
            # Track ended (peer muted/closed tab) or connection torn down —
            # nothing to do, the outer close() handles cleanup.
            pass

    async def _transcribe_chunk(self, pcm_bytes: bytes) -> None:
        wav_bytes = _wrap_wav(pcm_bytes)

        if _DEBUG_DUMP:
            import struct
            samples = struct.unpack(f"<{len(pcm_bytes) // 2}h", pcm_bytes)
            peak = max(abs(s) for s in samples) if samples else 0
            rms = (sum(s * s for s in samples) / len(samples)) ** 0.5 if samples else 0
            stamp = time.strftime("%H%M%S")
            fname = f"{_DEBUG_DIR}/{self.user_name}_{stamp}_{int(time.monotonic()*1000)%100000}.wav"
            with open(fname, "wb") as f:
                f.write(wav_bytes)
            print(f"[STT DEBUG] dumped {fname} peak={peak} rms={rms:.0f} (16-bit max=32767)")

        loop = asyncio.get_running_loop()
        # transcribe_wav_bytes makes a blocking network call (Google Web
        # Speech API) — run off the event loop so it doesn't stall audio
        # reception for every other participant in the room.
        text = await loop.run_in_executor(None, transcribe_wav_bytes, wav_bytes, self.user_name)
        if text:
            # spaCy's parse is also blocking CPU work — off the event loop,
            # same reason as transcribe_wav_bytes above.
            asl = await loop.run_in_executor(None, caption_to_asl, text)
            # NOTE: no exclude_user_id — the server is now the sole source of
            # every caption, including the speaker's own. This differs from
            # the WS router's peer-to-peer caption relay (which excludes the
            # sender, since a browser-generated caption is already local to
            # them) — do not "fix" this to match, it would silence self-captions.
            await room_manager.broadcast(self.meeting_code, {
                "type": "caption",
                "from_user_id": self.user_id,
                "from_user_name": self.user_name,
                "payload": {
                    "text": text,
                    "is_final": True,
                    "asl_tokens": asl["tokens"],
                    "asl_gifs": asl["gifs"],
                },
            })

    async def close(self) -> None:
        if self._recv_task:
            self._recv_task.cancel()
        await self.pc.close()


def _wrap_wav(pcm_bytes: bytes) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(TARGET_SAMPLE_RATE)
        wav_file.writeframes(pcm_bytes)
    return buf.getvalue()


async def handle_offer(meeting_code: str, user_id: str, user_name: str, offer_payload: dict) -> dict:
    key = (meeting_code, user_id)

    # Reconnect (e.g. restartCaptions, or a dropped connection): tear down
    # any stale peer connection first rather than leaking it.
    existing = _connections.pop(key, None)
    if existing:
        await existing.close()

    conn = SttPeerConnection(meeting_code, user_id, user_name)

    @conn.pc.on("track")
    def on_track(track):
        if track.kind == "audio":
            conn.start_receiving(track)

    await conn.pc.setRemoteDescription(
        RTCSessionDescription(sdp=offer_payload["sdp"], type=offer_payload["type"])
    )
    answer = await conn.pc.createAnswer()
    await conn.pc.setLocalDescription(answer)

    _connections[key] = conn

    return {"sdp": conn.pc.localDescription.sdp, "type": conn.pc.localDescription.type}


async def add_ice_candidate(meeting_code: str, user_id: str, payload: dict) -> None:
    # Reserved for trickle ICE. Not wired up for v1 — aiortc's non-trickle
    # answer already carries locally-gathered candidates for the same-host/
    # LAN case this is designed for. If audio never flows despite a
    # successful offer/answer handshake, this is the first thing to build.
    pass


async def close(meeting_code: str, user_id: str) -> None:
    key = (meeting_code, user_id)
    conn = _connections.pop(key, None)
    if conn:
        await conn.close()
