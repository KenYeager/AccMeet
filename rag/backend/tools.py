from langchain_core.tools import tool
from pydantic import BaseModel, Field
from rag_engine import retriever

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