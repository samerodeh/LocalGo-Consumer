from goer_localgo import llm


def test_llm_clients_are_reused_but_turn_state_is_private(monkeypatch):
    monkeypatch.setattr(llm, "_base", {})
    first, second = llm.get_llm(), llm.get_llm()
    assert first is not second
    # The expensive HTTP clients are shared between turns...
    assert first._client is not None and first._client is second._client
    assert first._async_client is second._async_client
    # ...while attributes CrewAI sets per run do not leak into another turn.
    first.stop = ["Observation:"]
    assert second.stop != ["Observation:"]


def test_router_and_agent_settings_are_cached_separately(monkeypatch):
    monkeypatch.setattr(llm, "_base", {})
    router = llm.get_llm(temperature=0, timeout=20)
    agent = llm.get_llm()
    assert router.temperature == 0 and router.timeout == 20
    assert len(llm._base) == 2 and agent.temperature != 0
