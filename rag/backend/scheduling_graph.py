import logging
import os
from datetime import datetime
from zoneinfo import ZoneInfo

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI

from calendar_tool import schedule_calendar_event

logger = logging.getLogger("scheduling_graph")

SCHEDULING_TIMEZONE = os.getenv("SCHEDULING_TIMEZONE", "Asia/Kolkata")

llm_with_tools = ChatGoogleGenerativeAI(
    model="gemini-3.5-flash-lite",
    temperature=0,
    google_api_key=os.getenv("GOOGLE_API_KEY"),
).bind_tools([schedule_calendar_event])


def _build_system_prompt(now: datetime) -> str:
    return (
        f"The current date and time is {now.isoformat()} in the {SCHEDULING_TIMEZONE} timezone. "
        "Use this as the only source of truth for resolving relative dates like 'tomorrow', "
        "'next Tuesday', or 'in two weeks'.\n\n"
        "You are monitoring one sentence at a time from a live meeting transcript being saved "
        "to shared memory. If — and only if — this sentence contains an explicit, fairly "
        "unambiguous commitment to meet, call, or schedule something at a specific or clearly "
        "inferable date and time, invoke `schedule_calendar_event` with the extracted details.\n\n"
        "Positive example (call the tool): \"let's meet next Tuesday at 3pm to review the deck\".\n"
        "Negative examples (do NOT call the tool): \"we should really sync up sometime\" (too vague), "
        "\"the meeting yesterday went well\" (past tense, not a commitment), general chit-chat.\n\n"
        "Always give `start` (and `end` if stated) as ISO 8601 with an explicit UTC offset "
        "(e.g. +05:30) — never a naive datetime with no offset. If no end time is mentioned, "
        "omit `end` entirely; a default duration will be applied automatically. "
        "If nothing in the sentence qualifies, do not call any tool."
    )


async def check_and_schedule(sentence: str) -> None:
    """Runs after an ingested sentence is stored — detects and acts on scheduling commitments.

    Invoked as a FastAPI BackgroundTask so it never delays the ingest response.
    """
    try:
        now = datetime.now(ZoneInfo(SCHEDULING_TIMEZONE))
        messages = [SystemMessage(content=_build_system_prompt(now)), HumanMessage(content=sentence)]
        response = await llm_with_tools.ainvoke(messages)

        if not response.tool_calls:
            logger.debug("no scheduling commitment detected: %r", sentence)
            return

        for call in response.tool_calls:
            result = await schedule_calendar_event.ainvoke(call["args"])
            logger.info("scheduling tool result for %r: %s", sentence, result)
    except Exception:
        logger.exception("scheduling check failed for sentence: %r", sentence)
