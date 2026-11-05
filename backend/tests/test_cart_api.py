from uuid import uuid4

import httpx
import pytest

from app import auth, config
from app.auth import CustomerSession, require_customer
from app.main import app
from app.routers.cart import cart_repository
from test_cart_manager import MemoryRepository


@pytest.fixture
def cart_client(client, monkeypatch):
    monkeypatch.setattr(config, "SERVER_CART_ENABLED", True)
    repository = MemoryRepository()
    owner = uuid4()
    app.dependency_overrides[require_customer] = lambda: CustomerSession(owner, "user-token")
    app.dependency_overrides[cart_repository] = lambda: repository
    try:
        yield client, repository, owner
    finally:
        app.dependency_overrides.pop(require_customer, None)
        app.dependency_overrides.pop(cart_repository, None)


def test_server_cart_flag_is_closed_by_default(client):
    assert client.get('/v1/cart').status_code == 503
    assert client.post('/v1/cart/clear', json={'cart_revision': 0}, headers={'Idempotency-Key': 'one'}).status_code == 503


def test_authenticated_rest_lifecycle_and_replay(cart_client):
    client, repo, owner = cart_client
    assert client.get("/v1/cart").json()["revision"] == 0
    body = {"product_id": "cheese-pizza-slice", "quantity": 2, "cart_revision": 0}
    first = client.post("/v1/cart/lines", json=body, headers={"Idempotency-Key": "one"})
    assert first.status_code == 200
    assert first.json()["total_cents"] == 1600
    assert client.post("/v1/cart/lines", json=body, headers={"Idempotency-Key": "one"}).json() == first.json()
    assert client.patch("/v1/cart/lines/cheese-pizza-slice", json={"quantity": 1, "cart_revision": 1},
                        headers={"Idempotency-Key": "two"}).json()["subtotal_cents"] == 550
    deleted = client.request("DELETE", "/v1/cart/lines/cheese-pizza-slice", json={"cart_revision": 2},
                             headers={"Idempotency-Key": "three"})
    assert deleted.status_code == 200
    assert deleted.json()["total_cents"] == 0
    assert client.post("/v1/cart/clear", json={"cart_revision": 3},
                       headers={"Idempotency-Key": "four"}).json()["revision"] == 4


def test_stale_and_mixed_merchant_requests_are_explicit(cart_client):
    client, _, _ = cart_client
    client.post("/v1/cart/lines", json={"product_id": "cheese-pizza-slice", "cart_revision": 0},
                headers={"Idempotency-Key": "one"})
    conflict = client.post("/v1/cart/clear", json={"cart_revision": 0}, headers={"Idempotency-Key": "two"})
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "CART_REVISION_CONFLICT"
    mixed = client.post("/v1/cart/lines", json={"product_id": "ck-hummus", "cart_revision": 1},
                        headers={"Idempotency-Key": "three"})
    assert mixed.status_code == 409
    assert mixed.json()["detail"]["code"] == "CART_MERCHANT_MISMATCH"


@pytest.mark.parametrize("extra", [{"user_id": "victim"}, {"price_cents": 1}, {"merchant_id": "fake"},
                                   {"quantity": 1.5}, {"quantity": True}, {"selections": ["unknown"]}])
def test_client_identity_prices_and_unsupported_options_are_rejected(cart_client, extra):
    client, repo, _ = cart_client
    response = client.post("/v1/cart/lines", json={"product_id": "cheese-pizza-slice", "cart_revision": 0, **extra},
                           headers={"Idempotency-Key": "one"})
    assert response.status_code == 422
    assert not repo.carts


def test_mutations_require_a_safe_idempotency_key(cart_client):
    client, _, _ = cart_client
    for headers in [{}, {"Idempotency-Key": " "}, {"Idempotency-Key": "bad,key"}]:
        assert client.post("/v1/cart/clear", json={"cart_revision": 0}, headers=headers).status_code == 422


def test_cart_routes_require_real_authentication(client, supabase_on, monkeypatch):
    monkeypatch.setattr(config, "SERVER_CART_ENABLED", True)
    assert client.get("/v1/cart").status_code == 401

    class Client:
        async def get(self, *args, **kwargs):
            return httpx.Response(401, json={})

    monkeypatch.setattr(auth, "client", Client())
    assert client.post("/v1/cart/clear", json={"cart_revision": 0},
                       headers={"Authorization": "Bearer forged", "Idempotency-Key": "one"}).status_code == 401
