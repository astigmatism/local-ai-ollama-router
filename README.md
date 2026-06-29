# Local AI Ollama Router

A Docker-ready, Ollama-compatible router that sits between local AI clients and the real Ollama container. It enforces active-model policy, overwrites protected requests with `keep_alive: -1`, preserves streaming responses, persists request history, extracts Ollama response telemetry, and provides a small admin dashboard.

This project is designed for the current local AI topology where OpenWebUI, ComfyUI, local apps, and a voice assistant should stop talking directly to raw Ollama and should instead call the router.

## What this gives you

- Ollama-compatible routes for the first migration phase:
  - `GET /api/tags`
  - `POST /api/show`
  - `POST /api/chat`
  - `POST /api/generate`
  - `GET /api/ps`
  - `GET /api/version`
- Optional policy-aware routes:
  - `POST /api/embed`
  - `POST /api/embeddings`
  - model-management routes are disabled by default and require admin auth when enabled
- Active-model fail-closed policy by default.
- Request-level `keep_alive` normalization to `-1` for protected active-model requests.
- Streaming and non-streaming pass-through.
- Persistent request log in JSONL.
- Persistent activity/event log in JSONL.
- Admin dashboard at `/admin/`.
- Telemetry extraction from Ollama final response chunks and non-streaming responses.
- Optional GPU telemetry through `nvidia-smi` when available.
- No runtime npm dependencies; the application runs on Node.js 22 built-ins.

## Quick start: transition port

The default compose file publishes the router on `192.168.1.21:11435` so it can run beside the current raw Ollama service on `11434`.

```bash
cd /home/astigmatism/apps/local-ai-ollama-router
cp .env.example .env

# Set ADMIN_TOKEN in .env before exposing the admin UI on the LAN.
# Then write an active model marker for initial testing:
./scripts/write-active-model.sh 'hauhau-qwen3.6-35b-a3b-aggressive-q4-k-m:qwen35-parser' nighttime

docker compose --env-file .env up --build -d
curl http://192.168.1.21:11435/api/version
```

Open the admin dashboard at:

```text
http://192.168.1.21:11435/admin/
```

## Active model source of truth

The router reads the active model from `ACTIVE_MODEL_FILE`, defaulting to `/app/runtime/active-model.json`. The deployment/profile system should write this file during `local-ai-config.sh apply <profile>` or from the LLM deploy script.

Example marker:

```json
{
  "profile": "nighttime",
  "model": "hauhau-qwen3.6-35b-a3b-aggressive-q4-k-m:qwen35-parser",
  "keep_alive": -1,
  "updated_at": "2026-06-29T00:00:00-07:00",
  "source": "local-ai-config.sh apply nighttime"
}
```

`ACTIVE_MODEL` exists only as a temporary fallback. Prefer the file marker so the router does not invent model selection.

## Policy defaults

The default policy is intentionally conservative:

```text
MODEL_POLICY_MODE=active-only
FORCE_KEEP_ALIVE=-1
ALLOW_MODEL_MANAGEMENT=false
USE_ACTIVE_MODEL_WHEN_MISSING=false
```

For `POST /api/chat`, `POST /api/generate`, `POST /api/embed`, and `POST /api/embeddings`, the router allows the request only when `body.model` equals the active model. If the request is allowed and targets the active model, the router forwards it with `keep_alive: -1`, regardless of whether the client omitted `keep_alive` or sent a finite value such as `5m`.

## Admin dashboard

The dashboard shows:

- router health and uptime
- raw Ollama health
- active model marker and source
- loaded model state from `/api/ps`
- request history
- keep-alive rewrites
- rejections
- latency and token-throughput metrics
- activity timeline
- optional GPU telemetry

Control actions:

- prewarm active model
- run test chat against the active model
- reload active marker
- toggle maintenance mode

If `ADMIN_TOKEN` is set, admin APIs require either:

```text
Authorization: Bearer <token>
```

or:

```text
X-Admin-Token: <token>
```

## Smoke test

```bash
ROUTER_URL=http://192.168.1.21:11435 \
ADMIN_TOKEN='<your-admin-token>' \
./scripts/curl-smoke-test.sh 'hauhau-qwen3.6-35b-a3b-aggressive-q4-k-m:qwen35-parser'
```

After each request, verify raw Ollama still reports the active model as `Forever`:

```bash
docker exec local-ai-llm-legacy-ollama ollama ps
```

## Final cutover shape

After OpenWebUI, ComfyUI, the voice assistant, and local apps are verified through the router:

1. Remove raw Ollama's LAN `ports` mapping.
2. Keep raw Ollama reachable only on an internal Docker network.
3. Publish the router on `192.168.1.21:11434`.
4. Confirm `http://192.168.1.21:11434/api/version` is the router-backed endpoint.
5. Confirm no clients resolve `ollama` to raw Ollama unless that is deliberate.

See `docs/DEPLOYMENT_HANDOFF.md` for the full phased migration plan.

## Repository layout

```text
src/                 Router, policy, proxy, telemetry, metrics, storage
public/              Admin viewport UI
docs/                Architecture, deployment, API, test, and security notes
docs/source/         Original uploaded topology handoff
runtime/             Active model marker location
data/                Runtime JSONL logs, gitignored
scripts/             Smoke tests and utility helpers
test/                Node built-in test suite
compose.yml          Transition compose file, router on 11435
compose.final-example.yml  Example final cutover compose shape
Dockerfile           Node.js 22 runtime image
```

## Local development

```bash
npm test
npm run lint:syntax
npm start
```

The application has no runtime package dependencies. Tests use the Node.js built-in test runner.
