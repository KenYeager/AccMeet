import base64
import logging
import os
from typing import Optional

from ..config import get_settings

logger = logging.getLogger(__name__)

_genai_initialized = False


def _get_api_key() -> str:
    settings = get_settings()
    return settings.gemini_api_key or os.getenv("GEMINI_API_KEY", "")


def recognize_asl_from_frame(image_base64: str) -> Optional[str]:
    """
    Sends a JPEG frame to Gemini 1.5 Flash Vision to recognize the ASL sign.
    Returns the recognized word/phrase (e.g. 'HELLO') or None if no clear sign is detected.
    """
    api_key = _get_api_key()
    if not api_key:
        logger.warning("[GeminiVision] GEMINI_API_KEY not configured. Sign recognition skipped.")
        return None

    try:
        import google.generativeai as genai

        global _genai_initialized
        if not _genai_initialized:
            genai.configure(api_key=api_key)
            _genai_initialized = True

        # Strip data URL prefix if present
        if "," in image_base64:
            _, image_base64 = image_base64.split(",", 1)

        image_bytes = base64.b64decode(image_base64)

        model = genai.GenerativeModel("gemini-1.5-flash")
        prompt = (
            "You are an expert American Sign Language (ASL) interpreter. "
            "Look at this image of a person signing and identify the ASL sign (or fingerspelled letter / common gesture) being performed. "
            "Reply with ONLY the English word or short phrase (in UPPERCASE, e.g. 'HELLO', 'THANK YOU', 'I LOVE YOU', 'YES', 'NO', 'GOOD', 'HELP', etc.). "
            "If no clear sign or deliberate handshape is visible, or the hands are resting/relaxed, reply with ONLY 'UNKNOWN'. "
            "Do NOT include explanations or punctuation."
        )

        response = model.generate_content([
            prompt,
            {"mime_type": "image/jpeg", "data": image_bytes},
        ])

        if not response or not response.text:
            return None

        result = response.text.strip().strip('"').strip("'").upper()
        if "UNKNOWN" in result or not result:
            return None

        # Return clean recognized token
        return result
    except Exception as e:
        logger.error(f"[GeminiVision] Error recognizing ASL frame: {e}")
        return None
