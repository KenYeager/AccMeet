"""
Per-dyad conversation memory for the "context bubble" / "history bubble"
feature — deliberately NOT a database. Every 30 seconds during a call, the
frontend sends a chunk of dialogue for one (patient, other-person) pair;
Gemini turns it into a short "current context" phrase plus a one-line
summary. When the call ends, the accumulated lines for that pair are
condensed into a short paragraph and appended to a plain .txt file scoped to
that exact pair — so history for (patient, Priya) lives in a completely
different file than (patient, Raj), which is what keeps their conversations
from ever mixing. No filter query to get wrong; the filesystem does the
scoping.
"""
import logging
import os
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from langchain_core.messages import HumanMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from pydantic import BaseModel, Field

logger = logging.getLogger("conversation_memory")

DATA_DIR = Path(__file__).resolve().parent / "data" / "conversation_history"
TIMEZONE = os.getenv("SCHEDULING_TIMEZONE", "Asia/Kolkata")

llm = ChatGoogleGenerativeAI(
    model="gemini-3.5-flash-lite",
    temperature=0,
    google_api_key=os.getenv("GOOGLE_API_KEY"),
)


class ChunkSummary(BaseModel):
    current_context: str = Field(
        description="One short sentence, under 12 words, describing what is being "
        "discussed right now — written plainly, for a memory-care patient to read at a glance."
    )
    summary_line: str = Field(
        description="One sentence summarizing this snippet of conversation, for a running log."
    )


# Structured-output binding is stateless/reusable — build it once, not per call.
_chunk_llm = llm.with_structured_output(ChunkSummary)

# In-memory running summary for the CURRENT call only, keyed by the triple
# that identifies one dyad's one call. Cleared by finalize_session().
_sessions: dict[tuple[str, str, str], list[str]] = {}

_HEADER_RE = re.compile(r"=== Call with (.+?) on (.+?) ===")


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "unknown"


def _dyad_file_path(patient_id: str, other_id: str, other_name: str) -> Path:
    patient_dir = DATA_DIR / _slugify(patient_id)
    patient_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{_slugify(other_name)}_{other_id[:6]}.txt"
    return patient_dir / filename


async def summarize_chunk(
    patient_id: str, other_id: str, other_name: str, meeting_code: str, text: str
) -> ChunkSummary:
    key = (patient_id, other_id, meeting_code)
    prompt = (
        "This is a ~30-second snippet of transcript from an ongoing live video call "
        "between a memory-care patient and a family member or friend. Each line is "
        "prefixed with who said it.\n\n"
        f"Transcript snippet:\n{text}"
    )
    try:
        result: ChunkSummary = await _chunk_llm.ainvoke([HumanMessage(content=prompt)])
    except Exception:
        logger.exception("chunk summarization failed for %s", key)
        result = ChunkSummary(current_context="Conversation in progress…", summary_line=text[:200])

    _sessions.setdefault(key, []).append(result.summary_line)
    return result


def get_session_summary(patient_id: str, other_id: str, meeting_code: str) -> str:
    return " ".join(_sessions.get((patient_id, other_id, meeting_code), []))


async def finalize_session(patient_id: str, other_id: str, other_name: str, meeting_code: str) -> None:
    key = (patient_id, other_id, meeting_code)
    lines = _sessions.pop(key, [])
    if not lines:
        return

    joined = " ".join(lines)
    try:
        response = await llm.ainvoke([
            HumanMessage(content=(
                "Condense these notes from one video call into a short, warm, one-paragraph "
                "summary (2-3 sentences) suitable for a memory-care patient's family to read "
                "back later:\n\n" + joined
            ))
        ])
        paragraph = response.content if isinstance(response.content, str) else joined
    except Exception:
        logger.exception("finalize summarization failed for %s", key)
        paragraph = joined

    now = datetime.now(ZoneInfo(TIMEZONE))
    header = f"=== Call with {other_name} on {now.strftime('%Y-%m-%d %H:%M %Z')} ==="
    block = f"\n{header}\n{paragraph.strip()}\n"

    path = _dyad_file_path(patient_id, other_id, other_name)
    with open(path, "a", encoding="utf-8") as f:
        f.write(block)


def read_history(patient_id: str, other_id: str, other_name: str) -> list[dict]:
    path = _dyad_file_path(patient_id, other_id, other_name)
    if not path.exists():
        return []

    content = path.read_text(encoding="utf-8")
    matches = list(_HEADER_RE.finditer(content))
    entries = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(content)
        entries.append({
            "other_name": m.group(1),
            "timestamp": m.group(2),
            "summary": content[start:end].strip(),
        })
    entries.reverse()  # newest call first, for the popup
    return entries
