import os
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langchain_core.messages import HumanMessage
from langchain_core.documents import Document

from rag_engine import vector_store
from graph import agent_app

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

@app.get("/")
def health_check():
    return {"status": "ok", "service": "meeting-copilot-rag"}

@app.post("/api/rag/ingest")
async def ingest_lore(payload: IngestBatchRequest):
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

        final_content = messages[-1].content if messages else ""

        return {
            "hud_triggered": tool_executed,
            "tool_name": tool_name,
            "query": tool_query,
            "hud_card_data": tool_output,
            "assistant_response": final_content,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", 8000)), reload=True)