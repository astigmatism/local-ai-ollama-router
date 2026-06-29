# Security Notes

## Network boundary

This router is intended for a trusted local network, but the admin dashboard can trigger prewarm and test-chat operations. Set `ADMIN_TOKEN` before exposing the container on the LAN.

## Prompt logging

Default prompt behavior:

```env
PROMPT_LOGGING=metadata
```

This records lengths and counts, not full prompt text. Safer options:

```env
PROMPT_LOGGING=off
```

Avoid this except during explicit debugging:

```env
PROMPT_LOGGING=full
```

Full prompt logging will persist prompts to `data/requests.jsonl`.

## Model-management endpoints

Model-management endpoints are disabled by default:

```env
ALLOW_MODEL_MANAGEMENT=false
```

When enabled, they still require admin auth. Keep them disabled unless you intentionally want the router to perform pull/create/copy/push/delete.

## Fail-closed behavior

The router defaults to `MODEL_POLICY_MODE=active-only`. If no active model marker exists, model-body generation requests fail closed with `NO_ACTIVE_MODEL`.

## Raw Ollama exposure

The final target state is that raw Ollama has no LAN `ports` mapping. Publishing raw Ollama alongside the router preserves the bypass path that this router is meant to eliminate.

## Admin token handling

The admin token is never returned by `/admin/api/config` or `/admin/api/summary`. The browser stores it in localStorage when entered in the dashboard. Use a LAN-only admin machine or clear browser storage after use if that matters.
