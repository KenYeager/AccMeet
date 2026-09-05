from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .database import connect_db, close_db
from .routers import meetings, websocket


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_db()
    yield
    await close_db()


settings = get_settings()

app = FastAPI(
    title="DeafMeet API",
    description="Accessible meeting platform for deaf users — captions-first, sign language video",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(meetings.router, prefix="/api/meetings", tags=["meetings"])
app.include_router(websocket.router, tags=["websocket"])

# ASL sign GIFs, matched by caption_to_asl() and rendered by the frontend's
# sign playback panel — served from deaf/gif (sibling of backend/). Mounted
# under /api so it rides the frontend's existing /api/* rewrite instead of
# needing a second rewrite rule (and a second Docker-vs-host base URL).
_gif_dir = Path(__file__).resolve().parents[2] / "gif"
if _gif_dir.exists():
    app.mount("/api/gif", StaticFiles(directory=_gif_dir), name="gif")


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "deafmeet-backend"}
