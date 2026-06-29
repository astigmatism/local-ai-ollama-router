# Test Plan

## Static/local tests

From the repository root:

```bash
npm test
npm run lint:syntax
```

The test suite validates:

- active model marker parsing
- config parsing for the API/admin listener split
- fail-closed model policy
- `keep_alive` normalization
- allowlist behavior
- NDJSON final-usage extraction
- metrics aggregation
- unauthenticated admin listener access
- legacy same-port admin auth behavior
- Ollama-compatible API pass-through and keep-alive preservation/rewriting behavior

## Docker build test

```bash
docker build -t local-ai-ollama-router:test .
```

## Router/API/admin health test

```bash
docker compose --env-file .env up --build -d
curl -fsS http://192.168.1.21:11434/health
curl -fsS http://192.168.1.21:11434/api/version
curl -fsS http://192.168.1.21:11435/admin/api/summary
```

Open the no-token admin portal in a browser:

```text
http://192.168.1.21:11435/
```

Expected:

- `11434` behaves like the Ollama-compatible router API
- `11435` serves the human admin portal without a token
- `/api/*` requests on `11435` do not proxy to Ollama

## Keep-alive policy tests

Set the active marker to the currently prewarmed model.

### Missing keep_alive

```bash
curl -fsS http://192.168.1.21:11434/api/chat \
  -H 'content-type: application/json' \
  -H 'x-client-name: manual-missing-keepalive' \
  -d '{
    "model":"<active-model>",
    "stream":false,
    "messages":[{"role":"user","content":"Reply ok."}]
  }'
```

Expected request history in `http://192.168.1.21:11435/`:

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
curl -fsS http://192.168.1.21:11434/api/chat \
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
curl -i http://192.168.1.21:11434/api/chat \
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

The dashboard's recent rejects/errors panel should show the rejection.

## Streaming test

```bash
curl -N http://192.168.1.21:11434/api/generate \
  -H 'content-type: application/json' \
  -H 'x-client-name: manual-streaming-test' \
  -d '{"model":"<active-model>","prompt":"Count to three."}'
```

Expected:

- client receives streaming chunks
- final request record includes usage fields when Ollama provides them
- latency reflects streaming duration

## Admin portal and controls

No token is required on the admin port:

```bash
curl -fsS http://192.168.1.21:11435/
curl -fsS http://192.168.1.21:11435/admin/api/summary
curl -fsS -X POST http://192.168.1.21:11435/admin/api/prewarm
curl -fsS -X POST -H 'content-type: application/json' \
  -d '{"enabled":true}' http://192.168.1.21:11435/admin/api/maintenance
```

While maintenance mode is enabled, `/api/chat` and `/api/generate` on `11434` should return `MAINTENANCE_MODE`, while `/api/version` should still pass through.

Legacy same-port admin APIs still honor `ADMIN_TOKEN` when it is set:

```bash
curl -i http://192.168.1.21:11434/admin/api/summary
curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" http://192.168.1.21:11434/admin/api/summary
```

The first command should return `401` when `ADMIN_TOKEN` is non-empty; the second should succeed.

## Client migration verification

For each client, send one request and verify:

1. Router request history shows the client.
2. `forwardedKeepAlive` is `-1` for active model generation.
3. Raw Ollama `ollama ps` still shows `Forever`.
4. No request bypasses router history.
5. Clients use `11434`, not the admin portal on `11435`.
