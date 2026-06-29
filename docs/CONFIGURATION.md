# Configuration

All configuration is environment-variable driven. `.env.example` is the starting point for Docker Compose.

## Listener

| Variable | Default | Purpose |
|---|---:|---|
| `HOST` | `0.0.0.0` | Interface inside the container. |
| `PORT` | `11434` | Router port inside the container. |
| `ROUTER_BIND_IP` | `192.168.1.21` | Host IP used by Compose. |
| `ROUTER_PUBLIC_PORT` | `11435` | Host port during transition. |

## Upstream Ollama

| Variable | Default | Purpose |
|---|---:|---|
| `OLLAMA_UPSTREAM_URL` | `http://ollama:11434` | Raw Ollama backend URL. |
| `OLLAMA_UPSTREAM_TIMEOUT_MS` | `900000` | Long timeout for large model loads/responses. |

## Active model

| Variable | Default | Purpose |
|---|---:|---|
| `ACTIVE_MODEL_FILE` | `/app/runtime/active-model.json` | Marker file written by deployment/profile system. |
| `ACTIVE_MODEL` | empty | Temporary fallback only. |

Marker format:

```json
{
  "profile": "nighttime",
  "model": "hauhau-qwen3.6-35b-a3b-aggressive-q4-k-m:qwen35-parser",
  "keep_alive": -1,
  "updated_at": "2026-06-29T00:00:00-07:00",
  "source": "local-ai-config.sh apply nighttime"
}
```

## Policy

| Variable | Default | Purpose |
|---|---:|---|
| `MODEL_POLICY_MODE` | `active-only` | `active-only`, `allowlist`, or `permissive`. |
| `ALLOWED_MODELS` | empty | CSV of additional models for `allowlist` mode or exceptions. |
| `FORCE_KEEP_ALIVE` | `-1` | Forwarded keep-alive for active protected requests. |
| `PROTECTED_MODEL_ENDPOINTS` | `/api/chat,/api/generate,/api/embed,/api/embeddings` | Endpoints receiving keep-alive rewrite. |
| `USE_ACTIVE_MODEL_WHEN_MISSING` | `false` | When true, missing model is filled with active model. Default false for compatibility/fail-closed clarity. |
| `ALLOW_MODEL_MANAGEMENT` | `false` | Enables pull/create/copy/push/delete only with admin auth. |

## Admin authentication

| Variable | Default | Purpose |
|---|---:|---|
| `ADMIN_TOKEN` | `change-me-before-lan-exposure` | Required token when non-empty. |
| `ADMIN_SESSION_HEADER` | `X-Admin-Token` | Header accepted by admin APIs. |

Admin requests may use either:

```text
Authorization: Bearer <token>
```

or:

```text
X-Admin-Token: <token>
```

## Persistence

| Variable | Default | Purpose |
|---|---:|---|
| `DATA_DIR` | `/app/data` | JSONL log directory. |
| `REQUEST_HISTORY_LIMIT` | `500` | In-memory request history count. |
| `EVENT_HISTORY_LIMIT` | `500` | In-memory event history count. |
| `MAX_BODY_BYTES` | `26214400` | Maximum accepted request body size. |
| `PROMPT_LOGGING` | `metadata` | `off`, `metadata`, or `full`. Use `full` only for explicit debugging. |

## GPU/model directory visibility

| Variable | Default | Purpose |
|---|---:|---|
| `ENABLE_NVIDIA_SMI` | `false` | Enables optional GPU telemetry collection. |
| `NVIDIA_SMI_BIN` | `nvidia-smi` | Binary path inside container. |
| `GPU_TELEMETRY_TIMEOUT_MS` | `2500` | Timeout for GPU telemetry command. |
| `UNIFIED_MODELS_DIR` | `/home/astigmatism/ai-models` | Host-side model directory mounted by Compose. |
| `MODELS_DIR_IN_CONTAINER` | `/models` | Read-only in-container model path shown in admin config. |
