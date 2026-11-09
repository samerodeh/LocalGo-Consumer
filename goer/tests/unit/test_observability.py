from goer_localgo import observability


def test_mask_redacts_tokens_keys_and_emails_recursively():
    data = {
        "auth": "Bearer abc.def.ghi-123",
        "nested": ["contact me at jane.doe@example.com", {"key": "sk-proj-ABCDEFGHIJKLMNOP"}],
        "jwt": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature",
        "count": 3,
    }
    masked = observability.mask(data)
    text = str(masked)
    assert "abc.def" not in text and "jane.doe" not in text
    assert "ABCDEFGHIJKLMNOP" not in text and "eyJhbGci" not in text
    assert masked["count"] == 3


def test_mask_keeps_ordinary_chat_text():
    assert observability.mask("show me pizza at Al-Taib") == "show me pizza at Al-Taib"


def test_pseudonymous_user_is_stable_and_not_the_raw_id():
    raw = "6f1c2c1e-0000-4000-8000-000000000001"
    assert observability.pseudonymous_user(raw) == observability.pseudonymous_user(raw)
    assert raw not in observability.pseudonymous_user(raw)


def test_tracing_is_a_no_op_when_otel_disabled(monkeypatch):
    # conftest sets OTEL_SDK_DISABLED=true; even with keys present nothing is exported.
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-lf-test")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-lf-test")
    monkeypatch.setattr(observability, "_initialized", False)
    monkeypatch.setattr(observability, "_client", None)
    with observability.turn_trace("t", conversation_id="c", user_id="u", message="hi",
                                  tags=["guest"]) as trace:
        trace.update(output={"text": "ok"})
        with trace.step("route-intent") as step:
            step.update(output={"intent": "discovery"})
    assert observability._client is None
