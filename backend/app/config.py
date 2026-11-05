"""Environment configuration. All values come from backend/.env (gitignored)
or the process environment; every feature degrades gracefully when its key is
absent, mirroring the apps' demo-mode philosophy."""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def _env(name: str) -> str:
    """Read an env var, stripping surrounding whitespace.

    The strip matters in hosted environments: keys are pasted into a dashboard
    field by hand, and a trailing space or newline rides along invisibly. These
    values go straight into PostgREST's `apikey` / `Authorization` headers
    (postgrest.py), so a single stray character turns every request into a 401
    that surfaces as an opaque 502 — while `/health` still cheerfully reports
    `supabaseConfigured: true`, because the value is merely non-empty.
    """
    return (os.getenv(name) or "").strip()


def _env_int(name: str, default: int) -> int:
    try:
        return int(_env(name))
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(_env(name))
    except ValueError:
        return default


SUPABASE_URL = _env("SUPABASE_URL").rstrip("/")
SUPABASE_ANON_KEY = _env("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = _env("SUPABASE_SERVICE_ROLE_KEY")

# ── Goer (the multi-agent ordering chatbot) ───────────────────────────────────
# Groq serves the agents; `llama-3.1-8b-instant` is fast enough that a turn can
# run the guard, the router, and a specialist back to back without the chat
# feeling sluggish.
GROQ_API_KEY = _env("GROQ_API_KEY")
GOER_MODEL = _env("GOER_MODEL") or "llama-3.1-8b-instant"
GOER_TEMPERATURE = _env_float("GOER_TEMPERATURE", 0.4)
GOER_MAX_TOKENS = _env_int("GOER_MAX_TOKENS", 700)
# Conversation turns handed to the model. Kept short deliberately: the live
# cart/tip/address state is rebuilt into every system prompt, so old turns add
# latency more than context.
GOER_MAX_HISTORY = _env_int("GOER_MAX_HISTORY", 12)
# Where ChromaDB persists the menu/FAQ embeddings. Blank uses app/goer/chroma_db.
CHROMA_PATH = _env("CHROMA_PATH")

# ── Stripe (checkout) ─────────────────────────────────────────────────────────
# The secret key must never reach the client bundle — the app only ever sees
# the publishable key, handed to it by POST /payments/intent. The webhook
# secret is separate from both and comes from the endpoint's own settings page.
STRIPE_SECRET_KEY = _env("STRIPE_SECRET_KEY")
STRIPE_PUBLISHABLE_KEY = _env("STRIPE_PUBLISHABLE_KEY")
STRIPE_WEBHOOK_SECRET = _env("STRIPE_WEBHOOK_SECRET")

# ── Outbound email (delivery receipts) ────────────────────────────────────────
# Used for exactly one thing today: mailing the customer the photo the driver
# took of their order at pickup. Plain SMTP over stdlib `smtplib` rather than a
# provider SDK — one dependency-free module, and any provider (Gmail app
# password, SES, Resend, Postmark, Mailgun) speaks it.
SMTP_HOST = _env("SMTP_HOST")
SMTP_PORT = _env_int("SMTP_PORT", 587)
SMTP_USER = _env("SMTP_USER")
SMTP_PASSWORD = _env("SMTP_PASSWORD")
# Envelope sender. Falls back to SMTP_USER, which is what most providers require
# the From address to match anyway.
SMTP_FROM = _env("SMTP_FROM") or SMTP_USER
SMTP_FROM_NAME = _env("SMTP_FROM_NAME") or "LocalGO"
# STARTTLS on 587 (the default) vs. implicit TLS on 465.
SMTP_USE_SSL = _env("SMTP_USE_SSL").lower() in ("1", "true", "yes")

SERVER_CART_ENABLED = _env("SERVER_CART_ENABLED").lower() == "true"

SUPABASE_CONFIGURED = bool(SUPABASE_URL and SUPABASE_ANON_KEY)
# Every piece must be present: a half-configured mailer would raise inside the
# status endpoint on every pickup instead of quietly skipping the receipt.
EMAIL_CONFIGURED = bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD and SMTP_FROM)
GOER_CONFIGURED = bool(GROQ_API_KEY)
# Checkout needs both halves of the pair: the secret to create the intent, the
# publishable to let the app's PaymentSheet talk to Stripe directly.
STRIPE_CONFIGURED = bool(STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY)
