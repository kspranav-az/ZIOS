from fastapi.testclient import TestClient

from app.main import app


def test_healthz_returns_ok() -> None:
    client = TestClient(app)
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "ai-orchestrator"}
    assert response.headers["x-request-id"]


def test_healthz_echoes_inbound_request_id() -> None:
    client = TestClient(app)
    response = client.get("/healthz", headers={"x-request-id": "test-correlation-id"})

    assert response.headers["x-request-id"] == "test-correlation-id"
