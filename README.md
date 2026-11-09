# LocalGo

This repository contains the LocalGo consumer app and its two Python services. One Git commit can now identify the app, backend, and Goer versions used together. They still run and deploy separately.

| Component | Directory | Local command |
|---|---|---|
| Expo consumer app | repository root | `npm install`, then `npx expo start` |
| LocalGo API, carts, payments, orders | `backend/` | `cd backend`, install `requirements.txt`, then `uvicorn app.main:app --port 8100` |
| Goer CrewAI discovery and cart planning | `goer/` | `cd goer`, then `uv run uvicorn goer_localgo.api.main:app --port 8000` |

See [backend/README.md](backend/README.md), [goer/README.md](goer/README.md), and [Goer's cart integration runbook](goer/docs/cart-integration-runbook.md) for configuration and activation. Keep service secrets in their respective private environments; the app uses only `EXPO_PUBLIC_*` configuration. The services have independent databases and deployment settings.

The Expo app remains at the repository root. `.easignore` excludes `backend/` and `goer/` from EAS app builds. `render.yaml` configures the LocalGo backend with `rootDir: backend`; Goer requires its own service configuration with root directory `goer` before deployment. No deployment is implied by the source import.

CI is split by path: `app-tests.yml` for the app, `backend-tests.yml` for the backend, and `goer-tests.yml` for Goer. Run Goer tests from `goer/` with `uv run python -m pytest tests -v`.
