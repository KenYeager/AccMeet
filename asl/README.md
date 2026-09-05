# Standalone Gemini ASL Translator

This standalone module uses short webcam video clips and Gemini multimodal understanding to attempt ASL-to-English interpretation. It is independent from `cal/`, `deaf/`, `MeetingPlatform/`, and `rag/`.

## Architecture

```text
Next.js webcam -> 3-second WebM clip -> FastAPI WebSocket
              -> Gemini Flash video understanding -> English subtitle
```

The frontend never sends individual frames to Gemini. It records one approximately 3-second clip, sends it to FastAPI, waits for the interpretation, then records the next clip. Video is held in memory and is not written to disk by this module.

## Gemini model

The implementation uses the official `google-genai` Python SDK. Google’s current model documentation lists `gemini-3.8-flash` as a stable Flash model with video understanding support, so that is the default. Set `GEMINI_MODEL` in `backend/.env` if your account exposes a different current Flash model.

Gemini receives WebM video inline because these short clips are intended to remain well below the API’s small-video inline request limit. Supported video MIME types include WebM.

This is a multimodal interpretation prototype, not a guaranteed ASL translator. Gemini may recognize common signs or short phrases such as `HELLO` and produce natural English, but accuracy depends on signing style, framing, lighting, clip timing, and model behavior. It may miss ASL grammar, facial expression, spatial grammar, fingerspelling, or rapid motion. Do not treat the output as medical or accessibility-critical transcription without human review.

## Configure Gemini

Copy `backend/.env.example` to `backend/.env` and add a Gemini API key:

```dotenv
GEMINI_API_KEY=your_real_key_here
GEMINI_MODEL=gemini-3.8-flash
```

The key stays server-side. It is loaded by FastAPI and is never sent to the browser. `backend/.env` is ignored by the ASL-specific `.gitignore`.

## Windows setup

Terminal 1:

```powershell
cd AccMeet\asl\backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
# Edit .env and set GEMINI_API_KEY
python -m uvicorn main:app --reload --port 8010
```

Check readiness:

```powershell
Invoke-RestMethod http://127.0.0.1:8010/health
```

Terminal 2:

```powershell
cd AccMeet\asl\frontend
npm install
npm run dev
```

Open http://localhost:3000, allow webcam access, and select **Start recognition**.

## Realtime clip flow

1. The browser requests the webcam with `getUserMedia()`.
2. The live preview is shown locally.
3. `MediaRecorder` captures a WebM clip for about 3 seconds.
4. The clip is base64 encoded and sent over `ws://127.0.0.1:8010/ws/recognize`.
5. FastAPI decodes the clip in memory and calls Gemini once for that clip.
6. The English result is sent back as a subtitle.
7. The next clip begins after the previous clip is submitted.

This intentionally trades frame-level latency for a meaningful temporal window and avoids expensive per-frame API calls.

## API contract

- `GET /health` reports whether `GEMINI_API_KEY` is configured and which model is selected.
- `WS /ws/recognize` accepts:

```json
{"clip":"base64-webm-data","mime_type":"video/webm"}
```

- The server returns `translation`, `status`, or `error` messages. Translation responses contain `text` and `model`.

The backend URL is configurable through `NEXT_PUBLIC_ASL_BACKEND_URL`; the local fallback is `http://127.0.0.1:8010`.

## Future integration

The meeting platform can later consume the same WebSocket translation messages or call the ASL backend as a separate service. This module does not import or depend on any other AccMeet module.
