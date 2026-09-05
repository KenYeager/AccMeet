from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .database import connect_db, close_db
from .services.rag_service import connect_rag_client, close_rag_client
from .routers import meetings, websocket, rag


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await connect_db()
    await connect_rag_client()
    yield
    # Shutdown
    await close_rag_client()
    await close_db()


settings = get_settings()

app = FastAPI(
    title="Meeting Platform API",
    description="Audio-only meeting platform — hackathon MVP",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,  # Required for session cookies
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(meetings.router, prefix="/api/meetings", tags=["meetings"])
app.include_router(websocket.router, tags=["websocket"])
app.include_router(rag.router, prefix="/api/rag", tags=["rag"])


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "meeting-platform-backend"}
