# Integration Notes

## OpenWebUI

Current known setting:

```yaml
OLLAMA_BASE_URL: "http://ollama:11434"
```

Preferred transition target when Docker DNS is available:

```yaml
OLLAMA_BASE_URL: "http://ai-router:11434"
```

LAN API target:

```yaml
OLLAMA_BASE_URL: "http://192.168.1.21:11434"
```

The separate browser admin portal is `http://192.168.1.21:11435/`; do not configure clients to use the admin port.

After changing environment variables, verify OpenWebUI did not keep a database-stored Ollama URL by checking router request history while sending a chat.

For Open WebUI workflow/custom model compatibility, prefer protecting behavior at the router rather than modifying Open WebUI source. Set `REWRITE_REQUESTED_MODEL_TO_ACTIVE=true` for the router when Open WebUI should be allowed to send any configured base-model name while the router forwards the request to the deployed active Ollama model. The router preserves non-model request parameters such as `options`, `format`, messages, and streaming settings, and still normalizes `keep_alive` to the configured forced value. Boolean `think` controls are preserved; string controls are mapped through the active marker's `supported_think_levels` and `reasoning_effort_map`. Enabled thinking is then dropped if `/api/show` does not advertise `thinking`.

## Codex

With `REWRITE_REQUESTED_MODEL_TO_ACTIVE=true`, configure Codex's custom Responses provider with a stable identifier such as `model = "local-active"`. Codex may retain that identifier across day/night profile changes: request history records it as `requestedModel`, while `activeModel` and `forwardedModel` show the marker model that Ollama actually received. Strict mode remains available by setting the flag to `false`.

## ComfyUI

Search for hardcoded raw URLs:

```bash
grep -R "192.168.1.21:11434\|127.0.0.1:11434\|ollama:11434" \
  /home/astigmatism/apps/local-ai-comfyui
```

Use the Ollama-compatible router API URL:

```text
http://192.168.1.21:11434
```

The admin portal is on `11435` and is not an Ollama API endpoint.

Recommended improvement: refactor the custom node to read one base URL environment variable rather than embedding raw Ollama URLs in Python source or workflow JSON.

## Voice assistant

Configure the device to call the router endpoint and to use the active model. The default router policy rejects missing or non-active models, which is intentional to prevent voice-assistant model swaps.

## local-ai-images-legacy

Inspect live `.env` before changing code. If it points to raw Ollama, move it to the router endpoint.

## local-ai-llm-legacy

Keep the legacy app running during initial tests. Once the router admin viewport covers the useful portal features, repoint or retire the legacy app.
