from fastapi import FastAPI

from app.logging import CorrelationIdMiddleware, configure_logging

configure_logging()

app = FastAPI(title="ai-orchestrator")
app.add_middleware(CorrelationIdMiddleware)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok", "service": "ai-orchestrator"}
