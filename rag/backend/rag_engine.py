import os
from dotenv import load_dotenv
from pymongo import MongoClient
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_mongodb import MongoDBAtlasVectorSearch

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")
DB_NAME = os.getenv("DB_NAME", "meeting_copilot")
COLLECTION_NAME = os.getenv("COLLECTION_NAME", "lore_embeddings")
INDEX_NAME = os.getenv("INDEX_NAME", "vector_index")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

if not MONGO_URI or not GOOGLE_API_KEY:
    raise ValueError("Missing MONGO_URI or GOOGLE_API_KEY in environment variables.")

client = MongoClient(MONGO_URI)
collection = client[DB_NAME][COLLECTION_NAME]

# text-embedding-004 generates 768-dim embeddings
embeddings = GoogleGenerativeAIEmbeddings(
    model="models/text-embedding-004",
    google_api_key=GOOGLE_API_KEY
)

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