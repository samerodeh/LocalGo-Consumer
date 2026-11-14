"""Real HTTP through Postman + disposable PostgreSQL. Never targets production."""

import os, uuid, subprocess
from datetime import datetime, timezone, timedelta
import httpx

BASE = os.getenv("CONSUMER_TEST_API", "http://127.0.0.1:18084")
assert BASE.startswith(("http://127.0.0.1:", "http://localhost:"))
client = httpx.Client(base_url=BASE, timeout=20)
customer = {"Authorization": "Bearer simulation-customer"}
other = {"Authorization": "Bearer simulation-other"}
driver = {"Authorization": "Bearer simulation-driver"}
checks = 0


def check(value, message):
    global checks
    assert value, message
    checks += 1


def sql(query):
    return subprocess.check_output(
        [
            "/opt/homebrew/opt/postgresql@16/bin/psql",
            "-h",
            "127.0.0.1",
            "-p",
            "55439",
            "-d",
            "localgo_consumer_ux_test",
            "-qAt",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            query,
        ],
        text=True,
    ).strip()


check(client.get("/consumer/catalog").status_code == 200, "catalog")
check(
    client.post("/consumer/quote", json={}).status_code in (401, 422),
    "quote fails unauthenticated",
)
promo_code = "TEST_" + uuid.uuid4().hex[:12].upper()
sql(
    f"insert into consumer_promotions(code,active,kind,amount,minimum_cents,usage_limit) values('{promo_code}',true,'percent',20,1000,1)"
)
body = {
    "merchantId": "al-taib",
    "mode": "delivery",
    "tipCents": 225,
    "items": [{"productId": "create-your-bowl-500-g", "quantity": 1}],
    "promoCode": promo_code,
}
quote = client.post("/consumer/quote", json=body, headers=customer)
check(quote.status_code == 200, f"quote {quote.text}")
check(quote.json()["totalCents"] == 1725, "server pricing/promo/tip")
check(
    client.post(
        "/consumer/quote", json={**body, "totalCents": 1}, headers=customer
    ).status_code
    == 422,
    "reject caller totals",
)
check(
    client.post(
        "/consumer/quote",
        json={**body, "items": [{"productId": "bad-id", "quantity": 1}]},
        headers=customer,
    ).status_code
    == 422,
    "unknown product",
)
check(
    client.post(
        "/consumer/quote", json={**body, "promoCode": "INVALID"}, headers=customer
    ).status_code
    == 422,
    "unknown promo",
)
order_id = str(uuid.uuid4())
checkout = {
    **body,
    "id": order_id,
    "expectedTotalCents": 1725,
    "customerName": "Local fixture",
    "address": {
        "addressLine": "1510 De Maisonneuve Ouest",
        "latitude": 45.496339,
        "longitude": -73.578666,
        "instructions": "Ring bell",
        "entryCode": "1234",
        "preference": "Leave at door",
    },
}
check(
    client.post(
        "/consumer/checkout",
        json={**checkout, "expectedTotalCents": 1},
        headers=customer,
    ).status_code
    == 409,
    "quote mismatch",
)
placed = client.post("/consumer/checkout", json=checkout, headers=customer)
check(placed.status_code == 200, f"checkout {placed.text}")
check(
    client.post("/consumer/checkout", json=checkout, headers=customer).json()
    == placed.json(),
    "idempotent retry",
)
check(
    sql(f"select count(*) from consumer_promo_redemptions where order_id='{order_id}'")
    == "1",
    "single redemption",
)
check(
    sql(f"select driver_pay_cents from orders where id='{order_id}'") == "725",
    "courier base+tip",
)
check(
    client.get(f"/consumer/orders/{order_id}", headers=other).status_code == 404,
    "private receipt",
)
check(
    client.post(
        f"/consumer/orders/{order_id}/review", json={"rating": 5}, headers=customer
    ).status_code
    == 409,
    "review before delivery",
)
sql(
    f"update orders set accepted_by='22222222-2222-4222-8222-222222222222',delivery_status='accepted' where id='{order_id}'"
)
position = {
    "latitude": 45.496,
    "longitude": -73.578,
    "accuracy": 10,
    "recordedAt": datetime.now(timezone.utc).isoformat(),
}
check(
    client.post(
        f"/consumer/orders/{order_id}/location", json=position, headers=customer
    ).status_code
    == 403,
    "customer cannot publish courier position",
)
r = client.post(f"/consumer/orders/{order_id}/location", json=position, headers=driver)
check(r.status_code == 200, f"driver publishes {r.text}")
check(
    client.get(f"/consumer/orders/{order_id}", headers=customer).json()[
        "courierLocation"
    ]["latitude"]
    == position["latitude"],
    "persisted position visible",
)
check(
    client.post(
        f"/consumer/orders/{order_id}/location",
        json={
            **position,
            "recordedAt": (
                datetime.now(timezone.utc) - timedelta(minutes=5)
            ).isoformat(),
        },
        headers=driver,
    ).status_code
    == 422,
    "stale rejected",
)
sql(f"update orders set delivery_status='delivered' where id='{order_id}'")
check(
    client.get(f"/consumer/orders/{order_id}", headers=customer).json()[
        "courierLocation"
    ]
    is None,
    "position hidden after completion",
)
check(
    client.post(
        f"/consumer/orders/{order_id}/review", json={"rating": 5}, headers=customer
    ).status_code
    == 200,
    "verified review",
)
check(
    client.post(
        f"/consumer/orders/{order_id}/review", json={"rating": 1}, headers=customer
    ).status_code
    == 409,
    "duplicate review",
)
pickup_id = str(uuid.uuid4())
pickup = {
    **body,
    "id": pickup_id,
    "mode": "pickup",
    "promoCode": None,
    "expectedTotalCents": 1250,
}
r = client.post("/consumer/checkout", json=pickup, headers=customer)
check(r.status_code == 200, f"pickup {r.text}")
check(
    sql(f"select count(*) from orders where id='{pickup_id}'") == "0",
    "pickup isolated from dispatch",
)
check(
    client.post(
        f"/consumer/merchant/orders/{pickup_id}/status",
        json={"status": "ready"},
        headers=customer,
    ).status_code
    == 403,
    "staff authorization",
)
check(
    client.post(
        f"/consumer/merchant/orders/{pickup_id}/status",
        json={"status": "completed"},
        headers=other,
    ).status_code
    == 409,
    "cannot skip pickup stage",
)
for status in ["preparing", "ready", "completed"]:
    check(
        client.post(
            f"/consumer/merchant/orders/{pickup_id}/status",
            json={"status": status},
            headers=other,
        ).status_code
        == 200,
        f"pickup {status}",
    )
    check(
        client.get(f"/consumer/orders/{pickup_id}", headers=customer).json()["status"]
        == status,
        "pickup tracking",
    )
history = client.get("/consumer/orders", headers=customer)
check(history.status_code == 200, "batched order history")
check(
    any(order["id"] == pickup_id for order in history.json()["orders"]),
    "history includes own pickup receipt",
)
check(
    client.get("/consumer/orders", headers=other).json()["orders"] == [],
    "history excludes another customer",
)
print(f"PASS: {checks} real HTTP checks against Postman + disposable PostgreSQL")
