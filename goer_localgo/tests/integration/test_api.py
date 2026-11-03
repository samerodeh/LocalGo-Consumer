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


def test_browser_index_is_served():
    response = TestClient(app).get("/")

    assert response.status_code == 200
    assert "Goer AI" in response.text


def test_chat_validates_empty_message():
    response = TestClient(app).post("/v1/chat", json={"message": ""})

    assert response.status_code == 422


def test_browser_chat_requires_a_user_message():
    response = TestClient(app).post("/api/chat", json={"messages": []})

    assert response.status_code == 422
