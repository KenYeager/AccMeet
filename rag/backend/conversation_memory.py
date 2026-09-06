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
import json
import logging
import os
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from langchain_core.messages import HumanMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from pydantic import BaseModel, Field

from speech_metrics import chunk_metrics, per_hundred

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
#
# This is a cache, NOT the source of truth: every line is also appended to a
# per-call .pending file as it arrives. An in-memory-only design silently lost
# whole calls whenever the process restarted (uvicorn --reload does this on
# every code edit), the tab was closed instead of pressing Leave, or the other
# participant hung up first — in each case finalize either never ran or ran
# against an empty dict, and an hour of conversation vanished with no error.
_sessions: dict[tuple[str, str, str], list[str]] = {}

_HEADER_RE = re.compile(r"=== Call with (.+?) on (.+?) ===")

# A .pending file whose last write is older than this is treated as an
# abandoned call and finalized on the next history read. Chunks arrive every
# ~30s, so an in-progress call's file is never anywhere near this stale.
_ABANDONED_AFTER_SECONDS = 150


# --- Repeat-detection guardrail ---------------------------------------------
# gemini-3.5-flash-lite reliably applies the "is this the first mention at
# all?" check in the prompt, but does NOT reliably apply the finer "was the
# patient actually ASKING before, or just being TOLD/stating it themselves?"
# distinction — observed in practice flagging "You told John he is your
# sister's son" (a statement, immediately followed by "who is John?") as a
# repeat, when there was no prior ASK to repeat. Rather than keep tuning the
# prompt against a small model's inconsistent instruction-following, this is
# checked deterministically in code as a backstop: only trust
# patient_repeated=True if a "you asked" line about the same name/topic
# genuinely exists in the summaries already generated. summarize_chunk's own
# summary_line prompt consistently produces "You asked ..." phrasing for a
# real question (see every observed example), which is what makes this a
# reliable enough signal to gate on.
_ASK_RE = re.compile(r"\byou (asked|wondered|inquired|questioned)\b", re.IGNORECASE)
_NON_NAME_WORDS = frozenset({
    "Who", "What", "When", "Where", "Why", "How", "The", "That", "This",
    "Asking", "Patient", "You",
})


def _topic_proper_nouns(repeated_topic: str) -> set[str]:
    return set(re.findall(r"\b[A-Z][a-z]+\b", repeated_topic)) - _NON_NAME_WORDS


def _has_prior_ask(repeated_topic: str, session_lines: list[str]) -> bool:
    """True if some earlier line FROM THIS CALL both mentions a name from
    `repeated_topic` and phrases it as the patient having asked something —
    the one thing that must be real for a "repeat" to be genuine. Deliberately
    scoped to this call only — past calls are never grounds for a repeat, per
    the "limit repetition tracking to a single call" decision."""
    names = _topic_proper_nouns(repeated_topic)
    if not names:
        # No proper noun to check (e.g. a repeated topic with no name in it)
        # — nothing to verify against, so don't second-guess the model here.
        return True
    candidates = list(session_lines)
    return any(_ASK_RE.search(line) and any(name in line for name in names) for line in candidates)


def extract_text(content) -> str:
    """Gemini returns message.content as either a plain string or a list of
    content blocks. Checking only for `str` and falling back silently makes a
    successful LLM call look like a failed one, so unwrap both shapes."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            block.get("text", "") if isinstance(block, dict) else str(block)
            for block in content
            if not isinstance(block, dict) or block.get("type") == "text"
        )
    return str(content)


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "unknown"


def _dyad_file_path(patient_id: str, other_id: str, other_name: str) -> Path:
    patient_dir = DATA_DIR / _slugify(patient_id)
    patient_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{_slugify(other_name)}_{other_id[:6]}.txt"
    return patient_dir / filename


def _pending_file_path(patient_id: str, other_id: str, other_name: str, meeting_code: str) -> Path:
    """Write-ahead log for one in-progress call, sitting beside that dyad's
    history file. Survives a process restart, so a call's lines can still be
    condensed afterwards instead of being lost with the in-memory dict."""
    dyad = _dyad_file_path(patient_id, other_id, other_name)
    return dyad.with_suffix(f".{_slugify(meeting_code)}.pending")


def _append_pending(patient_id: str, other_id: str, other_name: str, meeting_code: str, line: str) -> None:
    path = _pending_file_path(patient_id, other_id, other_name, meeting_code)
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(line.replace("\n", " ").strip() + "\n")
    except Exception:
        # Never let the write-ahead log break the live call — the in-memory
        # copy is still good enough for this process's lifetime.
        logger.exception("could not append pending line for %s", path)


def _read_pending(path: Path) -> list[str]:
    if not path.exists():
        return []
    return [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


# ---------------------------------------------------------------------------
# Speech-metric accumulation (see speech_metrics.py and report.py)
# ---------------------------------------------------------------------------

def _metrics_wip_path(patient_id: str, other_id: str, other_name: str, meeting_code: str) -> Path:
    """Running totals for one in-progress call. Mirrors the .pending write-ahead
    log for exactly the same reason: an in-memory-only accumulator loses the
    whole call on restart."""
    dyad = _dyad_file_path(patient_id, other_id, other_name)
    return dyad.with_suffix(f".{_slugify(meeting_code)}.metrics.json")


def metrics_log_path(patient_id: str, other_id: str, other_name: str) -> Path:
    """Append-only per-dyad log, one JSON object per completed call."""
    dyad = _dyad_file_path(patient_id, other_id, other_name)
    return dyad.with_suffix(".metrics.jsonl")


def _empty_totals() -> dict:
    return {
        "chunks": 0, "token_count": 0, "utterance_count": 0,
        "pronoun_count": 0, "filler_count": 0,
        "mattr_sum": 0.0, "mattr_n": 0,
        "repetition_count": 0, "observations": [], "patient_name": None,
    }


def _load_totals(path: Path) -> dict:
    if not path.exists():
        return _empty_totals()
    try:
        return {**_empty_totals(), **json.loads(path.read_text(encoding="utf-8"))}
    except Exception:
        logger.exception("unreadable metrics file %s — starting fresh", path)
        return _empty_totals()


def _accumulate_metrics(
    patient_id: str, other_id: str, other_name: str, meeting_code: str,
    chunk: dict, repeated: bool, patient_name: str | None = None,
) -> None:
    """Fold one chunk's counts into the running call totals.

    Counts are summed and divided ONCE at finalize; averaging per-chunk rates
    instead would weight a 10-word chunk the same as a 200-word one. MATTR is
    the exception — it's already length-normalised, so it's averaged across
    chunks, which also avoids retaining the token sequence (that would amount
    to storing the conversation).
    """
    path = _metrics_wip_path(patient_id, other_id, other_name, meeting_code)
    totals = _load_totals(path)

    if patient_name:
        totals["patient_name"] = patient_name
    totals["chunks"] += 1
    for field in ("token_count", "utterance_count", "pronoun_count", "filler_count"):
        totals[field] += chunk[field]
    if chunk["mattr"] is not None:
        totals["mattr_sum"] += chunk["mattr"]
        totals["mattr_n"] += 1
    if repeated:
        totals["repetition_count"] += 1

    try:
        path.write_text(json.dumps(totals), encoding="utf-8")
    except Exception:
        logger.exception("could not persist running metrics to %s", path)


def record_observation(patient_id: str, other_id: str, other_name: str, meeting_code: str, note: str) -> None:
    """Attach a qualitative note to the in-progress call. Called by the
    log_speech_observation LangGraph tool (see tools.py)."""
    path = _metrics_wip_path(patient_id, other_id, other_name, meeting_code)
    totals = _load_totals(path)
    totals["observations"].append(note)
    try:
        path.write_text(json.dumps(totals), encoding="utf-8")
    except Exception:
        logger.exception("could not persist observation to %s", path)


async def summarize_chunk(
    patient_id: str, other_id: str, other_name: str, meeting_code: str, text: str,
    patient_name: str | None = None,
) -> ChunkSummary:
    key = (patient_id, other_id, meeting_code)

    session_lines = _sessions.get(key, [])
    session_text = (
        "\n".join(f"- {line}" for line in session_lines)
        if session_lines else "(nothing yet — this is the first chunk of the call)"
    )

    # Used ONLY as fact-grounding for caregiver_suggestion below (so a real,
    # previously-established answer like "John is your nephew" can be reused
    # instead of fabricated) — deliberately NOT passed to the repeat-detection
    # rule or _has_prior_ask, which stay scoped to this call only.
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
        "Separately, check whether the patient is repeating something — decide "
        "`patient_repeated` by comparing this chunk's \"Patient:\" lines against the "
        "earlier-this-call list above ONLY. Never treat anything from a previous, separate "
        "call as grounds for a repeat — only what has already happened in THIS call counts.\n\n"
        "HARD RULE — what actually counts as a repeat. This is a mechanical check, not a "
        "judgment call: patient_repeated may ONLY be true if you can point to a SPECIFIC "
        "EARLIER LINE in the earlier-this-call list that ITSELF describes the PATIENT ASKING "
        "(not stating, not being told in passing) for this same specific answer — a line of "
        "the shape \"You asked ... who/what/when/where ...\" or "
        f"\"... and {other_name} told/reminded you ...\" in response to the patient's own earlier "
        "question. If no such prior ASK-and-ANSWER line exists EARLIER IN THIS CALL, "
        "patient_repeated is false — full stop, regardless of whether the name/topic appears "
        f"in any OTHER earlier line (the patient mentioning a name themselves, or {other_name} "
        "bringing it up unprompted, does NOT count — only a line where the PATIENT previously "
        "asked this, in this same call, counts).\n"
        f"Example that IS a repeat: an earlier-this-call line reads \"You asked {other_name} "
        "who Priya is, and he said she's your granddaughter\" — that is a prior instance of "
        "the PATIENT asking this exact thing, so asking \"who is Priya again?\" now qualifies.\n"
        "Example that is NOT a repeat: nothing above shows the patient ever asking about "
        "\"Maya\" before, in this call (whether or not the name appears elsewhere, or was "
        "asked about in some earlier call) — leave patient_repeated false, since there is no "
        "prior ASK to repeat in this call.\n"
        f"Example that is NOT a repeat: an earlier-this-call line reads \"You told {other_name} "
        f"he is your sister's son\" (the PATIENT stated this, {other_name} didn't tell the "
        "patient), and the patient then asks who he is — there is no prior line of the patient "
        "asking this, only a statement, so this does not qualify.\n\n"
        f"If it IS a repeat, write `caregiver_suggestion` as coaching for {other_name} on HOW to "
        "respond right now without stressing or embarrassing the patient — cover tone (calm, "
        "warm, unhurried), technique (validate the feeling first, keep the factual part short, "
        "redirect if it seems like they're anxious or frustrated), and end with a ready-to-use "
        f"example phrase THAT {other_name} CAN SAY OUT LOUD. Never suggest correcting, quizzing, "
        "or telling the patient they already asked this.\n\n"
        "HARD RULE — voice and perspective of the example phrase: it must be written in "
        f"{other_name}'s OWN first-person voice, as if {other_name} is speaking it — never "
        f"written in the second person addressed to {other_name}, and never referring to "
        f"{other_name} by name as though talking TO them (they are the one saying it, not "
        f"hearing it). The context above is written TO THE PATIENT (\"you...\", \"{other_name} "
        "is your nephew\"), so you must correctly flip the perspective: if the context says "
        f"\"{other_name} is your nephew\", the phrase {other_name} would actually say is \"I'm "
        "your nephew\" — NOT \"you're my nephew\" (that reverses the relationship) and not a "
        f"third-person description of {other_name}.\n\n"
        f"Facts already established in PAST calls with {other_name} (for filling in the answer "
        f"ONLY — never use this to decide whether something is a repeat; that is this-call-only, "
        f"per the rule above):\n{past_calls_text}\n\n"
        "HARD RULE — never invent a fact. Only state a specific answer (a relationship, a name's "
        "identity, a place, an event) in the example phrase if that exact fact already appears "
        "in the earlier-this-call list, the past-calls facts above, or this chunk's own "
        "transcript. If you do not actually know the answer from that text, the example phrase "
        f"must stay generic and let {other_name} supply it — never guess a plausible-sounding "
        "relationship or detail, and specifically never reach for the generic \"family member or "
        "friend\" scene-description from the very first line of these instructions as if it were "
        "an actual answer — that sentence is only describing the kind of call this is in general, "
        "not a fact about this specific person.\n"
        "- Known-fact example (from this call): earlier-this-call list already says \"John "
        "reminded you Priya's your granddaughter who just moved to Boston\" — \"Stay warm and "
        "unhurried — they may be anxious about forgetting. Validate first, then answer briefly: "
        "'It's okay to ask again — Priya's your granddaughter, she just moved to Boston.' Avoid "
        "quizzing them or saying you already told them.\"\n"
        f"- Known-fact example (from a past call): nothing in THIS call ever explains who "
        f"{other_name} is, but a past-calls fact above already says \"{other_name} is your "
        f"nephew\" — the example phrase may still safely use it: \"Stay warm and unhurried — "
        f"validate first, then answer briefly: 'It's totally fine to ask — I'm your nephew.'\" "
        "(said in their own first-person voice, per the rule above — not \"I'm John, your "
        "nephew\").\n"
        "- Unknown-fact example: nothing in this call OR any past call ever says who Maya is — "
        "\"Stay warm and unhurried, and don't guess at who Maya is if you're not sure either. "
        "Validate first, then answer with whatever you actually know: 'That's a good question — "
        "let me remind you who Maya is.' Never invent a relationship or detail you're not sure "
        "of, and never fall back on generic words like 'friend' as a guess.\"\n"
        "- Redirect example: \"If they seem frustrated by not remembering, it's fine to skip the "
        "fact this time and redirect gently instead: 'That's alright, tell me what's been on "
        "your mind today' — reduces pressure more than repeating the same answer a fourth time.\"\n"
        "If nothing qualifies as a repeat, leave patient_repeated false and the other two "
        "fields empty.\n\n"
        f"Transcript snippet:\n{text}"
    )
    try:
        result: ChunkSummary = await _chunk_llm.ainvoke([HumanMessage(content=prompt)])
    except Exception:
        logger.exception("chunk summarization failed for %s", key)
        result = ChunkSummary(current_context="Conversation in progress…", summary_line=text[:200])

    if result.patient_repeated and not _has_prior_ask(result.repeated_topic, session_lines):
        logger.info("suppressing repeat flag with no prior ask evidence: %r", result.repeated_topic)
        result.patient_repeated = False
        result.repeated_topic = ""
        result.caregiver_suggestion = ""

    _sessions.setdefault(key, []).append(result.summary_line)
    _append_pending(patient_id, other_id, other_name, meeting_code, result.summary_line)

    # Speech metrics are derived here, from text that is about to be discarded,
    # and only the numbers are kept — the raw transcript is never persisted.
    _accumulate_metrics(
        patient_id, other_id, other_name, meeting_code,
        chunk_metrics(text), result.patient_repeated, patient_name,
    )
    return result


def get_session_summary(patient_id: str, other_id: str, meeting_code: str) -> str:
    return " ".join(_sessions.get((patient_id, other_id, meeting_code), []))


async def finalize_session(patient_id: str, other_id: str, other_name: str, meeting_code: str) -> None:
    key = (patient_id, other_id, meeting_code)
    pending_path = _pending_file_path(patient_id, other_id, other_name, meeting_code)

    # Prefer the write-ahead log: it's the superset. The in-memory copy is
    # empty whenever this process restarted mid-call, which used to mean the
    # whole call was silently dropped.
    lines = _read_pending(pending_path) or _sessions.pop(key, [])
    _sessions.pop(key, None)
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
        paragraph = extract_text(response.content) or joined
    except Exception:
        logger.exception("finalize summarization failed for %s", key)
        paragraph = joined

    now = datetime.now(ZoneInfo(TIMEZONE))
    header = f"=== Call with {other_name} on {now.strftime('%Y-%m-%d %H:%M %Z')} ==="
    block = f"\n{header}\n{paragraph.strip()}\n"

    path = _dyad_file_path(patient_id, other_id, other_name)
    with open(path, "a", encoding="utf-8") as f:
        f.write(block)

    _finalize_metrics(patient_id, other_id, other_name, meeting_code, now)
    pending_path.unlink(missing_ok=True)


def _finalize_metrics(
    patient_id: str, other_id: str, other_name: str, meeting_code: str, now: datetime,
) -> None:
    """Collapse the running totals into one call record and append it to the
    per-dyad .metrics.jsonl. Rates are computed here, once, from summed counts."""
    wip = _metrics_wip_path(patient_id, other_id, other_name, meeting_code)
    if not wip.exists():
        return

    totals = _load_totals(wip)
    tokens = totals["token_count"]
    record = {
        "timestamp": now.isoformat(),
        "meeting_code": meeting_code,
        "other_name": other_name,
        "patient_name": totals.get("patient_name"),
        "chunks": totals["chunks"],
        "word_count": tokens,
        "repetition_count": totals["repetition_count"],
        "pronoun_rate": per_hundred(totals["pronoun_count"], tokens),
        "filler_rate": per_hundred(totals["filler_count"], tokens),
        "words_per_utterance": (
            round(tokens / totals["utterance_count"], 1) if totals["utterance_count"] else None
        ),
        "lexical_diversity": (
            round(totals["mattr_sum"] / totals["mattr_n"], 3) if totals["mattr_n"] else None
        ),
        "observations": totals["observations"],
    }

    try:
        with open(metrics_log_path(patient_id, other_id, other_name), "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
        wip.unlink(missing_ok=True)
    except Exception:
        logger.exception("could not append call metrics for %s", meeting_code)


async def sweep_abandoned(patient_id: str, other_id: str, other_name: str) -> None:
    """Finalize calls for this dyad that stopped sending chunks but never
    finalized — the tab was closed, the browser crashed, or the other person
    hung up first (which makes the client's finalize() a silent no-op). Without
    this, those calls would sit as .pending files forever and never show up in
    the patient's history."""
    dyad = _dyad_file_path(patient_id, other_id, other_name)
    now = datetime.now().timestamp()

    for pending in dyad.parent.glob(f"{dyad.stem}.*.pending"):
        try:
            if now - pending.stat().st_mtime < _ABANDONED_AFTER_SECONDS:
                continue  # a call is still live and writing to this one
            meeting_code = pending.suffixes[-2].lstrip(".")
        except Exception:
            logger.exception("could not inspect pending file %s", pending)
            continue

        logger.info("finalizing abandoned call %s", pending.name)
        await finalize_session(patient_id, other_id, other_name, meeting_code)


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
