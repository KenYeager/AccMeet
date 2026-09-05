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

The same per-chunk call also watches for the patient repeating a question or
fact — comparing against both this call's running lines and past calls'
persisted summaries (read straight from the same .txt file, no separate
vector index) — and if so produces caregiver-facing coaching on how to
respond without causing stress. See ChunkSummary's patient_repeated/
repeated_topic/caregiver_suggestion fields.
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
    patient_repeated: bool = Field(
        default=False,
        description="True ONLY if the PATIENT is asking or stating something whose substance "
        "was already covered earlier this call or in a past call — not a natural follow-up "
        "question building on what was just said.",
    )
    repeated_topic: str = Field(
        default="", description="Brief description of what's being repeated, e.g. "
        "'asking who Priya is'. Empty if patient_repeated is false."
    )
    caregiver_suggestion: str = Field(
        default="", description="Coaching for the OTHER person on HOW to respond right now, "
        "in a way that avoids stressing or embarrassing the patient — tone (calm, warm, "
        "unhurried), technique (validate the feeling first, keep the factual part short, "
        "redirect if needed), and a ready-to-use example phrase they could say. Never suggest "
        "correcting, quizzing, or pointing out that this was already asked. Empty if "
        "patient_repeated is false."
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

    session_lines = _sessions.get(key, [])
    session_text = (
        "\n".join(f"- {line}" for line in session_lines)
        if session_lines else "(nothing yet — this is the first chunk of the call)"
    )

    past_entries = read_history(patient_id, other_id, other_name)[:5]
    past_calls_text = (
        "\n".join(f"- ({entry['timestamp']}) {entry['summary']}" for entry in past_entries)
        if past_entries else "(no past calls with this person on record)"
    )

    prompt = (
        "This is a ~30-second snippet of transcript from an ongoing live video call "
        "between a memory-care patient and a family member or friend. Each line is "
        "prefixed with who said it — lines prefixed \"Patient:\" are the patient's own "
        "words.\n\n"
        "You are writing directly TO the patient, for the patient to read. Always address "
        "the patient as \"you\" — never write \"the patient\" or \"Patient\" in your output. "
        f"Refer to the other person by their name, {other_name}. For example, write "
        f"\"{other_name} mentioned he had lunch with Priya\" or \"You asked {other_name} how "
        "Priya was doing\", not \"the patient asked how she was doing\".\n\n"
        f"What's been said so far earlier THIS call:\n{session_text}\n\n"
        f"Summaries of PAST calls with {other_name}:\n{past_calls_text}\n\n"
        "Separately, check whether the patient is repeating something — decide "
        "`patient_repeated` by comparing this chunk's \"Patient:\" lines against both the "
        "earlier-this-call list and the past-calls summaries above. Only flag it when the "
        "patient is asking/stating something whose substance was already covered — NOT when "
        "it's a natural follow-up building on what was just said (e.g. asking \"how is she "
        "doing\" right after first mentioning someone is NOT a repeat; asking \"who is Priya?\" "
        "again after already being told, minutes or days ago, IS a repeat).\n\n"
        "If it IS a repeat, write `caregiver_suggestion` as coaching for the OTHER person on "
        "HOW to respond right now without stressing or embarrassing the patient — cover tone "
        "(calm, warm, unhurried), technique (validate the feeling first, keep the factual part "
        "short, redirect if it seems like they're anxious or frustrated), and end with a "
        "ready-to-use example phrase. Never suggest correcting, quizzing, or telling the "
        "patient they already asked this. For example:\n"
        "- \"Stay warm and unhurried — they're not being difficult, they may be anxious about "
        "forgetting. Validate first, then answer briefly: 'It's okay to ask again — Priya's "
        "your granddaughter, she just moved to Boston.' Avoid quizzing them or saying you "
        "already told them.\"\n"
        "- \"If they seem frustrated by not remembering, it's fine to skip the fact this time "
        "and redirect gently instead: 'That's alright, tell me what's been on your mind today' "
        "— reduces pressure more than repeating the same answer a fourth time.\"\n"
        "If nothing qualifies as a repeat, leave patient_repeated false and the other two "
        "fields empty.\n\n"
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
                "summary (2-3 sentences), written directly TO the memory-care patient for "
                "them to read back later. Address the patient as \"you\" throughout — never "
                f"write \"the patient\" or \"Patient\". Refer to the other person as {other_name}. "
                f"For example: \"You had lunch with Priya, and {other_name} reminded you she's "
                f"your granddaughter. {other_name} will call you next Tuesday at 5pm.\"\n\n"
                "Notes:\n" + joined
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
