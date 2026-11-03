# Goer CrewAI + FastAPI Architecture Plan

> **Superseded** by [localgo-delivery-architecture-plan.md](localgo-delivery-architecture-plan.md).
> Kept for history; paths such as `backend/` and `Tests/` are outdated.

## Goal

Evolve Goer from the current Groq-backed menu prototype into a CrewAI Flow
served by FastAPI that can safely use the data and workflows already present in
LocalGo. The first release should preserve the existing LocalGo contracts
instead of creating a second catalog, cart, address book, payment record, or
order system.

The target is a modular monolith: one deployable FastAPI application with
explicit domain services, a CrewAI Flow for stateful orchestration, and
Supabase/Postgres as the authoritative persistence layer.

## Non-negotiable CrewAI policy

All agent orchestration, task execution, model calls, structured output, and
tool registration in the target project must use CrewAI abstractions. Use a
CrewAI Flow as the application workflow and CrewAI `Agent`, `Task`, `Crew`,
`LLM`, and `BaseTool` APIs as appropriate. Do not import `openai` directly in
application code, hand-roll an OpenAI tool loop, or add LangChain-based agent
logic.

The current Groq prototype is compatibility/reference code only. Before the
new architecture is implemented, replace its client and model loop with a
CrewAI Flow. The model provider is configured through CrewAI's `LLM` interface
and environment settings; domain code must not depend on a provider SDK.

Start implementation by scaffolding with:

```bash
crewai create flow goer_localgo
```

Do not manually recreate the CrewAI scaffold. Modify the generated Flow,
`pyproject.toml`, package structure, and configuration after scaffolding.

## Existing LocalGo data to preserve

The current LocalGo consumer and backend repositories expose these concepts:

| Domain | Existing shape/source | Goer responsibility |
|---|---|---|
| Restaurants | `Restaurant`: id, name, cuisine, address, images, rating, delivery metadata | Read and summarize; never invent availability |
| Menu items | `MenuItem`: id, name, category, price, description, image, option groups | Search, explain, and resolve item IDs |
| Options | `MenuOptionGroup` and `MenuOptionChoice`: required/single/multiple choices and price deltas | Collect valid selections and calculate no totals in the model |
| Cart | `CartLine`: item, quantity, selections, notes, unique line ID | Read and mutate through validated cart service |
| Users | Supabase Auth identity plus LocalGo profile fields | Bind every conversation and mutation to the authenticated user |
| Addresses | Saved address, coordinates, delivery preference, instructions, default flag | Select and validate a delivery destination |
| Payment methods | Tokenized-card placeholder with brand and last four digits | Display only safe summaries; never accept PAN/CVV in chat |
| Orders | Order record with item snapshots, money in cents, address snapshot, payment intent ID | Read status and initiate supported actions |
| Driver dispatch | `/orders`, `/orders/feed`, accept/status endpoints, realtime overlays | Expose status from backend events, not model assumptions |
| Messages | Order-scoped customer/driver messages with optional media | Future support handoff and order communication |

The current Goer JSON menu is useful as a development fixture, but it must not
become a competing production source of truth.

## Proposed runtime architecture

```text
Client
  -> FastAPI API
     -> Auth/context middleware
     -> Conversation service
     -> Goer CrewAI Flow
        -> Input policy checks
        -> CrewAI router/orchestrator
        -> CrewAI agents and tasks
        -> Typed CrewAI tool gateway
           -> Catalog service
           -> Cart service
           -> Checkout/quote service
           -> Order/support service
     -> Output validation and response envelope
  -> Supabase Auth/Postgres/Realtime
  -> Payment and dispatch integrations
```

Keep the model boundary narrow. CrewAI agents may reason, select registered
tools, and compose text, but FastAPI and domain services own authentication,
authorization, validation, pricing, persistence, idempotency, and state
transitions.

## FastAPI package layout

```text
goer_localgo/
  src/goer_localgo/
    main.py               # Flow entry point and chat turn adapter
    flow/
      goer_flow.py        # state, routing, persistence, limits
    crews/
      discovery_crew/
      cart_crew/
      checkout_crew/
      support_crew/
    tools/
      catalog_tools.py
      cart_tools.py
      checkout_tools.py
      order_tools.py
      try-out-tools/
    domain/
      catalog/
      cart/
      checkout/
      orders/
      conversations/
    integrations/
      supabase.py
      payments.py
      dispatch.py
    schemas/
      chat.py
      catalog.py
      cart.py
      checkout.py
      orders.py
  api/
    main.py               # FastAPI adapter
    routes/
      chat.py
      catalog.py
      cart.py
      checkout.py
      orders.py
  Tests/
    unit/
    integration/
  pyproject.toml
```

Use Pydantic models at every API, CrewAI tool, Flow state, and integration
boundary. Keep database-row models separate from client response models so
legacy LocalGo field names can be adapted without leaking storage details into
prompts.

## CrewAI boundary

`GoerFlow` should expose one application-facing operation:

```python
async def handle_turn(
    self,
    message: str,
    session_id: str,
) -> ChatResponse:
    ...
```

The Flow should:

- use structured Pydantic state with a stable session/conversation ID;
- route each turn to discovery, cart, checkout, or support handling;
- call purpose-built CrewAI agents or crews with only the allowed tools;
- persist and restore conversation state through the Flow persistence strategy;
- enforce maximum handoffs, tool calls, iterations, latency, and output size;
- return a typed `ChatResponse` to the FastAPI adapter;
- record CrewAI events, task outputs, tool outcomes, and trace metadata.

Use one CrewAI `LLM` configuration initially. Add a smaller guard/classifier
agent only after evaluation demonstrates a benefit. Agents must never receive
service credentials, raw payment data, or unrestricted database access.

### Typed CrewAI tools

Agent tools must not be authored as raw OpenAI dictionaries. Define each tool
as a CrewAI `BaseTool` with a Pydantic `args_schema`, or use the CrewAI
`@tool` decorator when a small function is sufficient. The tool executes
deterministic Python service code:

```python
from crewai.tools import BaseTool
from pydantic import BaseModel, ConfigDict


class SearchMenuInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_name: str
    merchant_id: str | None = None


class SearchMenuTool(BaseTool):
    name: str = "search_menu"
    description: str = "Search LocalGo menu items by name."
    args_schema: type[BaseModel] = SearchMenuInput

    def _run(self, product_name: str, merchant_id: str | None = None) -> str:
        return search_menu_service(product_name, merchant_id)
```

The exact CrewAI tool signatures must be verified against the pinned CrewAI
version during implementation. Use `crewai.tools.BaseTool`, not
`crewai_tools.BaseTool`. Tool dispatch is handled by CrewAI; domain services
still validate ownership, business rules, and mutation authorization.

The `tools/try-out-tools` smoke tests must instantiate the CrewAI tool and call
its public `run`/execution contract with fixtures. They must not inspect or
construct raw OpenAI schema dictionaries.

## Chat contract

`POST /v1/conversations/{conversation_id}/turns` accepts authenticated user
messages and returns a versioned envelope:

```json
{
  "conversation_id": "conv_123",
  "turn_id": "turn_456",
  "text": "I found two options at Al Taib.",
  "cards": [
    {
      "type": "product_list",
      "items": [
        {
          "product_id": "item_123",
          "merchant_id": "al-taib",
          "name": "Chicken Shawarma",
          "price_cents": 1299,
          "currency": "CAD"
        }
      ]
    }
  ],
  "actions": [],
  "state": {"cart_id": "cart_123", "cart_revision": 4},
  "trace_id": "trace_789"
}
```

Cards and actions are generated from validated service results. The client
must not infer checkout or order state from prose.

Recommended endpoints:

| Endpoint | Purpose |
|---|---|
| `POST /v1/conversations` | Create or resume a user-owned conversation |
| `POST /v1/conversations/{id}/turns` | Run one bounded Goer turn |
| `GET /v1/conversations/{id}` | Load conversation summary and recent turns |
| `GET /v1/catalog/restaurants` | Direct, cacheable restaurant discovery |
| `GET /v1/catalog/restaurants/{id}/menu` | Direct menu/options retrieval |
| `GET/PATCH /v1/cart` | View or mutate the authenticated user's cart |
| `POST /v1/checkout/quotes` | Create an immutable server quote |
| `POST /v1/checkout/quotes/{id}/confirm` | Confirm the exact quote |
| `POST /v1/orders/{id}/cancellation` | Request a policy-checked cancellation |
| `GET /v1/orders` and `GET /v1/orders/{id}` | Read order history/status |

Mutation endpoints should accept an `Idempotency-Key` and return the recorded
result when a request is retried.

## Agent tools

The initial tool allowlist should be read-heavy:

- `search_restaurants`
- `search_menu`
- `get_product`
- `get_cart`
- `get_saved_addresses`
- `get_orders`
- `get_order_status`

Add mutations only through explicit, narrow tools:

- `add_cart_item`
- `update_cart_line`
- `remove_cart_line`
- `create_quote`
- `confirm_quote`
- `start_payment`
- `request_cancellation`

Each tool has a Pydantic input/output model, ownership check, business-rule
validation, stable error codes, and an audit record. Tools return compact
records with stable IDs; they do not return entire tables or unbounded menus.

### Tool implementation and test convention

Every new agent tool must be delivered with its own executable smoke test:

```text
backend/app/agent_tools/
  search_menu.py
  get_product.py
  tools/
    try-out-tools/
      search_menu_smoke.py
      get_product_smoke.py
```

The `tools/try-out-tools` directory is for fast, deterministic checks that
exercise the tool through its public input/output contract. Each smoke test
must cover a valid call, an empty/not-found result where applicable, and
invalid arguments or an authorization failure where the tool supports those
guards. Smoke tests must not call OpenAI, payment providers, or production
services; use fixtures or mocked repositories.

The repository also requires a top-level test suite separated by purpose:

```text
Tests/
  unit/
    test_catalog_tools.py
    test_cart_service.py
    test_quote_service.py
    test_tool_schemas.py
  integration/
    test_chat_api.py
    test_cart_checkout_flow.py
    test_order_dispatch_flow.py
    test_deployment_health.py
```

Unit tests validate pure domain logic, Pydantic schemas, tool dispatch, policy
checks, money calculations, and error mapping without network access.
Integration tests run the FastAPI application against isolated test
dependencies and verify authentication, database/repository boundaries,
CrewAI Flow routing, agent/task orchestration, idempotency, and deployment
health. Model calls, payment, notification, and dispatch calls must be mocked
or replaced with test adapters; a deployment smoke environment may use sandbox
credentials only in an explicitly configured CI job.

No tool is considered complete until its smoke test, focused unit tests, and
the relevant integration path pass in CI. The CI pipeline should run unit
tests on every change and integration/deployment tests on pull requests and
release candidates.

## Data ownership and migration strategy

1. **Catalog adapter:** replace the JSON loader with a repository interface.
   Implement a fixture repository first and a Supabase repository second. Map
   LocalGo's menu item/options into canonical `Product` and `OptionGroup`
   schemas while preserving source IDs.
2. **Restaurant adapter:** read existing restaurant/partner records and retain
   LocalGo IDs. Keep display metadata separate from availability and delivery
   eligibility.
3. **Cart service:** move cart mutations behind FastAPI. Store money in integer
   cents and snapshot selected option names and deltas on each line.
4. **Address service:** read user-owned saved addresses, validate coordinates
   server-side, and copy the selected address into the eventual order snapshot.
5. **Quote service:** calculate subtotal, option deltas, delivery fee, tip,
   taxes, and total deterministically. Return an expiring quote ID.
6. **Order service:** create orders only after exact quote confirmation and
   payment authorization. Preserve `payment_intent_id`, item snapshots, and
   address snapshots.
7. **Dispatch adapter:** call the existing LocalGo dispatch API or shared
   tables. Treat notification failures as observable best-effort work, not as
   evidence that order creation failed.
8. **Realtime:** keep Supabase Realtime for order/driver status delivery where
   the clients already depend on it; FastAPI remains the authority for writes.

Do not silently migrate client-local orders into server orders. Add an explicit
legacy/demo mode and a reconciliation job if historical data must be imported.

## Safety and authorization

- Verify the Supabase JWT and derive `user_id` server-side; never trust a user
  ID supplied in a prompt, card payload, or request body.
- Apply row ownership checks to conversations, carts, addresses, payment
  methods, and orders.
- Require confirmation of the displayed quote ID and total before payment/order
  mutation.
- Reject payment credentials, secrets, and unsupported sensitive data in chat.
- Treat product descriptions, restaurant text, and retrieved messages as
  untrusted content that cannot redefine tool policy.
- Redact tokens, addresses where unnecessary, and payment identifiers in logs.
- Use service-role credentials only inside server integrations and only where
  RLS cannot perform the required trusted write.

## Reliability and observability

Attach one trace ID to the HTTP request, model calls, tool calls, database
writes, quote, payment attempt, order, and dispatch event. Persist:

- conversation/turn metadata and compact messages;
- model request IDs, model name, token usage, latency, and errors;
- tool arguments/results after redaction;
- idempotency keys and mutation outcomes;
- quote expiration/confirmation;
- payment and order state transitions;
- dispatch and notification outcomes.

Use bounded retries only for safe reads and provider/network failures. For a
mutation timeout, query the idempotency record before retrying. Never retry
payment or order creation blindly.

## Implementation sequence

1. Scaffold a CrewAI Flow with `crewai create flow goer_localgo`; pin CrewAI
   and FastAPI versions and configure the selected CrewAI LLM.
2. Replace the Groq dependency and raw tool dictionaries with typed CrewAI
   `BaseTool` implementations while keeping the current menu fixture working.
3. Extract catalog repository interfaces and map LocalGo menu/options.
4. Add authenticated FastAPI conversation endpoints backed by the Flow and the
   versioned response envelope.
5. Add Supabase-backed catalog, conversation, and audit persistence.
6. Add read-only agents/tools and evaluation cases for restaurant/product
   grounding.
7. Move cart reads/mutations behind FastAPI and CrewAI tools with revision
   checks.
8. Add deterministic quotes, explicit confirmation, and payment integration.
9. Add order creation, dispatch integration, status reads, and cancellation
   policy.
9. Add streaming, realtime UX, tracing dashboards, and gradual rollout.

## Decisions requiring confirmation before implementation

- Which Supabase project/schema is the production LocalGo source of truth?
- Are restaurant/menu/options currently authoritative in Supabase, or must the
  existing client/static catalog be imported first?
- Should Goer support only authenticated users, or retain an anonymous demo
  mode for development?
- Which CrewAI-supported LLM and deployment environment should be the initial
  default?
- Should the first milestone stop at discovery/cart, or include quote/payment
  and order creation?
