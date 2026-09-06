import os
from datetime import datetime
from typing import Annotated
from zoneinfo import ZoneInfo
from typing_extensions import TypedDict
from dotenv import load_dotenv

from langgraph.graph import StateGraph, START, END
from langgraph.prebuilt import ToolNode, tools_condition
from langgraph.graph.message import add_messages
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import SystemMessage

from calendar_tool import schedule_calendar_event
from tools import rag_context_lookup, store_lore, log_speech_observation

load_dotenv()

SCHEDULING_TIMEZONE = os.getenv("SCHEDULING_TIMEZONE", "Asia/Kolkata")

class CopilotState(TypedDict):
    messages: Annotated[list, add_messages]

# Only bound into the graph for the designated "patient" participant — see
# _build_graph's docstring for why this is a hard toolset restriction rather
# than a prompt instruction.
LOOKUP_INSTRUCTIONS = (
    "- `rag_context_lookup`: call this if a person, relationship, or project is mentioned "
    "that the listener — a memory-care patient — may need background on to follow the "
    "conversation. Keep the returned summary short and reassuring; it appears as an "
    "on-screen reminder card.\n\n"
    "- `log_speech_observation`: call this ONLY when the patient visibly struggles with the "
    "MECHANICS of speaking — searching for a common word and describing it instead ('the "
    "thing you boil water in'), losing the thread mid-sentence, or being confused about the "
    "day or place. This is about HOW they spoke, never what they discussed. Ordinary pauses, "
    "ordinary self-correction and changing the subject are NOT worth logging.\n\n"
)


def _build_graph(tools: list, lookup_instructions: str):
    """Compiles one copilot graph for a fixed toolset. Tool availability must be a hard
    guarantee (e.g. only the patient's client ever gets rag_context_lookup), so we compile
    a separate graph per toolset at import time rather than parameterizing one graph at
    request time and relying on the prompt to gate which tools get called."""
    tool_node = ToolNode(tools)
    llm = ChatGoogleGenerativeAI(
        model="gemini-3.5-flash-lite",
        temperature=0,
        google_api_key=os.getenv("GOOGLE_API_KEY"),
    ).bind_tools(tools)

    def copilot_node(state: CopilotState):
        # Computed fresh per call (not at module load) so relative-date
        # resolution for scheduling stays correct — same pattern the old
        # scheduling_graph.py used.
        now = datetime.now(ZoneInfo(SCHEDULING_TIMEZONE))
        system_prompt = SystemMessage(content=(
            "You are monitoring a rolling ~30-second window of live meeting transcript — it may "
            "contain multiple sentences from one or more speakers, prefixed with who said them. "
            "For this chunk, decide which of your available tools (if any) to call. You may call "
            "more than one tool, and more than once each, if the chunk contains multiple distinct "
            "things worth acting on.\n\n"
            "- `store_lore`: call this for any fact with LASTING value — a relationship, a "
            "preference, a past or planned event, a health detail, anything that would help in a "
            "FUTURE conversation. Do NOT call it for small talk, greetings, or filler with no "
            "lasting value.\n\n"
            "- `schedule_calendar_event`: call this ONLY for an explicit, fairly unambiguous "
            "commitment to meet, call, or do something at a specific or clearly inferable date and "
            f"time. The current date and time is {now.isoformat()} in the {SCHEDULING_TIMEZONE} "
            "timezone — use this as the only source of truth for resolving relative dates like "
            "'tomorrow' or 'next Tuesday'. Give `start` (and `end` if stated) as ISO 8601 with an "
            "explicit UTC offset (e.g. +05:30) — never a naive datetime. If no end time is "
            "mentioned, omit it; a default duration is applied automatically.\n"
            "  Positive example (call the tool): \"let's meet next Tuesday at 3pm to review the deck\".\n"
            "  Negative examples (do NOT call the tool): \"we should really sync up sometime\" (too "
            "vague), \"the meeting yesterday went well\" (past tense, not a commitment), general "
            "chit-chat.\n"
            "  If the commitment explicitly repeats, also set `recurrence` to \"daily\", \"weekly\", "
            "or \"monthly\" — `start`/`end` still give the FIRST occurrence's time.\n"
            "  Recurring example: \"remind me to take my medication every day at 7pm\" -> "
            "start=<today or tomorrow at 19:00>, recurrence=\"daily\".\n"
            "  Non-recurring example: \"let's meet next Tuesday at 3pm\" -> no `recurrence` — a "
            "single mention of a day is NOT recurring just because that day name repeats weekly on "
            "a calendar; only set it when the person actually said \"every\"/\"each\"/\"daily\"/"
            "\"weekly\" or equivalent.\n\n"
            + lookup_instructions +
            "If nothing in this chunk warrants any tool call, respond with the single word "
            "NO_ACTION and call no tools. Keep any other response concise — this may appear as an "
            "on-screen preview."
        ))
        response = llm.invoke([system_prompt] + state["messages"])
        return {"messages": [response]}

    workflow = StateGraph(CopilotState)
    workflow.add_node("copilot", copilot_node)
    workflow.add_node("tools", tool_node)
    workflow.add_edge(START, "copilot")
    workflow.add_conditional_edges("copilot", tools_condition)
    workflow.add_edge("tools", "copilot")
    workflow.add_edge("copilot", END)
    return workflow.compile()


# Two fixed toolsets, compiled once at import time.
general_agent_app = _build_graph([store_lore, schedule_calendar_event], "")
patient_agent_app = _build_graph(
    [rag_context_lookup, store_lore, schedule_calendar_event, log_speech_observation],
    LOOKUP_INSTRUCTIONS,
)

# Kept for backwards compatibility with the old /api/agent/process-chunk
# endpoint, which is left in place (unused by the new automatic flow, but
# still curl-able for manual testing) — same lookup-only behavior as before.
agent_app = _build_graph([rag_context_lookup], LOOKUP_INSTRUCTIONS)
