import pytest
from stub_llm import StubLLM, prompt_text

from goer_localgo.flow import routing


@pytest.mark.parametrize('intent', ['discovery', 'cart', 'unsupported'])
def test_router_uses_typed_bounded_call(monkeypatch, intent):
    stub = StubLLM(responses=[{'intent': intent}])
    settings = []
    def factory(**kwargs):
        settings.append(kwargs)
        return stub
    monkeypatch.setattr(routing, 'get_llm', factory)
    assert routing.classify('customer request', '{"last_shown_products":[]}') == intent
    assert settings[0]['timeout'] == 20
    assert settings[0]['temperature'] == 0
    assert stub.calls[0]['response_model'] is routing.Intent
    assert 'customer request' in prompt_text(stub.calls[0])
