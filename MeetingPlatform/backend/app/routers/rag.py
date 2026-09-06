from typing import Coroutine, Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from ..services import rag_service
from ..services.rag_service import RagServiceError, RagServiceTimeoutError, RagServiceUnavailableError

router = APIRouter()


class RagIngestItem(BaseModel):
    text: str
    category: str | None = None
    entity_name: str | None = None


class RagIngestRequest(BaseModel):
    items: list[RagIngestItem]


class RagQueryRequest(BaseModel):
    chunk: str


class OrchestrateRequest(BaseModel):
    text: str
    is_patient: bool = False
    # Which call this chunk belongs to — lets rag's log_speech_observation tool
    # attach observations to the right call record. Absent for non-patients.
    patient_id: str | None = None
    other_id: str | None = None
    other_name: str | None = None
    meeting_code: str | None = None


async def _call(coro: Coroutine[Any, Any, dict]) -> dict:
    """Translates rag_service's transport-level exceptions into HTTP responses
    the frontend can distinguish: 503 down, 504 slow, 502 upstream error."""
    try:
        return await coro
    except RagServiceUnavailableError:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="RAG service is unreachable")
    except RagServiceTimeoutError:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="RAG service timed out")
    except RagServiceError as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=e.detail)


@router.post("/ingest")
async def ingest(body: RagIngestRequest) -> dict:
    items = [item.model_dump(exclude_none=True) for item in body.items]
    return await _call(rag_service.ingest_lore(items))


@router.post("/query")
async def query(body: RagQueryRequest) -> dict:
    return await _call(rag_service.query_chunk(body.chunk))


@router.post("/orchestrate")
async def orchestrate(body: OrchestrateRequest) -> dict:
    return await _call(rag_service.orchestrate(body.model_dump()))
