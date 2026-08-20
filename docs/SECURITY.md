# Security Notes

## Network boundary

This router is intended for a trusted local network. The human admin portal is intentionally unauthenticated and listens on a separate port, defaulting to `11435`. Anyone who can reach that port can view runtime state and trigger admin actions such as prewarm, test chat, active-marker reload, and maintenance-mode toggle.

Keep the admin port bound only to trusted local/LAN interfaces. Do not publish it to the public internet, a shared VPN, or an untrusted reverse proxy.

## API/admin port split

Default published ports:

```text
11434 = Ollama-compatible router API
11435 = unauthenticated human admin portal
```

The Ollama-compatible API remains separate from the browser portal. Requests to `/api/*` on the admin port return a router error instead of proxying to Ollama.

The API listener also exposes the stateless `/v1/responses` compatibility endpoint and `/responses` alias. These routes always target the active marker model through Ollama `/api/chat` and provide no model-management operation or arbitrary upstream path. When `REWRITE_REQUESTED_MODEL_TO_ACTIVE=true`, any non-empty requested identifier is advisory and is replaced with the marker model; when false, mismatches are rejected. Neither mode lets the client select or load another installed model.

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

When enabled, they require legacy admin authorization on the Ollama-compatible API listener if `ADMIN_TOKEN` is set. Keep them disabled unless you intentionally want the router to perform pull/create/copy/push/delete.

## Fail-closed behavior

The router defaults to `MODEL_POLICY_MODE=active-only`. If no active model marker exists, model-body generation requests fail closed with `NO_ACTIVE_MODEL`. `REWRITE_REQUESTED_MODEL_TO_ACTIVE` defaults to `false`; enabling it makes client-supplied model names advisory while preserving the marker as the only forwarded model. Responses cannot write `active-model.json`, and the public Responses path has no pull, load, create, copy, push, delete, fallback, or switch operation. Keep `ALLOW_MODEL_MANAGEMENT=false` in production and remove direct LAN access to raw Ollama so clients cannot bypass these controls.

## Raw Ollama exposure

The final target state is that raw Ollama has no LAN `ports` mapping. Publishing raw Ollama alongside the router preserves the bypass path that this router is meant to eliminate.

## Legacy admin token handling

`ADMIN_TOKEN` is retained for compatibility with same-port `/admin/api/*` calls and model-management authorization on the API listener. The token is never returned by `/admin/api/config` or `/admin/api/summary`. The browser admin portal on `ADMIN_PORT` does not ask for or store a token.
