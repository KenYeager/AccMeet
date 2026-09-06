import contextvars
import logging

from langchain_core.documents import Document
from langchain_core.tools import tool
from pydantic import BaseModel, Field
from rag_engine import retriever, vector_store

logger = logging.getLogger("tools")

# Which call the current request belongs to. Tools receive only the arguments
# the model chose, so the dyad/call identity has to travel out of band; the
# orchestrate endpoint sets this before invoking the graph. A ContextVar (not a
# module global) keeps it correct when concurrent calls are in flight.
current_call: contextvars.ContextVar[dict | None] = contextvars.ContextVar(
    "current_call", default=None
)

class RAGQueryInput(BaseModel):
    query: str = Field(
        description="The specific entity name, relative, colleague, or project keyword that needs background lore."
    )

@tool("rag_context_lookup", args_schema=RAGQueryInput)
def rag_context_lookup(query: str) -> str:
    """Useful to fetch background context about people, kinship relations, coworker duties, and internal project lore."""
    docs = retriever.invoke(query)
    if not docs:
        return "No relevant background lore found."

    formatted_chunks = []
    for doc in docs:
        meta_cat = doc.metadata.get("category", "general")
        formatted_chunks.append(f"[{meta_cat.upper()}]: {doc.page_content}")

    return "\n---\n".join(formatted_chunks)


class StoreLoreInput(BaseModel):
    text: str = Field(
        description="The distilled fact worth remembering long-term — a clear standalone sentence, not the raw quote."
    )
    entity_name: str = Field(default="", description="The person/entity this fact is about, if applicable.")
    category: str = Field(default="kinship", description="Short category label, e.g. kinship, preference, event, project.")

@tool("store_lore", args_schema=StoreLoreInput)
def store_lore(text: str, entity_name: str = "", category: str = "kinship") -> str:
    """Stores a distilled fact with lasting value (a relationship, preference, past/planned event) into
    shared long-term memory. Do not call for small talk or filler with no future value."""
    vector_store.add_documents([Document(page_content=text, metadata={"category": category, "entity_name": entity_name})])
    return f"Stored: {text}"


class SpeechObservationInput(BaseModel):
    observation: str = Field(
        description="One short, factual, non-judgemental sentence describing what was "
        "observed in HOW they spoke — e.g. \"Paused to search for the word 'kettle' and "
        "said 'the thing for tea' instead\". Quote only the few words needed to make the "
        "observation concrete."
    )
    category: str = Field(
        default="word_finding",
        description="One of: word_finding, lost_thread, time_place_confusion, naming_difficulty.",
    )


@tool("log_speech_observation", args_schema=SpeechObservationInput)
def log_speech_observation(observation: str, category: str = "word_finding") -> str:
    """Records a notable observation about HOW the patient is expressing themselves —
    searching for a common word and substituting a description for it, losing track
    mid-sentence, or confusion about what day or place it is.

    This is about the FORM of their speech, never its content: do not call this to
    record what they talked about (use store_lore for that). Do not call it for
    ordinary pauses, ordinary self-correction, or someone simply changing the
    subject — only for something a family member would genuinely want to know about.
    """
    call = current_call.get()
    if not call:
        # No dyad context (e.g. a non-patient client, or a direct curl) — there is
        # no call to attach this to, so drop it rather than guessing.
        logger.info("log_speech_observation called with no call context; ignoring")
        return "No active call context — observation not recorded."

    # Imported here rather than at module scope: conversation_memory imports
    # nothing from tools, and keeping it lazy avoids a circular import if that
    # ever changes.
    from conversation_memory import record_observation

    record_observation(
        call["patient_id"], call["other_id"], call["other_name"], call["meeting_code"],
        f"[{category}] {observation}",
    )
    return "Observation recorded."