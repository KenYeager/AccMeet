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
