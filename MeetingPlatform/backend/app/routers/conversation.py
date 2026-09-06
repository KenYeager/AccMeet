from typing import Coroutine, Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from ..services import rag_service
from ..services.rag_service import RagServiceError, RagServiceTimeoutError, RagServiceUnavailableError

router = APIRouter()


class ConversationChunkRequest(BaseModel):
    patient_id: str
    patient_name: str | None = None
    other_id: str
    other_name: str
    meeting_code: str
    text: str


class ConversationFinalizeRequest(BaseModel):
    patient_id: str
    other_id: str
    other_name: str
    meeting_code: str


async def _call(coro: Coroutine[Any, Any, dict]) -> dict:
    """Same transport-error translation as routers/rag.py's _call."""
    try:
        return await coro
    except RagServiceUnavailableError:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="RAG service is unreachable")
    except RagServiceTimeoutError:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="RAG service timed out")
    except RagServiceError as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=e.detail)


@router.post("/chunk")
async def chunk(body: ConversationChunkRequest) -> dict:
    return await _call(rag_service.send_conversation_chunk(
        body.patient_id, body.other_id, body.other_name, body.meeting_code, body.text,
        body.patient_name,
    ))


@router.post("/finalize")
async def finalize(body: ConversationFinalizeRequest) -> dict:
    return await _call(rag_service.finalize_conversation(
        body.patient_id, body.other_id, body.other_name, body.meeting_code
    ))


@router.get("/history")
async def history(patient_id: str, other_id: str, other_name: str) -> dict:
    return await _call(rag_service.get_conversation_history(patient_id, other_id, other_name))


@router.get("/insights")
async def insights(patient_id: str, other_id: str, other_name: str) -> dict:
    """Caregiver-only speech report. Not gated here — the app has no auth at
    all — but the frontend only surfaces it on a non-patient device."""
    return await _call(rag_service.get_insights_report(patient_id, other_id, other_name))


@router.get("/insights/contacts")
async def insights_contacts(other_id: str) -> dict:
    return await _call(rag_service.get_insights_contacts(other_id))
