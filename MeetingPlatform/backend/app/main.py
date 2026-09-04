from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .database import connect_db, close_db
from .routers import meetings, websocket


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await connect_db()
    yield
    # Shutdown
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


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "meeting-platform-backend"}
