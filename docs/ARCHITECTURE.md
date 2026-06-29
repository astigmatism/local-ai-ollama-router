# Architecture

## Goal

The router becomes the only supported Ollama-compatible endpoint for local clients. Raw Ollama remains the inference backend, but clients no longer call it directly.

```text
OpenWebUI -----------\
ComfyUI -------------+--> local-ai-ollama-router --> raw Ollama
voice assistant -----/
local AI apps -------/
```

## Core invariant

For the active deployed model, every request that can refresh or load model state is forwarded with:

```json
{"keep_alive": -1}
```

This is enforced at the router so individual clients do not need to remember or respect the setting.

## Components

### HTTP router

`src/server.js` owns the Node.js HTTP servers, route dispatch, admin endpoints, and Ollama-compatible proxy path. It starts two listeners by default: the Ollama-compatible API listener on `PORT` (`11434`) and the separate human admin listener on `ADMIN_PORT` (`11435`).

### Policy engine

`src/policy.js` validates model requests. The default policy is `active-only`:

- active model request: allowed
- non-active model request: rejected
- protected active model request: `keep_alive` overwritten to `-1`
- model-management endpoint: disabled by default

### Active model reader

`src/active-model.js` reads `/app/runtime/active-model.json` or falls back to `ACTIVE_MODEL`. The deployment/profile system should write the marker.

### Proxy and streaming support

The proxy forwards sanitized JSON bodies to raw Ollama and streams response chunks back to the client without buffering the full response. It observes newline-delimited JSON chunks to capture the final usage object when `done: true`.

### Telemetry and history

`src/metrics.js` maintains in-memory metrics from request records. `src/fs-store.js` persists request and event logs as JSONL files under `/app/data`.

### Admin portal

`public/` contains a no-build dashboard served by the separate admin listener at `/` and `/admin`. It uses unauthenticated admin-port JSON APIs under `/admin/api/*` to show active model state, loaded model status, request history, recent rejects/errors, events, metrics, and control actions. The legacy same-port `/admin/api/*` route remains available on the API listener and still honors `ADMIN_TOKEN` when set.

## Compatibility surface

Implemented initial endpoints:

```text
GET  /
GET  /api/tags
POST /api/show
POST /api/chat
POST /api/generate
GET  /api/ps
GET  /api/version
POST /api/embed
POST /api/embeddings
```

Disabled/admin-gated model-management routes:

```text
POST   /api/pull
POST   /api/create
POST   /api/copy
POST   /api/push
DELETE /api/delete
```

Unsupported `/api/*` routes return a structured router error instead of silently passing through.

## Data model

### Request record

Request records are metadata-only by default. Prompt text is not logged unless `PROMPT_LOGGING=full` is explicitly set.

Fields include:

- timestamp
- client identity
- source IP
- method and endpoint
- requested model
- active model at request time
- incoming and forwarded `keep_alive`
- allow/reject state
- upstream response status
- latency
- streaming flag
- prompt/message length metadata
- Ollama usage metrics when available

### Event record

Events capture operational changes:

- startup
- keep-alive normalization
- rejection
- prewarm
- admin test chat
- maintenance mode changes
- upstream failures

## Deployment states

### Phase 1: API/admin split

The router publishes the Ollama-compatible API on `192.168.1.21:11434` and the human admin portal on `192.168.1.21:11435`. It forwards to raw Ollama at `http://ollama:11434` on the internal Docker network.

### Phase 2: client migration

Repoint OpenWebUI, ComfyUI, the voice assistant, and local apps to the router. Confirm request history shows traffic and raw Ollama `ollama ps` remains `Forever`.

### Phase 3: final cutover

Raw Ollama loses LAN port exposure. The router remains the public compatibility endpoint at `192.168.1.21:11434`, and the no-token admin portal remains on `192.168.1.21:11435` for trusted local/LAN operators.
