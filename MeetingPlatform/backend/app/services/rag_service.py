import httpx

from ..config import get_settings

_client: httpx.AsyncClient | None = None


class RagServiceUnavailableError(Exception):
    """The rag service could not be reached at all."""


class RagServiceTimeoutError(Exception):
    """The rag service accepted the connection but didn't respond in time."""


class RagServiceError(Exception):
    """The rag service responded with an error status."""

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


async def connect_rag_client() -> None:
    global _client
    _client = httpx.AsyncClient(base_url=get_settings().rag_service_url)


async def close_rag_client() -> None:
    global _client
    if _client:
        await _client.aclose()
        _client = None


def _get_client() -> httpx.AsyncClient:
    if _client is None:
        raise RuntimeError("RAG HTTP client not connected. Call connect_rag_client() first.")
    return _client


def _extract_detail(response: httpx.Response) -> str:
    try:
        return response.json().get("detail", response.text)
    except Exception:
        return response.text


async def ingest_lore(items: list[dict]) -> dict:
    """items: [{text, category?, entity_name?}] — forwards to rag's POST /api/rag/ingest."""
    client = _get_client()
    try:
        response = await client.post(
            "/api/rag/ingest", json={"items": items}, timeout=httpx.Timeout(5.0)
        )
    except httpx.ConnectError as e:
        raise RagServiceUnavailableError() from e
    except httpx.TimeoutException as e:
        raise RagServiceTimeoutError() from e

    if response.status_code >= 400:
        raise RagServiceError(response.status_code, _extract_detail(response))
    return response.json()


async def orchestrate(payload: dict) -> dict:
    """Forwards to rag's POST /api/agent/orchestrate — the single automatic
    LangGraph entry point replacing the old manual ingest/retrieve toggles.
    Can take a few seconds (up to 2 LLM turns plus 1-3 tool executions)."""
    client = _get_client()
    try:
        response = await client.post(
            "/api/agent/orchestrate",
            json=payload,
            timeout=httpx.Timeout(connect=5.0, read=15.0, write=5.0, pool=5.0),
        )
    except httpx.ConnectError as e:
        raise RagServiceUnavailableError() from e
    except httpx.TimeoutException as e:
        raise RagServiceTimeoutError() from e

    if response.status_code >= 400:
        raise RagServiceError(response.status_code, _extract_detail(response))
    return response.json()


async def send_conversation_chunk(
    patient_id: str, other_id: str, other_name: str, meeting_code: str, text: str,
    patient_name: str | None = None,
) -> dict:
    """Forwards a ~30s dialogue chunk to rag's POST /api/conversation/chunk."""
    client = _get_client()
    try:
        response = await client.post(
            "/api/conversation/chunk",
            json={
                "patient_id": patient_id,
                "patient_name": patient_name,
                "other_id": other_id,
                "other_name": other_name,
                "meeting_code": meeting_code,
                "text": text,
            },
            timeout=httpx.Timeout(10.0),
        )
    except httpx.ConnectError as e:
        raise RagServiceUnavailableError() from e
    except httpx.TimeoutException as e:
        raise RagServiceTimeoutError() from e

    if response.status_code >= 400:
        raise RagServiceError(response.status_code, _extract_detail(response))
    return response.json()


async def finalize_conversation(patient_id: str, other_id: str, other_name: str, meeting_code: str) -> dict:
    """Forwards to rag's POST /api/conversation/finalize — called on leaving the call."""
    client = _get_client()
    try:
        response = await client.post(
            "/api/conversation/finalize",
            json={
                "patient_id": patient_id,
                "other_id": other_id,
                "other_name": other_name,
                "meeting_code": meeting_code,
            },
            timeout=httpx.Timeout(5.0),
        )
    except httpx.ConnectError as e:
        raise RagServiceUnavailableError() from e
    except httpx.TimeoutException as e:
        raise RagServiceTimeoutError() from e

    if response.status_code >= 400:
        raise RagServiceError(response.status_code, _extract_detail(response))
    return response.json()


async def get_conversation_history(patient_id: str, other_id: str, other_name: str) -> dict:
    """Forwards to rag's GET /api/conversation/history."""
    client = _get_client()
    try:
        response = await client.get(
            "/api/conversation/history",
            params={"patient_id": patient_id, "other_id": other_id, "other_name": other_name},
            timeout=httpx.Timeout(10.0),
        )
    except httpx.ConnectError as e:
        raise RagServiceUnavailableError() from e
    except httpx.TimeoutException as e:
        raise RagServiceTimeoutError() from e

    if response.status_code >= 400:
        raise RagServiceError(response.status_code, _extract_detail(response))
    return response.json()


async def get_insights_report(patient_id: str, other_id: str, other_name: str) -> dict:
    """Forwards to rag's GET /api/insights/report. Longer read timeout than the
    other GETs: building the report includes one Gemini call to narrate it."""
    client = _get_client()
    try:
        response = await client.get(
            "/api/insights/report",
            params={"patient_id": patient_id, "other_id": other_id, "other_name": other_name},
            timeout=httpx.Timeout(connect=5.0, read=20.0, write=5.0, pool=5.0),
        )
    except httpx.ConnectError as e:
        raise RagServiceUnavailableError() from e
    except httpx.TimeoutException as e:
        raise RagServiceTimeoutError() from e

    if response.status_code >= 400:
        raise RagServiceError(response.status_code, _extract_detail(response))
    return response.json()


async def get_insights_contacts(other_id: str) -> dict:
    """Forwards to rag's GET /api/insights/contacts."""
    client = _get_client()
    try:
        response = await client.get(
            "/api/insights/contacts", params={"other_id": other_id},
            timeout=httpx.Timeout(10.0),
        )
    except httpx.ConnectError as e:
        raise RagServiceUnavailableError() from e
    except httpx.TimeoutException as e:
        raise RagServiceTimeoutError() from e

    if response.status_code >= 400:
        raise RagServiceError(response.status_code, _extract_detail(response))
    return response.json()


async def query_chunk(chunk: str) -> dict:
    """Forwards to rag's POST /api/agent/process-chunk — can take up to ~7s (two
    sequential Gemini calls) when the agent decides to look something up."""
    client = _get_client()
    try:
        response = await client.post(
            "/api/agent/process-chunk",
            json={"chunk": chunk},
            timeout=httpx.Timeout(connect=5.0, read=15.0, write=5.0, pool=5.0),
        )
    except httpx.ConnectError as e:
        raise RagServiceUnavailableError() from e
    except httpx.TimeoutException as e:
        raise RagServiceTimeoutError() from e

    if response.status_code >= 400:
        raise RagServiceError(response.status_code, _extract_detail(response))
    return response.json()
