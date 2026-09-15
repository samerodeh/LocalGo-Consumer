"""LocalGO backend — Python/FastAPI.

One service backs BOTH React Native apps:
  * LocalGOConsumerRN — POST /orders (dispatch, with server-side delivery-
    location validation), the Goer chatbot (POST /goer/chat[/stream]),
    POST /notify.
  * LocalGODriverRN   — GET /orders/feed, POST /orders/{id}/accept,
    POST /orders/{id}/status, POST /notify.

It replaces the TypeScript/Deno Supabase edge functions (goer-chat,
notify-push) and the apps' direct PostgREST data access. Supabase stays as the
Postgres + Auth provider underneath; driver endpoints forward the caller's
Supabase Auth JWT so every RLS policy applies unchanged.

Run:  uvicorn app.main:app --host 0.0.0.0 --port 8000   (from backend/)
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .routers import account, goer, notify, orders, payments


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Embed the menu and FAQ into ChromaDB once at boot. Upserts, so a restart
    # after a menu edit refreshes the index and an unchanged menu costs nothing.
    #
    # Skipped entirely when Goer has no API key: retrieval only feeds the
    # chatbot's agents, which cannot answer without GROQ_API_KEY anyway. This is
    # not just an optimization — the build downloads Chroma's ~80 MB ONNX
    # embedder and holds the model in memory, which is enough to OOM a 512 MB
    # free instance. An OOM is a SIGKILL, so the except below would NOT catch
    # it: the process dies, the health check fails, and the platform keeps
    # serving the previous build while the new code appears to have vanished.
    #
    # Checkout and order dispatch never touch retrieval — pricing reads its own
    # committed app/menu_prices.json.
    if not config.GOER_CONFIGURED:
        print("[startup] Goer not configured — skipping RAG index build")
    else:
        try:
            from .goer.rag import build_index

            build_index()
        except Exception as exc:
            print(f"[startup] Goer RAG index unavailable ({type(exc).__name__}: {exc})")
    yield


app = FastAPI(title="LocalGO Backend", version="1.1.0", lifespan=lifespan)

# Same posture as the edge functions: public demo endpoints, CORS wide open
# so the Expo web preview works.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(orders.router)
app.include_router(goer.router)
app.include_router(notify.router)
app.include_router(payments.router)
app.include_router(account.router)


@app.get("/health")
def health():
    return {
        "ok": True,
        "supabaseConfigured": config.SUPABASE_CONFIGURED,
        "pushConfigured": bool(config.SUPABASE_SERVICE_ROLE_KEY),
        "goerConfigured": config.GOER_CONFIGURED,
        "goerModel": config.GOER_MODEL,
        # Whether the pickup-photo receipt can actually be mailed. Same
        # reasoning as stripeConfigured: silently-off email is invisible from
        # the outside, and the only symptom is a customer who never got a photo.
        "emailConfigured": config.EMAIL_CONFIGURED,
        # Whether real payments are live. False means checkout silently runs in
        # demo mode and takes no money — the single most important thing to be
        # able to check on a deployed instance, and impossible to tell from the
        # outside otherwise. Reports only that keys are present, never a key.
        "stripeConfigured": config.STRIPE_CONFIGURED,
        "stripeMode": (
            "live" if config.STRIPE_SECRET_KEY.startswith("sk_live_")
            else "test" if config.STRIPE_SECRET_KEY.startswith("sk_test_")
            else "unset"
        ),
        "stripeWebhookConfigured": bool(config.STRIPE_WEBHOOK_SECRET),
    }
