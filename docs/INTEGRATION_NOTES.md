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

Alternative transition target:

```yaml
OLLAMA_BASE_URL: "http://192.168.1.21:11435"
```

After changing environment variables, verify OpenWebUI did not keep a database-stored Ollama URL by checking router request history while sending a chat.

## ComfyUI

Search for hardcoded raw URLs:

```bash
grep -R "192.168.1.21:11434\|127.0.0.1:11434\|ollama:11434" \
  /home/astigmatism/apps/local-ai-comfyui
```

During transition, use:

```text
http://192.168.1.21:11435
```

Recommended improvement: refactor the custom node to read one base URL environment variable rather than embedding raw Ollama URLs in Python source or workflow JSON.

## Voice assistant

Configure the device to call the router endpoint and to use the active model. The default router policy rejects missing or non-active models, which is intentional to prevent voice-assistant model swaps.

## local-ai-images-legacy

Inspect live `.env` before changing code. If it points to raw Ollama, move it to the router endpoint.

## local-ai-llm-legacy

Keep the legacy app running during initial tests. Once the router admin viewport covers the useful portal features, repoint or retire the legacy app.
