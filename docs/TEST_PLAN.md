# Test Plan

## Static/local tests

From the repository root:

```bash
npm test
npm run lint:syntax
```

The test suite validates:

- active model marker parsing
- fail-closed model policy
- `keep_alive` normalization
- allowlist behavior
- NDJSON final-usage extraction
- metrics aggregation

## Docker build test

```bash
docker build -t local-ai-ollama-router:test .
```

## Router health test

```bash
docker compose --env-file .env up --build -d
curl -fsS http://192.168.1.21:11435/health
curl -fsS http://192.168.1.21:11435/api/version
```

## Keep-alive policy tests

Set the active marker to the currently prewarmed model.

### Missing keep_alive

```bash
curl -fsS http://192.168.1.21:11435/api/chat \
  -H 'content-type: application/json' \
  -H 'x-client-name: manual-missing-keepalive' \
  -d '{
    "model":"<active-model>",
    "stream":false,
    "messages":[{"role":"user","content":"Reply ok."}]
  }'
```

Expected request history:

```text
incomingKeepAlive: null/undefined
forwardedKeepAlive: -1
keepAliveNormalized: true
```

Expected raw Ollama:

```bash
docker exec local-ai-llm-legacy-ollama ollama ps
# UNTIL should be Forever
```

### Finite keep_alive

```bash
curl -fsS http://192.168.1.21:11435/api/chat \
  -H 'content-type: application/json' \
  -H 'x-client-name: manual-finite-keepalive' \
  -d '{
    "model":"<active-model>",
    "stream":false,
    "keep_alive":"5m",
    "messages":[{"role":"user","content":"Reply ok."}]
  }'
```

Expected request history:

```text
incomingKeepAlive: 5m
forwardedKeepAlive: -1
keepAliveNormalized: true
```

Expected raw Ollama:

```text
UNTIL Forever
```

## Model mismatch test

```bash
curl -i http://192.168.1.21:11435/api/chat \
  -H 'content-type: application/json' \
  -d '{
    "model":"not-the-active-model:latest",
    "stream":false,
    "messages":[{"role":"user","content":"test"}]
  }'
```

Expected:

```text
HTTP 409
MODEL_NOT_ACTIVE
```

## Streaming test

```bash
curl -N http://192.168.1.21:11435/api/generate \
  -H 'content-type: application/json' \
  -H 'x-client-name: manual-streaming-test' \
  -d '{"model":"<active-model>","prompt":"Count to three."}'
```

Expected:

- client receives streaming chunks
- final request record includes usage fields when Ollama provides them
- latency reflects streaming duration

## Admin controls

```bash
curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" http://192.168.1.21:11435/admin/api/summary
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" http://192.168.1.21:11435/admin/api/prewarm
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"enabled":true}' http://192.168.1.21:11435/admin/api/maintenance
```

While maintenance mode is enabled, `/api/chat` and `/api/generate` should return `MAINTENANCE_MODE`, while `/api/version` should still pass through.

## Client migration verification

For each client, send one request and verify:

1. Router request history shows the client.
2. `forwardedKeepAlive` is `-1` for active model generation.
3. Raw Ollama `ollama ps` still shows `Forever`.
4. No request bypasses router history.
