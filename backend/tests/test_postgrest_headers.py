"""API keys identify the application; only JWTs belong in Authorization."""

import pytest

from app import config
from app.postgrest import headers


@pytest.mark.parametrize(
    "key,service,bearer,expected_token",
    [
        ("legacy-anon-jwt", False, None, "legacy-anon-jwt"),
        ("legacy-service-jwt", True, None, "legacy-service-jwt"),
        ("sb_publishable_example", False, None, None),
        ("sb_secret_example", True, None, None),
        ("sb_publishable_example", False, "customer-jwt", "customer-jwt"),
        ("sb_secret_example", True, "customer-jwt", "customer-jwt"),
    ],
)
def test_api_keys_and_user_bearers(monkeypatch, key, service, bearer, expected_token):
    monkeypatch.setattr(config, "SUPABASE_ANON_KEY", key if not service else "public-key")
    monkeypatch.setattr(config, "SUPABASE_SERVICE_ROLE_KEY", key if service else "private-key")
    result = headers(bearer, service=service, prefer="return=minimal")
    assert result["apikey"] == key
    assert result["Content-Type"] == "application/json"
    assert result["Prefer"] == "return=minimal"
    if expected_token is None:
        assert "Authorization" not in result
    else:
        assert result["Authorization"] == f"Bearer {expected_token}"
