from langchain_core.documents import Document
from langchain_core.tools import tool
from pydantic import BaseModel, Field
from rag_engine import retriever, vector_store

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