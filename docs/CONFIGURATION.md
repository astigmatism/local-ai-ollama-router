# Configuration

All configuration is environment-variable driven. `.env.example` is the starting point for Docker Compose.

## Router API listener

| Variable | Default | Purpose |
|---|---:|---|
| `HOST` | `0.0.0.0` | Interface for the Ollama-compatible API listener inside the container. |
| `PORT` | `11434` | Ollama-compatible API port inside the container. |
| `ROUTER_BIND_IP` | `192.168.1.21` | Host IP used by Compose for published ports. |
| `ROUTER_PUBLIC_PORT` | `11434` | Host port for the Ollama-compatible router API. |

Clients should use the API listener, for example:

```text
http://192.168.1.21:11434
```

## Admin portal listener

| Variable | Default | Purpose |
|---|---:|---|
| `ADMIN_ENABLED` | `true` | Starts the separate browser/admin listener when true. |
| `ADMIN_BIND_HOST` | `0.0.0.0` | Interface for the admin listener inside the container. |
| `ADMIN_PORT` | `11435` | Admin listener port inside the container. |
| `ADMIN_PUBLIC_PORT` | `11435` | Host port used by Compose for the admin portal. |

The human dashboard is available at:

```text
http://192.168.1.21:11435/
http://192.168.1.21:11435/admin
```

The admin portal and its admin-port JSON APIs are intentionally unauthenticated. This is a local/LAN trust assumption; do not publish the admin port to untrusted networks.

## Upstream Ollama

| Variable | Default | Purpose |
|---|---:|---|
| `OLLAMA_UPSTREAM_URL` | `http://ollama:11434` | Raw Ollama backend URL. |
| `OLLAMA_UPSTREAM_TIMEOUT_MS` | `900000` | Long timeout for large model loads/responses. |
| `RESPONSES_CONTEXT_SHIFT` | `false` | Controls Ollama `shift` only for `/v1/responses` and `/responses`; disabled by default so Codex requests fail instead of silently shifting old context. |

## Active model

| Variable | Default | Purpose |
|---|---:|---|
| `ACTIVE_MODEL_FILE` | `/app/runtime/active-model.json` | Marker file written by deployment/profile system. |
| `ACTIVE_MODEL` | empty | Temporary fallback only. |

Marker format:

```json
{
  "profile": "nighttime",
  "model": "qwen3.8-27b-uncensored:night",
  "keep_alive": -1,
  "supported_think_levels": ["low", "medium", "xhigh"],
  "reasoning_effort_map": {
    "minimal": "low",
    "low": "low",
    "medium": "medium",
    "high": "xhigh",
    "xhigh": "xhigh",
    "max": "xhigh"
  },
  "updated_at": "2026-06-29T00:00:00-07:00",
  "source": "local-ai-config.sh apply nighttime"
}
```

The dashboard also displays optional context hints if the marker includes fields such as `context`, `num_ctx`, `numCtx`, or `options.num_ctx`.

Reasoning capability metadata belongs to the active deployment profile; the router does not infer it from `model` or `profile` names. `supported_think_levels` and `reasoning_effort_map` must appear together. The map must define `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`, and every target must be listed in `supported_think_levels`. `none` is not part of the map because it always becomes boolean `false`. Invalid/incomplete profiles fail generation with HTTP 503 before an upstream generation request.

For manual marker updates, `scripts/write-active-model.sh` accepts a capability JSON file as its fourth argument. `runtime/reasoning-capabilities.day.example.json` preserves the historical `xhigh`/`max` → `max` behavior, while `runtime/reasoning-capabilities.night.example.json` maps both efforts to `xhigh`.

## Policy

| Variable | Default | Purpose |
|---|---:|---|
| `MODEL_POLICY_MODE` | `active-only` | `active-only`, `allowlist`, or `permissive`. |
| `ALLOWED_MODELS` | empty | CSV of additional models for `allowlist` mode or exceptions. |
| `REWRITE_REQUESTED_MODEL_TO_ACTIVE` | `false` | When true, rewrite model-bearing requests to the active model while preserving all other request fields. Intended for trusted compatibility clients such as Open WebUI workflows. |
| `FORCE_KEEP_ALIVE` | `-1` | Forwarded keep-alive for active protected requests. |
| `PROTECTED_MODEL_ENDPOINTS` | `/api/chat,/api/generate,/api/embed,/api/embeddings` | Endpoints receiving keep-alive rewrite. |
| `USE_ACTIVE_MODEL_WHEN_MISSING` | `false` | When true, missing model is filled with active model. Default false for compatibility/fail-closed clarity. |
| `ALLOW_MODEL_MANAGEMENT` | `false` | Enables pull/create/copy/push/delete only with legacy admin auth when `ADMIN_TOKEN` is set. |

## Legacy admin token

| Variable | Default | Purpose |
|---|---:|---|
| `ADMIN_TOKEN` | `change-me-before-lan-exposure` | Optional token for legacy same-port `/admin/api/*` endpoints and model-management authorization on the API listener. It is not required by the separate browser admin portal. |
| `ADMIN_SESSION_HEADER` | `X-Admin-Token` | Header accepted by legacy admin auth. |

Legacy same-port admin requests may use either:

```text
Authorization: Bearer <token>
```

or:

```text
X-Admin-Token: <token>
```

The browser portal on `ADMIN_PORT` ignores this token and remains no-login by design.

## Persistence

| Variable | Default | Purpose |
|---|---:|---|
| `DATA_DIR` | `/app/data` | JSONL log directory. |
| `REQUEST_HISTORY_LIMIT` | `500` | In-memory request history count. |
| `EVENT_HISTORY_LIMIT` | `500` | In-memory event history count. |
| `MAX_BODY_BYTES` | `0` | Maximum accepted request body size in bytes. `0` disables the router-level cap; positive values restore it. Requests are still buffered in router memory and remain subject to client, Node.js, system-memory, Ollama, and model-context constraints. |
| `PROMPT_LOGGING` | `metadata` | `off`, `metadata`, or `full`. Use `full` only for explicit debugging. |

## GPU/model directory visibility

| Variable | Default | Purpose |
|---|---:|---|
| `ENABLE_NVIDIA_SMI` | `false` | Enables optional GPU telemetry collection. |
| `NVIDIA_SMI_BIN` | `nvidia-smi` | Binary path inside container. |
| `GPU_TELEMETRY_TIMEOUT_MS` | `2500` | Timeout for GPU telemetry command. |
| `UNIFIED_MODELS_DIR` | `/home/astigmatism/ai-models` | Host-side model directory mounted by Compose. |
| `MODELS_DIR_IN_CONTAINER` | `/models` | Read-only in-container model path shown in admin config. |
