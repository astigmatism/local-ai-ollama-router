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
- Responses request/message/tool translation
- reasoning composition across native `think`, Responses effort aliases, active-model defaults, and global defaults
- fixed active-model enforcement independent of legacy policy modes
- non-streaming and SSE text/function-call output
- full-history function-result correlation by `call_id`
- stateless, malformed-input, timeout, incomplete-stream, and cancellation behavior
- regression coverage proving existing `/api/*` and `/v1/models` behavior is unchanged

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

## Responses API integration smoke test

After deploying the new endpoint, run the text and real tool-cycle smoke test:

```bash
ROUTER_URL=http://192.168.1.21:11434 \
ADMIN_URL=http://192.168.1.21:11435 \
./scripts/responses-smoke-test.sh
```

The script reads the active marker, snapshots `/api/ps`, streams a text response, asks the model to call the harmless `get_test_value` function, returns `router-smoke-42` as a `function_call_output`, and verifies that the final answer incorporates it. It then confirms both the active marker and loaded-model set are unchanged. It never requests a model pull or switch.

Expected final lines include:

```text
Responses smoke test passed.
Active model remained: <active-model>
Tool result incorporated: ...router-smoke-42...
```

### Exact Codex CLI smoke test

Codex CLI 0.144.3 must be tested with a function call, not only a curl text request:

```bash
ROUTER_URL=http://192.168.1.21:11434 \
./scripts/codex-responses-smoke-test.sh
```

The script uses `--ignore-user-config --ephemeral` and temporary custom-provider command-line overrides, including `wire_api = "responses"`, `requires_openai_auth = false`, `web_search = "disabled"`, and `model_reasoning_effort = "none"`. Nonessential plugins, apps, and multi-agent tools are disabled to keep this single-function smoke deterministic. It asks Codex to use its shell function for a harmless `printf`, verifies both the completed command item and final assistant item in Codex JSONL output, and checks that the active and loaded model snapshots remain identical. It does not modify the user's persistent Codex configuration.

If the script reports an unsupported `web_search` tool, verify the installed Codex version honors `web_search = "disabled"`. The adapter rejects provider-executed tools deliberately rather than silently removing them.

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
