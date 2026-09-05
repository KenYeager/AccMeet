import os
from typing import Annotated
from typing_extensions import TypedDict
from dotenv import load_dotenv

from langgraph.graph import StateGraph, START, END
from langgraph.prebuilt import ToolNode, tools_condition
from langgraph.graph.message import add_messages
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import SystemMessage

from tools import rag_context_lookup

load_dotenv()

class CopilotState(TypedDict):
    messages: Annotated[list, add_messages]

tools = [rag_context_lookup]
tool_node = ToolNode(tools)

# Gemini Flash is optimized for sub-second tool-calling cycles
llm = ChatGoogleGenerativeAI(
    model="gemini-3.5-flash-lite",
    temperature=0,
    google_api_key=os.getenv("GOOGLE_API_KEY"),
).bind_tools(tools)

SYSTEM_PROMPT = SystemMessage(
    content=(
        "You are an ambient AI Meeting HUD assistant operating in real time.\n"
        "You monitor live transcript segments from meetings and conversations.\n"
        "GOAL:\n"
        "- If an individual, family member, team member, or project reference is mentioned and needs background context, "
        "invoke `rag_context_lookup`.\n"
        "- If the transcript chunk is regular chit-chat, scheduling, or self-explanatory remarks that don't need lore, "
        "do NOT invoke the tool. Return a brief token 'NO_ACTION'.\n"
        "- Keep responses concise and factual for an on-screen HUD preview."
    )
)

def copilot_node(state: CopilotState):
    messages = [SYSTEM_PROMPT] + state["messages"]
    response = llm.invoke(messages)
    return {"messages": [response]}

workflow = StateGraph(CopilotState)

workflow.add_node("copilot", copilot_node)
workflow.add_node("tools", tool_node)

workflow.add_edge(START, "copilot")
workflow.add_conditional_edges("copilot", tools_condition)
workflow.add_edge("tools", "copilot")
workflow.add_edge("copilot", END)

agent_app = workflow.compile()