"""Concurrent RPC assertions against the disposable consumer PostgreSQL DB only."""

import json
import subprocess
import uuid

PSQL = [
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
]


def sql(query):
    return subprocess.check_output([*PSQL, query], text=True).strip()


def call(body):
    encoded = json.dumps(body, ensure_ascii=False).replace("'", "''")
    return subprocess.Popen(
        [
            *PSQL,
            f"begin;set local role service_role;select pg_sleep(0.2);select consumer_checkout('{encoded}'::jsonb);commit;",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


code = "RACE_" + uuid.uuid4().hex[:12].upper()
ids = [str(uuid.uuid4()), str(uuid.uuid4())]
base = {
    "customer_id": "33333333-3333-4333-8333-333333333333",
    "merchant_id": "al-taib",
    "mode": "pickup",
    "customer_name": "Concurrency fixture",
    "items": ["1× Bowl"],
    "line_items": [{"productId": "create-your-bowl-500-g", "quantity": 1}],
    "quote": {
        "subtotalCents": 1250,
        "deliveryFeeCents": 0,
        "tipCents": 0,
        "discountCents": 100,
        "totalCents": 1150,
        "promoCode": code,
        "currency": "CAD",
    },
}
try:
    sql(
        f"insert into consumer_promotions(code,active,kind,amount,usage_limit) values('{code}',true,'fixed',100,1)"
    )
    jobs = [call({**base, "id": order_id}) for order_id in ids]
    results = [(job, job.communicate(timeout=20)) for job in jobs]
    assert sum(job.returncode == 0 for job, _ in results) == 1, (
        f"Exactly one limited promotion may be redeemed: {[(j.returncode, out[1]) for j, out in results]}"
    )
    assert any("Promotion exhausted" in output[1] for _, output in results), (
        "Losing checkout must fail atomically"
    )
    assert (
        sql(f"select count(*) from consumer_promo_redemptions where code='{code}'")
        == "1"
    )
    same = str(uuid.uuid4())
    ids.append(same)
    body = {
        **base,
        "id": same,
        "quote": {
            **base["quote"],
            "discountCents": 0,
            "totalCents": 1250,
            "promoCode": None,
        },
    }
    jobs = [call(body), call(body)]
    results = [(job, job.communicate(timeout=20)) for job in jobs]
    assert all(job.returncode == 0 for job, _ in results), (
        "Concurrent retries return the same successful receipt"
    )
    assert sql(f"select count(*) from consumer_receipts where id='{same}'") == "1"
    print("PASS: concurrent promotion limit and duplicate-checkout idempotency")
finally:
    quoted = ",".join("'" + value + "'" for value in ids)
    sql(
        f"delete from consumer_receipts where id in ({quoted});delete from consumer_promotions where code='{code}';"
    )
