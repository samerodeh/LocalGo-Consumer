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


SUPABASE_URL = _env("SUPABASE_URL").rstrip("/")
SUPABASE_ANON_KEY = _env("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = _env("SUPABASE_SERVICE_ROLE_KEY")
GROQ_API_KEY = _env("GROQ_API_KEY")

SUPABASE_CONFIGURED = bool(SUPABASE_URL and SUPABASE_ANON_KEY)


# Legacy client-priced orders are permitted only in an explicitly configured
# development environment. Never enable this on the public service.
APP_ENV = _env("APP_ENV") or "production"
ALLOW_DEMO_ORDERS = APP_ENV == "development" and _env("ALLOW_DEMO_ORDERS").lower() == "true"
CORS_ORIGINS = [value.strip() for value in _env("CORS_ORIGINS").split(",") if value.strip()]

# Business rule confirmed by Samer: CAD $5 flat per delivery.
DRIVER_GUARANTEED_PAY_CENTS = 500
DRIVER_SUPPORT_EMAIL = _env("DRIVER_SUPPORT_EMAIL") or "samerodeh.dev@gmail.com"
