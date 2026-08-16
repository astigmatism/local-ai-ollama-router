# API Reference

## Port split

| Listener | Default | Purpose |
|---|---:|---|
| Router API | `11434` | Ollama-compatible API for Open WebUI, ComfyUI, and local clients. |
| Admin portal | `11435` | Human browser dashboard and admin-port JSON APIs. No token or login. |

The browser admin portal is available at both:

```text
http://<host>:11435/
http://<host>:11435/admin
```

The admin portal is intentionally unauthenticated for trusted local/LAN use. Do not expose it to untrusted networks.

## Ollama-compatible API

These routes are served on the router API listener, normally `http://<host>:11434`.

### `GET /`

Returns a simple compatibility health message:

```text
Ollama is running
```

### `GET /api/version`

Passes through to raw Ollama.

### `GET /api/tags`

Passes through to raw Ollama.

### `GET /api/ps`

Passes through to raw Ollama.

### `POST /api/show`

Passes through to raw Ollama. This endpoint is considered safe/status-like by default. When `REWRITE_REQUESTED_MODEL_TO_ACTIVE=true`, `/api/show` model names are also rewritten to the active model.

### `POST /api/chat`

Policy-enforced. Default behavior:

- requires JSON body
- requires `body.model`
- rejects non-active model
- overwrites `keep_alive` to `-1` for active model
- preserves non-model request fields such as `messages`, `stream`, `options`, and `format`
- preserves `think` unless it is enabled and `/api/show` reports that the model lacks the `thinking` capability; unsupported enabled values are dropped
- streams response when `stream` is omitted or true
- captures final usage fields when available

### `POST /api/generate`

Same policy and streaming behavior as `/api/chat`.

### `POST /api/embed` and `POST /api/embeddings`

Policy-enforced. Default behavior requires the active model and rewrites `keep_alive` for protected active-model requests.

### Model-management endpoints

These are disabled by default:

```text
POST   /api/pull
POST   /api/create
POST   /api/copy
POST   /api/push
DELETE /api/delete
```

To enable them, set `ALLOW_MODEL_MANAGEMENT=true`. Even then, the request must include legacy admin authorization on the router API listener when `ADMIN_TOKEN` is set.

## OpenAI Responses compatibility

`POST /v1/responses` is a stateless compatibility endpoint for Codex CLI. `POST /responses` is an equivalent alias. Both translate to the existing Ollama `/api/chat` operation; neither proxies an arbitrary client-selected path.

`GET /v1/models` is intentionally not implemented. Codex should be configured with the exact active model name. A conventional OpenAI model-list response is not a compatible substitute for Codex's separate model-catalog schema.

### Fixed-model rules

- An omitted `model` resolves to the current active-model marker.
- The exact active model is accepted.
- Every other model receives HTTP 400 `MODEL_NOT_ACTIVE`.
- A missing active marker receives HTTP 503 `NO_ACTIVE_MODEL`.
- Ollama always receives the active model and the configured `FORCE_KEEP_ALIVE` value.
- Responses requests never invoke model pull, create, copy, push, delete, fallback, or switching logic.
- These rules are independent of the policy settings used by existing `/api/*` routes.

### Supported request fields

| Field | Behavior |
|---|---|
| `model` | Optional; must exactly match the active model when present. |
| `input` | Required string or array of supported input items. |
| `instructions` | Prepended as a system message without removing developer/system input. |
| `stream` | `false` by default; `true` produces Responses SSE events. |
| `tools` | Function tools and function-only Codex namespace groups are translated to Ollama function definitions. |
| `tool_choice` | `auto` and `none` only. Other forms receive HTTP 400. |
| `parallel_tool_calls` | Boolean accepted and reflected in the response. Call IDs remain individually correlated. |
| `reasoning.effort` | Maps supported effort names to Ollama `think`; omitted, null, or `none` disables it. An enabled value is dropped when `/api/show` reports that the active model lacks the `thinking` capability. |
| `text.format` | Plain text, `json_object`, and `json_schema` formats. |
| `store` | May be omitted or `false`; `true` and other values receive HTTP 400. |
| `temperature` | Maps to Ollama `options.temperature`. |
| `max_output_tokens` | Maps to Ollama `options.num_predict`. |

Unknown optional fields are ignored only when doing so does not claim unsupported behavior. Any non-null `previous_response_id` is rejected because the adapter does not persist response state. WebSocket Responses transport is not implemented.

Supported input items are:

- `message` with `system`, `developer`, `user`, or `assistant` role
- `input_text` and `output_text` content parts
- `input_image` using a base64 `data:image/...` URL
- `function_call` with a unique `call_id` and JSON-object arguments encoded as text or an object
- `function_call_output` associated with a known, not-yet-completed `call_id`

For a tool follow-up, resend the preceding function-call item, append one `function_call_output` item per `call_id` in result order, and resend the tool definitions. Unknown or duplicate call IDs and malformed function arguments are rejected.

Top-level `type: "function"` tools and Codex `type: "namespace"` groups containing only functions are accepted. Namespace members are given collision-safe qualified names for Ollama, then restored to separate `namespace` and `name` fields in Responses function-call items so Codex can dispatch them locally. Built-in provider tools such as `web_search`, `file_search`, `computer_use`, and `image_generation` receive HTTP 400 even when `tool_choice` is `none`; this prevents silent loss of capabilities assumed by the client. Configure Codex with `web_search = "disabled"`.

### Non-streaming example

```bash
curl -fsS http://192.168.1.21:11434/v1/responses \
  -H 'content-type: application/json' \
  -d '{
    "input": "Reply with exactly: adapter ready",
    "store": false,
    "stream": false,
    "max_output_tokens": 32
  }'
```

The result is an OpenAI Responses object containing `id`, `object: "response"`, `created_at`, `status`, the active `model`, `output`, `usage`, `error`, and `incomplete_details`. Ollama prompt/evaluation token counters map to `input_tokens`, `output_tokens`, and `total_tokens`.

### Streaming example

```bash
curl -N http://192.168.1.21:11434/v1/responses \
  -H 'content-type: application/json' \
  -d '{"input":"Give a five-word health check.","stream":true,"store":false}'
```

The stream uses `Content-Type: text/event-stream`, disables buffering, and emits monotonic `sequence_number` values. Its lifecycle includes `response.created`, `response.in_progress`, output-item/content-part events, text or function-argument deltas and done events, and finally `response.completed`. If generation fails after the SSE headers have been sent, the adapter emits `response.failed` and closes with `[DONE]`.

### Codex configuration

```toml
model_provider = "local_ollama_router"
model = "<exact active model>"
model_reasoning_effort = "none"
web_search = "disabled"

[model_providers.local_ollama_router]
name = "Local Ollama Router"
base_url = "http://192.168.1.21:11434/v1"
wire_api = "responses"
requires_openai_auth = false
```

For Codex CLI 0.144.3, `/v1/models` is not required for this provider shape. `model_reasoning_effort = "none"` is recommended for deterministic local tool use; explicit supported efforts are forwarded to Ollama when reasoning is wanted. Streaming function-call `response.output_item.done` events carry the completed call that Codex executes; a later request returns the tool result as `function_call_output`.

### Responses error shape

Errors returned before streaming begins use the OpenAI-compatible envelope:

```json
{
  "error": {
    "message": "Requested model is not the active deployed model for this router profile.",
    "type": "invalid_request_error",
    "param": "model",
    "code": "MODEL_NOT_ACTIVE"
  }
}
```

Common adapter-only codes include `STATEFUL_REQUEST_UNSUPPORTED`, `UNSUPPORTED_TOOL_CHOICE`, `UNSUPPORTED_TOOL_TYPE`, `UNKNOWN_TOOL_CALL_ID`, `MALFORMED_TOOL_ARGUMENTS`, `UPSTREAM_TIMEOUT`, and `INCOMPLETE_UPSTREAM_STREAM`.

## Router errors

Router-generated errors use this shape:

```json
{
  "error": {
    "code": "MODEL_NOT_ACTIVE",
    "message": "Requested model is not the active deployed model for this router profile."
  }
}
```

Common codes:

| Code | Meaning |
|---|---|
| `NO_ACTIVE_MODEL` | No active marker was found and policy is fail-closed. |
| `MODEL_REQUIRED` | Generation request did not include a model. |
| `MODEL_NOT_ACTIVE` | Requested/effective model does not match active model. |
| `MODEL_MANAGEMENT_DISABLED` | Pull/create/delete/copy/push disabled. |
| `ADMIN_REQUIRED` | Legacy admin auth required for a gated model-management endpoint. |
| `MAINTENANCE_MODE` | Router maintenance mode rejects generation. |
| `UPSTREAM_REQUEST_FAILED` | Raw Ollama request failed before response. |
| `API_NOT_ON_ADMIN_PORT` | `/api/*` was requested from the admin portal listener instead of the router API listener. |

## Admin portal JSON API on `11435`

These routes are used by the browser dashboard and do not require a token on the admin listener.

### `GET /admin/api/summary`

Returns router config summary, active model marker, upstream health, `/api/ps`, active loaded state, optional GPU telemetry, metrics, recent reject/error records, and log paths.

### `GET /admin/api/requests?limit=100`

Returns recent request records, newest first.

### `GET /admin/api/events?limit=50`

Returns recent operational events, newest first.

### `GET /admin/api/metrics`

Returns the metrics snapshot.

### `GET /admin/api/config`

Returns safe public config. It does not return the legacy admin token.

### `POST /admin/api/prewarm`

Runs a non-streaming empty `/api/generate` request against the active model with `keep_alive: -1`.

### `POST /admin/api/test-chat`

Runs a non-streaming `/api/chat` against the active model with `keep_alive: -1`.

Body:

```json
{"prompt":"Reply with a short health check."}
```

### `POST /admin/api/reload-config`

Re-reads the active model marker and records an event.

### `POST /admin/api/maintenance`

Body:

```json
{"enabled":true}
```

When enabled, model-body generation endpoints are rejected while safe status endpoints continue to work.

## Legacy same-port admin API

For backward compatibility, the router API listener still accepts `/admin/api/*`. Those machine-readable endpoints require `Authorization: Bearer <token>` or `X-Admin-Token: <token>` when `ADMIN_TOKEN` is set. The separate browser portal on `11435` ignores this token requirement by design.
