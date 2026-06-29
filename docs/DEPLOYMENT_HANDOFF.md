# Deployment Handoff

This document is written for the next AI/operator that deploys the router into the existing local AI stack.

## Starting facts from the topology handoff

Current raw Ollama is exposed on the LAN at:

```text
http://192.168.1.21:11434
```

OpenWebUI currently uses Docker DNS `ollama:11434`, and that alias resolves to the raw Ollama container. ComfyUI and the voice assistant are expected to use the LAN endpoint. The migration objective is to make the router the only public Ollama-compatible endpoint.

## Do not do this immediately

Do not immediately remove raw Ollama's published port. First run the router on a temporary port and prove policy enforcement.

## Phase 1: create project directory

```bash
mkdir -p /home/astigmatism/apps
cd /home/astigmatism/apps
unzip local-ai-ollama-router.zip
cd local-ai-ollama-router
cp .env.example .env
```

Edit `.env`:

```env
ADMIN_TOKEN=<strong-local-token>
ROUTER_BIND_IP=192.168.1.21
ROUTER_PUBLIC_PORT=11435
OLLAMA_UPSTREAM_URL=http://ollama:11434
UNIFIED_MODELS_DIR=<actual unified model directory>
```

## Phase 2: active model marker

The long-term owner should be `local-ai-config.sh` or `deploy-runtime.sh`. For the first test, write the marker manually:

```bash
./scripts/write-active-model.sh 'hauhau-qwen3.6-35b-a3b-aggressive-q4-k-m:qwen35-parser' nighttime
```

The marker lands at:

```text
./runtime/active-model.json
```

Inside the container this is:

```text
/app/runtime/active-model.json
```

## Phase 3: start the router

```bash
docker compose --env-file .env up --build -d
docker logs -f local-ai-ollama-router
```

Confirm the router is reachable:

```bash
curl http://192.168.1.21:11435/
curl http://192.168.1.21:11435/api/version
```

Open admin UI:

```text
http://192.168.1.21:11435/admin/
```

## Phase 4: keep-alive enforcement test

Run:

```bash
ROUTER_URL=http://192.168.1.21:11435 \
ADMIN_TOKEN='<admin-token>' \
./scripts/curl-smoke-test.sh '<active-model>'
```

After each router-mediated request, check raw Ollama:

```bash
docker exec local-ai-llm-legacy-ollama ollama ps
```

Expected:

```text
UNTIL Forever
```

Also check the admin request history. The two smoke-test chat requests should show:

```text
forwardedKeepAlive: -1
```

The finite `5m` request should produce a `keep_alive_normalized` event.

## Phase 5: repoint OpenWebUI

In `/home/astigmatism/apps/open-webui/compose.yml`, change:

```yaml
OLLAMA_BASE_URL: "http://ollama:11434"
```

To one of these:

```yaml
OLLAMA_BASE_URL: "http://ai-router:11434"
```

or during transition:

```yaml
OLLAMA_BASE_URL: "http://192.168.1.21:11435"
```

Prefer `http://ai-router:11434` if OpenWebUI is attached to the same Docker network and can resolve the router service. Verify:

```bash
docker exec open-webui getent hosts ai-router
```

After restart, test a chat in OpenWebUI. Confirm router history shows OpenWebUI traffic and raw Ollama still reports `Forever`.

Caution: OpenWebUI may persist connection settings in its database. If traffic does not show in router history, inspect OpenWebUI settings and database-backed Ollama URLs.

## Phase 6: repoint ComfyUI

Search current ComfyUI app files and workflow JSON for:

```text
http://192.168.1.21:11434
```

During transition, replace with:

```text
http://192.168.1.21:11435
```

After final cutover, the same URL can return to `11434`, but then it must be the router on `11434`, not raw Ollama.

Recommended improvement: make the ComfyUI Ollama prompt bridge read a single environment variable for the router base URL instead of hardcoding it in source/workflows.

## Phase 7: repoint voice assistant and other LAN clients

Set the voice assistant Ollama base URL to:

```text
http://192.168.1.21:11435
```

The voice assistant should not select or swap models. It should call the active model only. If it cannot supply a model, either configure it to send the active model or deliberately set `USE_ACTIVE_MODEL_WHEN_MISSING=true` after accepting the behavior.

## Phase 8: remove raw Ollama LAN exposure

Only do this after all clients are verified through router history.

Change raw Ollama compose from a public `ports` mapping to internal-only `expose` or no public port:

```yaml
expose:
  - "11434"
```

Then publish router on the compatibility port:

```env
ROUTER_PUBLIC_PORT=11434
```

or use `compose.final-example.yml` as a guide.

Verify direct raw endpoint is no longer reachable from the LAN:

```bash
RAW_URL=http://192.168.1.21:11434 ROUTER_URL=http://192.168.1.21:11435 ./scripts/check-cutover.sh
```

After the final port move, `RAW_URL` should be a private-only address or not exposed.

## Phase 9: deprecate local-ai-llm-legacy

Once the router admin UI covers the needed portal features, stop publishing `local-ai-llm-legacy` on `192.168.1.21:8001`. Keep it temporarily available for comparison only if needed, then archive it.

## Acceptance checklist

- OpenWebUI lists models through the router.
- OpenWebUI chats through the router.
- ComfyUI prompt bridge calls the router.
- Voice assistant calls the router.
- Streaming and non-streaming responses work.
- Active model requests without `keep_alive` are forwarded with `-1`.
- Active model requests with finite `keep_alive` are forwarded with `-1`.
- Non-active model requests are rejected by default.
- Request history shows client identity, endpoint, model, keep-alive rewrite, status, and latency.
- Admin dashboard shows upstream health and active loaded state.
- Raw Ollama is not published directly to the LAN.
