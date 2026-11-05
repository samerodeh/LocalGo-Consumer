from uuid import uuid4
import pytest

from goer_localgo.domain.conversations import ConversationConflict, ConversationNotFound
from goer_localgo.domain.turns import TurnJournal, TurnPending
from goer_localgo.flow.goer_flow import create_conversation


def test_lease_fences_old_planner_and_persisted_plan_survives_new_worker():
    owner = str(uuid4())
    conversation = create_conversation(owner)
    request = str(uuid4())
    journal = TurnJournal()
    old = journal.begin(owner, conversation, request, 'add two')
    with pytest.raises(TurnPending):
        journal.begin(owner, conversation, request, 'add two')
    journal.release(old)
    current = TurnJournal().begin(owner, conversation, request, 'add two')
    with pytest.raises(TurnPending):
        journal.stage(old, {'command': 'must not execute'})
    plan = {'command': {'operation': 'add', 'cart_revision': 3}, 'request_key': 'immutable'}
    journal.stage(current, plan)
    journal.release(current)
    recovered = TurnJournal().begin(owner, conversation, request, 'add two')
    assert recovered.plan == plan
    with pytest.raises(ConversationConflict):
        journal.begin(owner, conversation, str(uuid4()), 'new edit')


def test_journal_owner_is_checked_before_replay():
    owner = str(uuid4())
    conversation = create_conversation(owner)
    with pytest.raises(ConversationNotFound):
        TurnJournal().begin(str(uuid4()), conversation, str(uuid4()), 'private cart')
