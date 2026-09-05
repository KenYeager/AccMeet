import logging
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.gemini_vision_service import recognize_asl_from_frame

logger = logging.getLogger(__name__)

router = APIRouter()


class AslFrameRequest(BaseModel):
    image_base64: str


class AslFrameResponse(BaseModel):
    text: Optional[str] = None
    raw: Optional[str] = None


@router.post("/frame", response_model=AslFrameResponse)
async def analyze_asl_frame(req: AslFrameRequest):
    if not req.image_base64:
        return AslFrameResponse(text=None, raw=None)

    recognized = recognize_asl_from_frame(req.image_base64)
    return AslFrameResponse(text=recognized, raw=recognized)
