# Goer OpenAI SDK + FastAPI Architecture Plan

## Goal

Evolve Goer from the current Groq-backed menu prototype into a FastAPI service
that can safely use the data and workflows already present in LocalGo. The
first release should preserve the existing LocalGo contracts instead of
creating a second catalog, cart, address book, payment record, or order system.

The target is a modular monolith: one deployable FastAPI application with
explicit domain services, an OpenAI SDK adapter, and Supabase/Postgres as the
authoritative persistence layer.

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
     -> Goer orchestration service
        -> Input policy checks
        -> OpenAI SDK adapter (Responses API + function tools)
        -> Typed tool gateway
           -> Catalog service
           -> Cart service
           -> Checkout/quote service
           -> Order/support service
     -> Output validation and response envelope
  -> Supabase Auth/Postgres/Realtime
  -> Payment and dispatch integrations
```

Keep the model boundary narrow. OpenAI may select a tool and compose text, but
FastAPI owns authentication, authorization, validation, pricing, persistence,
idempotency, and state transitions.

## FastAPI package layout

```text
backend/app/
  main.py                 # app creation, middleware, routers
  config.py               # environment and feature flags
  api/
    chat.py               # conversation turns and streaming
    catalog.py            # optional direct catalog endpoints
    cart.py
    checkout.py
    orders.py
  auth/
    dependencies.py       # Supabase JWT verification and user context
  domain/
    catalog/
    cart/
    checkout/
    orders/
    conversations/
  integrations/
    openai_client.py      # OpenAI SDK adapter
    supabase.py           # PostgREST/database gateway
    payments.py
    dispatch.py
  agent/
    orchestrator.py       # bounded tool loop
    prompts.py
    tools.py              # OpenAI tool definitions and dispatch map
    policies.py           # input/output and mutation gates
  schemas/
    chat.py
    catalog.py
    cart.py
    checkout.py
    orders.py
```

Use Pydantic models at every API, tool, and integration boundary. Keep
database-row models separate from client response models so legacy LocalGo
field names can be adapted without leaking storage details into prompts.

## OpenAI SDK boundary

`OpenAIModel` should expose one application-facing operation:

```python
async def run_turn(
    *,
    messages: list[dict],
    tools: list[dict],
    user_id: str,
    trace_id: str,
) -> ModelTurn:
    ...
```

The adapter should:

- use the OpenAI Python SDK with a configurable model;
- support structured output for routing and response envelopes;
- support function tools with strict JSON schemas;
- enforce request timeout, maximum tool rounds, and token limits;
- record request ID, latency, usage, and finish reason;
- normalize provider errors into application error types;
- allow a compatible endpoint through `OPENAI_BASE_URL` without changing
  domain code.

Start with one capable model and one bounded orchestration loop. Add a smaller
guard/classifier model only after evaluation demonstrates a benefit. The model
must never receive service credentials, raw payment data, or unrestricted
database access.

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

1. Add the provider adapter and configuration while keeping the current menu
   fixture working.
2. Extract catalog repository interfaces and map LocalGo menu/options.
3. Add authenticated conversation endpoints and the versioned response envelope.
4. Add Supabase-backed catalog, conversation, and audit persistence.
5. Add read-only tools and evaluation cases for restaurant/product grounding.
6. Move cart reads/mutations behind FastAPI with revision checks.
7. Add deterministic quotes, explicit confirmation, and payment integration.
8. Add order creation, dispatch integration, status reads, and cancellation
   policy.
9. Add streaming, realtime UX, tracing dashboards, and gradual rollout.

## Decisions requiring confirmation before implementation

- Which Supabase project/schema is the production LocalGo source of truth?
- Are restaurant/menu/options currently authoritative in Supabase, or must the
  existing client/static catalog be imported first?
- Should Goer support only authenticated users, or retain an anonymous demo
  mode for development?
- Which OpenAI model and deployment environment should be the initial default?
- Should the first milestone stop at discovery/cart, or include quote/payment
  and order creation?
