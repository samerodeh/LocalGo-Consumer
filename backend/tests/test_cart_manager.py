import asyncio
from uuid import uuid4

import pytest

from app.auth import CustomerSession
from app.cart.manager import mutate_cart
from app.cart.models import Cart, CartCommand, CartError


class MemoryRepository:
    """Offline stand-in for the transactional RPC contract, not production storage."""
    def __init__(self):
        self.carts = {}
        self.receipts = {}
        self.lock = asyncio.Lock()

    async def load(self, owner, bearer):
        await asyncio.sleep(0)
        return self.carts.get(owner, Cart()).model_copy(deep=True)

    async def receipt(self, owner, key):
        await asyncio.sleep(0)
        return self.receipts.get((owner, key))

    async def commit(self, owner, revision, key, request_hash, cart):
        async with self.lock:
            saved = self.receipts.get((owner, key))
            if saved:
                if saved[0] != request_hash:
                    raise CartError("IDEMPOTENCY_CONFLICT", "Conflict")
                return saved[1]
            if self.carts.get(owner, Cart()).revision != revision:
                raise CartError("CART_REVISION_CONFLICT", "Conflict")
            self.carts[owner] = cart
            self.receipts[(owner, key)] = (request_hash, cart)
            return cart


def command(quantity=2, revision=0):
    return CartCommand(operation="add", product_id="cheese-pizza-slice",
                       quantity=quantity, cart_revision=revision)


def test_replay_returns_original_result_even_after_later_mutations():
    async def run():
        repo = MemoryRepository()
        user = CustomerSession(uuid4(), "token")
        first = await mutate_cart(repo, user, command(), "one")
        await mutate_cart(repo, user, command(1, 1), "two")
        replay = await mutate_cart(repo, user, command(), "one")
        assert replay == first
        assert repo.carts[user.user_id].lines[0].quantity == 3
        with pytest.raises(CartError) as exc:
            await mutate_cart(repo, user, command(3), "one")
        assert exc.value.code == "IDEMPOTENCY_CONFLICT"
    asyncio.run(run())


def test_concurrent_duplicates_and_owner_isolation():
    async def run():
        repo = MemoryRepository()
        user = CustomerSession(uuid4(), "token")
        responses = await asyncio.gather(*[mutate_cart(repo, user, command(), "same") for _ in range(5)])
        assert all(response == responses[0] for response in responses)
        assert repo.carts[user.user_id].revision == 1
        assert repo.carts[user.user_id].lines[0].quantity == 2
        other = CustomerSession(uuid4(), "other-token")
        assert (await mutate_cart(repo, other, command(), "same")).revision == 1
        assert len(repo.carts) == 2
    asyncio.run(run())


def test_concurrent_distinct_writes_only_one_wins():
    async def run():
        repo = MemoryRepository()
        user = CustomerSession(uuid4(), "token")
        results = await asyncio.gather(mutate_cart(repo, user, command(), "one"),
                                       mutate_cart(repo, user, command(), "two"), return_exceptions=True)
        assert sum(isinstance(result, Cart) for result in results) == 1
        assert sum(isinstance(result, CartError) for result in results) == 1
        assert repo.carts[user.user_id].revision == 1
    asyncio.run(run())
