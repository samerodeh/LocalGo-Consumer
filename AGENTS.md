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
- **Strict commit rule:** every individual code change, function, or documentation
  change must be committed immediately in its own focused commit. Never batch
  unrelated changes or thousands of changes into one commit.

## Active work

| Agent | Date | Files | Goal | Status |
|---|---|---|---|---|
| Antigravity | 2026-11-03 | `pyproject.toml`, `src/`, `tests/`, `backend/`, `goer_localgo/`, `README.md`, `AGENTS.md` | Promote CrewAI project to repository root, remove legacy backend, add interactive CLI, and update tests/docs | Active; migrating project structure |

## Recent work

- 2026-11-03: Added the browser chat UI, `/api/chat`, and `/health`. The UI
  reuses the existing Groq model flow and menu tools. It requires
  `backend/.env` with `GROQ_API_KEY`.
- 2026-11-03: Updated the delivery-agent architecture plan with guard,
  orchestrator, specialist agents, cart, checkout, payment, order lifecycle,
  persistence, and observability design. Committed as `9de06c8`.
- 2026-11-03: Added the OpenAI SDK + FastAPI architecture plan, mapping
  LocalGo's restaurants, menus/options, cart, addresses, payment, orders,
  dispatch, auth, and realtime data into a modular monolith. Committed as
  `d029f1c`; no implementation started.
- 2026-11-03: Added the required per-tool smoke-test convention under
  `tools/try-out-tools` and top-level `Tests/unit` plus `Tests/integration`
  coverage requirements to the OpenAI/FastAPI architecture plan.
- 2026-11-03: Made the target implementation OpenAI Python SDK-only, with
  `AsyncOpenAI`, Responses API, Pydantic-generated schemas, typed SDK tool
  parameters, and no hand-written raw tool dictionaries. Committed as
  `142f832`; current Groq prototype remains unchanged until migration work.
- 2026-11-03: Converted the architecture plan to a CrewAI Flow + FastAPI
  project, replacing direct OpenAI SDK/tool-loop ownership with CrewAI agents,
  tasks, typed `BaseTool` tools, Flow state, and CrewAI scaffolding. Committed
  as `439d734`; no implementation started.
- 2026-11-03: Scaffolded `goer_localgo` with the CrewAI CLI, copied the LocalGo
  menu catalog, migrated menu tools to CrewAI `BaseTool`, added a discovery
  Flow and FastAPI adapter, and added unit/integration/smoke tests. CrewAI 1.14.4
  is installed; `uv run pytest Tests -q` passes 5 tests. Commits `53594c2` and
  `f58e340`.
- 2026-11-03: Restored the deleted `goer_localgo` CrewAI project and transferred
  the Goer browser UI and API routes into it. Added `/`, `/api/chat`, the
  environment template, migration documentation, and API coverage. `uv run
  pytest tests -q` passes 7 tests. Commits `15acb94`, `5b5d4d4`, `cd7afd7`,
  `35fc9d1`, `4f40931`, and `a3a5110`.
