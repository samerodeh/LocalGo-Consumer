from uuid import uuid4

from goer_localgo import main


def test_cli_reuses_one_conversation(monkeypatch):
    conversation_id = str(uuid4())
    messages = iter(["pizza", "the second one", "exit"])
    calls = []
    monkeypatch.setattr(main, "create_conversation", lambda: conversation_id)
    monkeypatch.setattr("builtins.input", lambda prompt: next(messages))

    def reply(message, **kwargs):
        calls.append((message, kwargs["conversation_id"]))
        return "Hello."

    monkeypatch.setattr(main, "run_turn", reply)
    main.interactive_cli()
    assert calls == [("pizza", conversation_id), ("the second one", conversation_id)]
