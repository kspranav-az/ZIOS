from fastapi import FastAPI

from app.logging import CorrelationIdMiddleware, configure_logging
from app.telemetry import init_tracing
from app.voice.router import router as voice_router

configure_logging()
init_tracing()

app = FastAPI(title="ai-orchestrator")
app.add_middleware(CorrelationIdMiddleware)
app.include_router(voice_router)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok", "service": "ai-orchestrator"}
