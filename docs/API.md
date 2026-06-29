# API Reference

## Ollama-compatible API

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

Passes through to raw Ollama. This endpoint is considered safe/status-like by default.

### `POST /api/chat`

Policy-enforced. Default behavior:

- requires JSON body
- requires `body.model`
- rejects non-active model
- overwrites `keep_alive` to `-1` for active model
- streams response when `stream` is omitted or true
- captures final usage fields when available

### `POST /api/generate`

Same policy and streaming behavior as `/api/chat`.

### `POST /api/embed` and `POST /api/embeddings`

Policy-enforced. Default behavior requires the active model and rewrites `keep_alive` if present or protected.

### Model-management endpoints

These are disabled by default:

```text
POST   /api/pull
POST   /api/create
POST   /api/copy
POST   /api/push
DELETE /api/delete
```

To enable them, set `ALLOW_MODEL_MANAGEMENT=true`. Even then, the request must include admin authorization.

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
| `MODEL_NOT_ACTIVE` | Requested model does not match active model. |
| `MODEL_MANAGEMENT_DISABLED` | Pull/create/delete/copy/push disabled. |
| `ADMIN_REQUIRED` | Admin auth required. |
| `MAINTENANCE_MODE` | Router maintenance mode rejects generation. |
| `UPSTREAM_REQUEST_FAILED` | Raw Ollama request failed before response. |

## Admin API

All admin APIs require auth when `ADMIN_TOKEN` is set.

### `GET /admin/api/summary`

Returns router config summary, active model marker, upstream health, `/api/ps`, active loaded state, optional GPU telemetry, metrics, and log paths.

### `GET /admin/api/requests?limit=100`

Returns recent request records, newest first.

### `GET /admin/api/events?limit=50`

Returns recent operational events, newest first.

### `GET /admin/api/metrics`

Returns the metrics snapshot.

### `GET /admin/api/config`

Returns safe public config. It does not return the admin token.

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
