# Goer AI Agent Coordination

This file is the shared coordination log for agents working in this repository.
Update it whenever you start, change, validate, or finish work.

## Collaboration rules

- Before editing, add an entry under **Active work** with your name, date, files,
  goal, and status.
- Do not edit files listed as actively owned by another agent without first
  coordinating in this file.
- Keep changes focused and record tests, blockers, and handoff details.
- Move completed entries to **Recent work** instead of deleting the history.
- Refresh the active entry before ending your task so another agent can continue.

## Active work

| Agent | Date | Files | Goal | Status |
|---|---|---|---|---|
| Copilot | 2026-11-03 | `backend/app/web.py`, `backend/app/web/index.html`, `README.md` | Add a browser UI and FastAPI endpoint for testing Goer prompts | Complete; committed as `43af98f` |
| Copilot | 2026-11-03 | `docs/goer-agentic-architecture-plan.md`, `AGENTS.md` | Commit pending documentation changes and push the project to `dev` | Complete; documentation committed as `9de06c8`; pushing `dev` |
| Copilot | 2026-11-03 | `AGENTS.md` | Add strict one-change-per-commit workflow rule | In progress |

## Recent work

- 2026-11-03: Added the browser chat UI, `/api/chat`, and `/health`. The UI
  reuses the existing Groq model flow and menu tools. It requires
  `backend/.env` with `GROQ_API_KEY`.
- 2026-11-03: Updated the delivery-agent architecture plan with guard,
  orchestrator, specialist agents, cart, checkout, payment, order lifecycle,
  persistence, and observability design. Committed as `9de06c8`.
