"""Account deletion — required by Google Play for any app offering sign-up.

Policy implemented here (matches privacy-policy.html §7 and §9): the person is
erased, the transaction is kept. Orders survive as anonymized business records —
you need them for accounting, and the driver who delivered them has a legitimate
record too — but nothing on the row identifies the customer any more.

    orders          scrubbed: customer_id nulled, name and dropoff address
                    redacted. The row's money and timestamps stay.
    messages        the customer's own chat messages are deleted outright.
                    No FK, so nothing would have removed them otherwise.
    customers       deleted by cascade (FK to auth.users)
    push_tokens     deleted by cascade (FK to auth.users)
    auth.users      deleted last, via the Auth admin API
    AsyncStorage    cleared on the device by the caller (src/lib/account.ts)

Order matters: the scrub runs BEFORE the auth user is deleted. `orders.customer_id`
has no foreign key, so deleting the user first would leave rows pointing at a uid
that no longer exists — still personal data, now unreachable by this endpoint.
"""

from fastapi import APIRouter, Header, HTTPException

from .. import config
from ..postgrest import REST_URL, bearer_from, client, headers

router = APIRouter(prefix="/account")

AUTH_URL = f"{config.SUPABASE_URL}/auth/v1"

REDACTED_NAME = "Deleted customer"
REDACTED_ADDRESS = "[address removed at customer request]"


def _require_admin() -> None:
    if not config.SUPABASE_CONFIGURED:
        raise HTTPException(503, "Accounts are not configured on the backend")
    if not config.SUPABASE_SERVICE_ROLE_KEY:
        # Deleting an auth user and scrubbing rows both need to bypass RLS.
        raise HTTPException(503, "Account deletion is unavailable — server is missing its key")


async def _verify_caller(authorization: str | None) -> str:
    """Return the caller's verified Supabase uid, or raise 401.

    Deliberately NOT postgrest.jwt_sub: that decodes without checking the
    signature, which is fine for a query filter but catastrophic here — a forged
    token would let anyone delete anyone's account. Asking Supabase Auth to
    resolve the token is what actually verifies it.
    """
    bearer = bearer_from(authorization)
    if not bearer:
        raise HTTPException(401, "You must be signed in to delete your account")

    try:
        res = await client.get(
            f"{AUTH_URL}/user",
            headers={"apikey": config.SUPABASE_ANON_KEY, "Authorization": f"Bearer {bearer}"},
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[account] auth lookup failed: {type(exc).__name__}: {exc}")
        raise HTTPException(502, "Could not verify your session. Try again.") from None

    if res.status_code != 200:
        raise HTTPException(401, "Your session is no longer valid. Sign in again.")

    uid = res.json().get("id")
    if not uid:
        raise HTTPException(401, "Your session is no longer valid. Sign in again.")
    return str(uid)


@router.delete("")
async def delete_account(authorization: str | None = Header(default=None)):
    _require_admin()
    uid = await _verify_caller(authorization)

    # 1. Anonymize this customer's orders. Service-role: the anon role can't
    #    update orders, and we are deliberately bypassing RLS to reach rows the
    #    user is about to lose access to.
    try:
        scrub = await client.patch(
            f"{REST_URL}/orders",
            params={"customer_id": f"eq.{uid}"},
            headers=headers(service=True, prefer="return=minimal"),
            json={
                "customer_id": None,
                "customer_name": REDACTED_NAME,
                "dropoff_address": REDACTED_ADDRESS,
            },
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[account] order scrub threw: {type(exc).__name__}: {exc}")
        raise HTTPException(502, "Could not complete deletion. Nothing was changed.") from None

    if scrub.status_code not in (200, 204):
        print(f"[account] order scrub failed {scrub.status_code} {scrub.text[:200]}")
        # Stop here rather than deleting the account and stranding identifiable
        # rows we can no longer find by uid.
        raise HTTPException(502, "Could not complete deletion. Nothing was changed.")

    # 2. The customer's own chat messages. `messages.sender_id` has no foreign
    #    key, so nothing cascades these away. The driver's replies stay attached
    #    to the now-anonymous order as part of their delivery record.
    try:
        await client.delete(
            f"{REST_URL}/messages",
            params={"sender_id": f"eq.{uid}"},
            headers=headers(service=True, prefer="return=minimal"),
        )
    except Exception as exc:  # noqa: BLE001
        # Non-fatal: the account still gets deleted. Logged so it can be swept.
        print(f"[account] message delete failed for {uid}: {type(exc).__name__}: {exc}")

    # 3. The account itself. Cascades to `customers` and `push_tokens`, both of
    #    which reference auth.users with ON DELETE CASCADE.
    try:
        gone = await client.delete(
            f"{AUTH_URL}/admin/users/{uid}",
            headers=headers(service=True),
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[account] auth delete threw: {type(exc).__name__}: {exc}")
        raise HTTPException(502, "Your data was removed but the account could not be closed.") from None

    if gone.status_code not in (200, 204):
        print(f"[account] auth delete failed {gone.status_code} {gone.text[:200]}")
        raise HTTPException(502, "Your data was removed but the account could not be closed.")

    print(f"[account] deleted {uid}; orders anonymized, messages removed")
    return {"deleted": True}
