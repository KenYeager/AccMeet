import os
import certifi
from pathlib import Path
from typing import List
from dotenv import load_dotenv
from pymongo import MongoClient
from google import genai
from langchain_core.embeddings import Embeddings
from langchain_mongodb import MongoDBAtlasVectorSearch

# 1. Load Environment Variables
env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)

MONGO_URI = os.getenv("MONGO_URI") or os.getenv("MONGODB_URI")
DB_NAME = os.getenv("DB_NAME", "meeting_copilot")
COLLECTION_NAME = os.getenv("COLLECTION_NAME", "lore_embeddings")
INDEX_NAME = os.getenv("INDEX_NAME", "vector_index")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

if not MONGO_URI or not GOOGLE_API_KEY:
    raise ValueError(
        f"Missing MONGO_URI or GOOGLE_API_KEY in environment variables. Checked path: {env_path}"
    )

# 2. Custom LangChain Embeddings Wrapper for google-genai SDK
class GeminiOfficialEmbeddings(Embeddings):
    def __init__(self, api_key: str, model: str = "gemini-embedding-2"):
        self.client = genai.Client(api_key=api_key)
        self.model = model

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """Embed a list of documents/chunks."""
        if not texts:
            return []
        response = self.client.models.embed_content(
            model=self.model,
            contents=texts,
        )
        return [emb.values for emb in response.embeddings]

    def embed_query(self, text: str) -> List[float]:
        """Embed a single search query."""
        response = self.client.models.embed_content(
            model=self.model,
            contents=text,
        )
        return response.embeddings[0].values

# 3. Initialize Embeddings and MongoDB Client
embeddings = GeminiOfficialEmbeddings(
    api_key=GOOGLE_API_KEY,
    model="gemini-embedding-2"
)

client = MongoClient(MONGO_URI, tlsCAFile=certifi.where())
collection = client[DB_NAME][COLLECTION_NAME]

# 4. Initialize MongoDB Atlas Vector Store & Retriever
vector_store = MongoDBAtlasVectorSearch(
    collection=collection,
    embedding=embeddings,
    index_name=INDEX_NAME,
    text_key="text",
    embedding_key="embedding",
)

retriever = vector_store.as_retriever(
    search_type="similarity",
    search_kwargs={"k": 2}
)