# Driver release HTTP simulation

The actual FastAPI process runs against a local Supabase HTTP stand-in and PostgreSQL RLS/RPCs. See docs/driver-release.md for setup. 30 HTTP checks passed on November 23, 2026 after atomic progress and service-owned insertion changes. Auth tokens, storage delivery and push are fixtures; no upstream was contacted. Logs include Auth, approval, dispatch, storage metadata, status and overlay traffic. The initial failure check caught an inherited success fallback on overlay outage; that path now fails the request.
