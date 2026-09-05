import logging
import os
from typing import List, Optional
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langchain_core.messages import HumanMessage
from langchain_core.documents import Document

from rag_engine import vector_store
from graph import agent_app, general_agent_app, patient_agent_app
from scheduling_graph import check_and_schedule
from conversation_memory import (
    summarize_chunk, get_session_summary, finalize_session, read_history, sweep_abandoned,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="Meeting Copilot HUD Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class LoreItem(BaseModel):
    text: str
    category: Optional[str] = "kinship"
    entity_name: Optional[str] = ""

class IngestBatchRequest(BaseModel):
    items: List[LoreItem]

class TranscriptInput(BaseModel):
    chunk: str

class OrchestrateRequest(BaseModel):
    text: str
    is_patient: bool = False

class ConversationChunkRequest(BaseModel):
    patient_id: str
    other_id: str
    other_name: str
    meeting_code: str
    text: str

class ConversationFinalizeRequest(BaseModel):
    patient_id: str
    other_id: str
    other_name: str
    meeting_code: str

def _extract_text(content) -> str:
    """Gemini can return message.content as a string or a list of content blocks."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            block.get("text", "") if isinstance(block, dict) else str(block)
            for block in content
            if not isinstance(block, dict) or block.get("type") == "text"
        )
    return str(content)

@app.get("/")
def health_check():
    return {"status": "ok", "service": "meeting-copilot-rag"}

@app.post("/api/rag/ingest")
async def ingest_lore(payload: IngestBatchRequest, background_tasks: BackgroundTasks):
    try:
        docs = [
            Document(
                page_content=item.text,
                metadata={
                    "category": item.category,
                    "entity_name": item.entity_name
                }
            )
            for item in payload.items
        ]
        vector_store.add_documents(docs)

        # Fire-and-forget: check each sentence for a schedulable date/time
        # commitment after the response is sent, so ingest latency is unaffected.
        for item in payload.items:
            background_tasks.add_task(check_and_schedule, item.text)

        return {"status": "success", "inserted": len(docs)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/agent/process-chunk")
async def process_transcript_chunk(payload: TranscriptInput):
    try:
        initial_state = {
            "messages": [HumanMessage(content=payload.chunk)]
        }
        final_state = await agent_app.ainvoke(initial_state)
        messages = final_state["messages"]

        tool_executed = False
        tool_name = None
        tool_query = None
        tool_output = None

        # Inspect message history to extract tool call results for HUD
        for msg in messages:
            if hasattr(msg, "tool_calls") and msg.tool_calls:
                tool_executed = True
                tool_name = msg.tool_calls[0].get("name")
                tool_query = msg.tool_calls[0].get("args", {}).get("query")
            if msg.type == "tool":
                tool_output = msg.content

        final_content = _extract_text(messages[-1].content) if messages else ""

        return {
            "hud_triggered": tool_executed,
            "tool_name": tool_name,
            "query": tool_query,
            "hud_card_data": tool_output,
            "assistant_response": final_content,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/agent/orchestrate")
async def orchestrate(payload: OrchestrateRequest):
    """Single automatic entry point replacing the old manual ingest-toggle /
    retrieve-toggle / scheduling-background-task trio: one LangGraph turn per
    ~30s transcript chunk decides whether to store_lore, schedule_calendar_event,
    and/or (patient-only) rag_context_lookup — any combination, or nothing."""
    try:
        app_to_use = patient_agent_app if payload.is_patient else general_agent_app
        final_state = await app_to_use.ainvoke({"messages": [HumanMessage(content=payload.text)]})
        messages = final_state["messages"]

        # Collect ALL tool calls/results this turn — unlike the old single-tool
        # process-chunk endpoint, this graph can legitimately fire multiple
        # tools (e.g. store_lore AND schedule_calendar_event) in one pass.
        actions = []
        hud_triggered = False
        hud_query = None
        hud_card_data = None

        for msg in messages:
            if getattr(msg, "tool_calls", None):
                for call in msg.tool_calls:
                    if call.get("name") == "rag_context_lookup":
                        hud_triggered = True
                        hud_query = call.get("args", {}).get("query")
            if msg.type == "tool":
                if msg.name == "rag_context_lookup":
                    hud_card_data = msg.content
                else:
                    actions.append({"tool": msg.name, "result": msg.content})

        return {
            "hud_triggered": hud_triggered,
            "query": hud_query,
            "hud_card_data": hud_card_data,
            "assistant_response": _extract_text(messages[-1].content) if messages else "",
            "actions": actions,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/conversation/chunk")
async def conversation_chunk(payload: ConversationChunkRequest):
    try:
        result = await summarize_chunk(
            payload.patient_id, payload.other_id, payload.other_name,
            payload.meeting_code, payload.text,
        )
        return {
            "current_context": result.current_context,
            "summary_line": result.summary_line,
            "session_summary": get_session_summary(payload.patient_id, payload.other_id, payload.meeting_code),
            "caregiver_tip": (
                {"repeated_topic": result.repeated_topic, "suggestion": result.caregiver_suggestion}
                if result.patient_repeated else None
            ),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/conversation/finalize")
async def conversation_finalize(payload: ConversationFinalizeRequest, background_tasks: BackgroundTasks):
    # Fire-and-forget: the client calls this right before navigating away on
    # leave, so it shouldn't block on one more Gemini round trip.
    background_tasks.add_task(
        finalize_session, payload.patient_id, payload.other_id, payload.other_name, payload.meeting_code,
    )
    return {"status": "scheduled"}

@app.get("/api/conversation/history")
async def conversation_history(patient_id: str, other_id: str, other_name: str):
    try:
        # Recover any earlier call that stopped mid-flight without finalizing
        # (tab closed, backend restarted, other participant hung up first) so
        # its conversation still shows up here rather than being lost.
        await sweep_abandoned(patient_id, other_id, other_name)
        return {"entries": read_history(patient_id, other_id, other_name)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", 8001)), reload=True)