"""
Builds the caregiver-facing report from the per-call metric records written by
conversation_memory._finalize_metrics.

Comparisons are always against the PATIENT'S OWN earlier calls, never against
population norms — we have no normative data, and inventing a "normal" would be
the least defensible thing this feature could do. So every statement is of the
form "more than their own usual", which is both honest and the thing a family
member actually notices.
"""
import json
import logging
import statistics

from langchain_core.messages import HumanMessage

from conversation_memory import extract_text, llm, metrics_log_path

logger = logging.getLogger("report")

# Calls needed before we'll compare anything to a baseline. Below this, the
# per-call numbers are still shown — they're facts — but no "this changed"
# claim is made, because two data points cannot establish a usual.
MIN_CALLS_FOR_BASELINE = 3

# A metric must move at least this much relative to its own baseline before it
# counts as a change. Ordinary call-to-call variation is large; without a
# threshold every report would breathlessly announce a "change" every time.
RELATIVE_CHANGE_THRESHOLD = 0.25

# For each metric: label, and which direction is worth drawing attention to.
_TRACKED = {
    "repetition_count": ("times they repeated themselves", "up"),
    "lexical_diversity": ("variety of words used", "down"),
    "pronoun_rate": ("vague words like 'she' or 'that' instead of names", "up"),
    "filler_rate": ("hesitation while speaking", "up"),
    "words_per_utterance": ("sentence length", "down"),
}


def list_contacts(other_id: str) -> list[dict]:
    """Every patient this caregiver has recorded calls with.

    The caregiver's device knows its own user id but not which patients it has
    spoken to, so this scans the dyad files. Filenames end in the other party's
    id prefix (see _dyad_file_path), and the parent directory is the patient id.
    """
    from conversation_memory import DATA_DIR

    if not DATA_DIR.exists() or not other_id:
        return []

    contacts = []
    for log in DATA_DIR.glob(f"*/*_{other_id[:6]}.metrics.jsonl"):
        calls = _read_jsonl(log)
        if not calls:
            continue
        latest = calls[-1]
        contacts.append({
            "patient_id": log.parent.name,
            "patient_name": latest.get("patient_name") or "Unnamed",
            "other_name": latest.get("other_name") or "",
            "call_count": len(calls),
            "last_call": latest.get("timestamp"),
        })

    contacts.sort(key=lambda c: c["last_call"] or "", reverse=True)
    return contacts


def _read_jsonl(path) -> list[dict]:
    calls = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            calls.append(json.loads(line))
        except json.JSONDecodeError:
            logger.warning("skipping malformed metrics line in %s", path)
    return calls


def read_calls(patient_id: str, other_id: str, other_name: str) -> list[dict]:
    """All completed calls for this dyad, oldest first."""
    path = metrics_log_path(patient_id, other_id, other_name)
    return _read_jsonl(path) if path.exists() else []


def _compare(latest: dict, previous: list[dict]) -> list[dict]:
    """Compare the latest call against the mean of the earlier ones."""
    changes = []

    for field, (label, direction) in _TRACKED.items():
        current = latest.get(field)
        history = [c[field] for c in previous if c.get(field) is not None]
        if current is None or len(history) < MIN_CALLS_FOR_BASELINE:
            continue

        baseline = statistics.mean(history)
        if baseline == 0:
            # Can't express a relative change against zero; only flag if the
            # latest call is meaningfully non-zero (e.g. first repetitions).
            if current >= 2:
                changes.append({
                    "metric": field, "label": label, "current": current,
                    "baseline": 0, "direction": "up", "notable": True,
                })
            continue

        delta = (current - baseline) / baseline
        if abs(delta) < RELATIVE_CHANGE_THRESHOLD:
            continue

        moved = "up" if delta > 0 else "down"
        changes.append({
            "metric": field,
            "label": label,
            "current": current,
            "baseline": round(baseline, 2),
            "direction": moved,
            "percent": round(abs(delta) * 100),
            # Only movement in the clinically-discussed direction is worth
            # raising; the opposite direction is recorded but not highlighted.
            "notable": moved == direction,
        })

    return changes


async def _narrate(other_name: str, latest: dict, changes: list[dict]) -> str:
    notable = [c for c in changes if c["notable"]]
    facts = [
        f"- {c['label']}: {c['current']} this call vs {c['baseline']} usually "
        f"({c['direction']} {c.get('percent', 0)}%)"
        for c in notable
    ]
    if latest.get("observations"):
        facts += [f"- noted during the call: {o}" for o in latest["observations"]]

    if not facts:
        return (
            f"This call looked much like {other_name}'s usual conversations with them — "
            "nothing stood out."
        )

    prompt = (
        "You are writing 2-3 sentences for a family member, summarising what changed in "
        "how their relative spoke during today's video call compared with their own "
        "previous calls.\n\n"
        "Write warmly and plainly, as you would to a worried son or daughter. State what "
        "was observed in concrete terms — do not soften it into vagueness, and do not "
        "dramatise it either. Do not diagnose anything or name any condition; you are "
        "describing what was measured, nothing more. End with a short sentence suggesting "
        "this is worth mentioning to their doctor.\n\n"
        "Observations:\n" + "\n".join(facts)
    )

    try:
        response = await llm.ainvoke([HumanMessage(content=prompt)])
        return extract_text(response.content).strip() or "\n".join(facts)
    except Exception:
        logger.exception("report narration failed")
        return "\n".join(facts)


async def build_report(patient_id: str, other_id: str, other_name: str) -> dict:
    calls = read_calls(patient_id, other_id, other_name)
    if not calls:
        return {
            "status": "no_data",
            "message": "No completed calls recorded yet.",
            "calls": [], "changes": [], "call_count": 0,
        }

    latest, previous = calls[-1], calls[:-1]

    if len(previous) < MIN_CALLS_FOR_BASELINE:
        return {
            "status": "building_baseline",
            "message": (
                f"Recorded {len(calls)} call(s). After "
                f"{MIN_CALLS_FOR_BASELINE - len(previous)} more, this report will start "
                "comparing each call against their usual pattern."
            ),
            "latest": latest, "calls": calls, "changes": [], "call_count": len(calls),
        }

    changes = _compare(latest, previous)
    return {
        "status": "ready",
        "summary": await _narrate(other_name, latest, changes),
        "latest": latest,
        "changes": changes,
        "calls": calls,
        "call_count": len(calls),
    }
