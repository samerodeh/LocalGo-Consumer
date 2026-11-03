from fastapi.testclient import TestClient

from goer_localgo.api.main import app


def test_health_endpoint():
    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "framework": "crewai",
        "api": "fastapi",
    }


def test_chat_validates_empty_message():
    response = TestClient(app).post("/v1/chat", json={"message": ""})

    assert response.status_code == 422
