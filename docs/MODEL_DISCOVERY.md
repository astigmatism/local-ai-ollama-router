# Stable Active-Model Discovery

## Public alias

The router publishes one stable OpenAI-style model ID for its active slot. `ROUTER_MODEL_ALIAS` configures that ID and defaults to `local-active`. The alias is not an Ollama model copy, an installed-model catalog entry, or a model-management mechanism.

Requests naming the exact alias resolve to the active marker's physical model on:

- `POST /v1/responses` and `POST /responses`
- `POST /v1/chat/completions`
- `POST /api/chat` and `POST /api/generate`
- `POST /api/embed` and `POST /api/embeddings`
- `POST /api/show`

This exact-alias behavior is always active. `REWRITE_REQUESTED_MODEL_TO_ACTIVE=false` still rejects other mismatched model IDs according to the existing policy. Setting it to `true` retains the broader compatibility mode where arbitrary non-empty requested model IDs are advisory.

The alias is served on the normal router API listener with the same authentication posture as `/v1/responses`. It is not served on the separate admin listener.

## Endpoints

`GET /v1/models` returns exactly one public entry:

```json
{
  "object": "list",
  "data": [MODEL_ENTRY]
}
```

`GET /v1/models/local-active` returns `MODEL_ENTRY` directly. A different ID returns HTTP 404 with an OpenAI-style `MODEL_NOT_FOUND` error. If there is no valid active model, both discovery forms return HTTP 503 with an OpenAI-style error whose code is `NO_ACTIVE_MODEL`; the router does not fabricate an entry.

Native Ollama discovery remains unchanged. For example, `/api/tags` may list every installed physical model and `/api/ps` may list running models. `/v1/models` never copies those catalogs.

## Model entry schema

Values below are illustrative. The physical model, limits, modalities, capabilities, and reasoning profile are derived at runtime; none are selected from a model-name table.

```json
{
  "id": "local-active",
  "object": "model",
  "created": 1788200000,
  "owned_by": "local-ai-ollama-router",
  "x_ollama_router": {
    "schema_version": 1,
    "alias": true,
    "upstream_model": "model-a:test",
    "profile": "example-profile",
    "updated_at": "2026-08-31T19:00:00.000Z",
    "context_window": 16384,
    "model_context_window": 131072,
    "max_output_tokens": 2048,
    "input_modalities": ["text"],
    "capabilities": ["completion", "tools", "thinking"],
    "reasoning": {
      "supported": true,
      "efforts": {
        "off": "none",
        "minimal": "minimal",
        "low": "low",
        "medium": "medium",
        "high": "high",
        "xhigh": "xhigh",
        "max": "max"
      },
      "upstream_levels": ["low", "medium", "high"],
      "effort_map": {
        "minimal": "low",
        "low": "low",
        "medium": "medium",
        "high": "high",
        "xhigh": true,
        "max": true
      },
      "default": "medium"
    },
    "sources": {
      "active_model_marker": true,
      "ollama_ps": true,
      "ollama_show": true
    },
    "complete": true,
    "warnings": []
  }
}
```

Field semantics:

- `id` is always the configured alias. It remains stable when the active marker changes.
- `created` is the active marker update time as Unix seconds, falling back to marker mtime and then router start time when needed.
- `upstream_model` is the current physical Ollama model from the active-model source.
- `profile` and `updated_at` come from the marker and are `null` when absent or invalid.
- `context_window` is the effective limit clients should currently use. Precedence is the matching loaded model's positive `/api/ps` `context_length`, the marker's positive configured context, the reliable architectural context from `/api/show`, then `null`.
- `model_context_window` is only the architectural maximum reliably identified in `/api/show` `model_info`, normally using `general.architecture` and `<architecture>.context_length`. It is otherwise `null`.
- `max_output_tokens` is a positive value explicitly supplied by the marker. The router does not infer one from context size, architecture, or a model name; it is `null` when not configured.
- `input_modalities` combines explicit marker declarations with reported backend capabilities. `completion` adds `text`; `vision` adds `image`. For `llama_cpp`, the adapter reports `vision` only when the active marker sets `capability_profile.vision: true`; deployment marker generation must first verify the running server's `/props.modalities.vision`. The router never infers image support from a model or profile name.
- `capabilities` is the normalized capability array returned by `/api/show`. It is `null` when that source is unavailable; an explicitly reported empty array remains `[]`.
- `sources` reports which enrichment sources were usable for this entry. An environment fallback can supply an active physical model, but `active_model_marker` remains `false` because no marker supplied the metadata.
- `complete` is `false` when a source failed, a required part of its response was unavailable, or configured optional metadata was invalid. Optional values such as an unconfigured output limit may legitimately be `null` in an otherwise complete entry.
- `warnings` contains stable, payload-free diagnostic codes such as `OLLAMA_PS_UNAVAILABLE`, `OLLAMA_SHOW_UNAVAILABLE`, `OLLAMA_SHOW_CAPABILITIES_UNAVAILABLE`, or `INVALID_REASONING_CAPABILITIES`.

## Marker metadata

Existing markers remain valid. Discovery recognizes these optional canonical fields:

```json
{
  "model": "model-a:test",
  "profile": "example-profile",
  "context_length": 16384,
  "max_output_tokens": 2048,
  "input_modalities": ["text"],
  "default_think": "medium",
  "supported_think_levels": ["low", "medium", "high"],
  "reasoning_effort_map": {
    "minimal": "low",
    "low": "low",
    "medium": "medium",
    "high": "high",
    "xhigh": true,
    "max": true
  },
  "revision": "deployment-42",
  "updated_at": "2026-08-31T19:00:00.000Z"
}
```

For compatibility, marker context aliases already used by the dashboard (`context`, `num_ctx`, `numCtx`, and `options.num_ctx`) are also accepted. Output-limit aliases `maxOutputTokens`, `num_predict`, and `options.num_predict` are accepted, but the canonical names are preferred. `modalities` is accepted as an alias for `input_modalities`.

Reasoning capability validation is shared with generation. `supported_think_levels` and `reasoning_effort_map` must appear together and satisfy the existing full-map validation. When valid, `reasoning.efforts` advertises the canonical Responses wire values, while `upstream_levels` and `effort_map` separately expose the actual Ollama negotiation. `off: "none"` documents the router's Responses control for disabling thinking. If safe reasoning support cannot be established, `supported` is `null` or `false`, unavailable upstream fields are `null`, and the router does not invent a mapping.

## Cache and freshness

Every discovery request re-reads the active-model source before consulting the enrichment cache. Cache entries are keyed by the physical model plus marker revision, mtime, update timestamp, and marker content digest. A marker change therefore invalidates the prior entry immediately, including changes that keep the same physical model but alter its limits or profile.

Successful or partial `/api/ps` and `/api/show` enrichment is cached for `ROUTER_MODEL_METADATA_TTL_MS`, default `5000` milliseconds. The cache never permits a prior physical model's entry to become the result after a newer marker revision has been detected. Discovery performs only `/api/ps` and `/api/show`; it does not generate, prewarm, pull, or load a model.

Responses include `Cache-Control: no-cache` and an `ETag` derived from the normalized public model entry. Send `If-None-Match` to revalidate; an unchanged entry returns HTTP 304 with no body.

## Partial metadata

A temporary `/api/ps` or `/api/show` failure does not erase valid marker data. The endpoint remains HTTP 200 while an active physical model exists, retains marker-supplied limits and reasoning metadata, marks the failed source `false`, sets unavailable fields to `null`, sets `complete` to `false`, and adds stable warnings.

Consumers must retain their last safe limits or choose conservative fallbacks when fields they require are missing. In particular, do not replace a known-safe context or output limit with an optimistic value merely because a partial response contains `null`.

## Examples

Fetch the one-entry catalog:

```bash
curl -i http://192.168.1.21:11434/v1/models
```

Fetch and save an ETag:

```bash
curl -i http://192.168.1.21:11434/v1/models/local-active
```

Revalidate a previously received entry:

```bash
curl -i http://192.168.1.21:11434/v1/models/local-active \
  -H 'If-None-Match: "previous-etag"'
```

Use the same stable ID for inference:

```bash
curl -fsS http://192.168.1.21:11434/v1/responses \
  -H 'content-type: application/json' \
  -d '{"model":"local-active","input":"Reply with ok.","stream":false}'
```

## DeepSeek Harness consumer integration

This router publishes metadata; it does not automatically reconfigure DeepSeek Harness. Harness needs a separate consumer-side enhancement. That enhancement should:

- Configure only the stable router alias.
- Fetch `/v1/models/{alias}` at startup and when beginning a new request or session, using ETag revalidation.
- Apply `context_window`, `max_output_tokens`, `input_modalities`, and reasoning metadata when present.
- Never persist `upstream_model` as the configured model ID.
- Retain the last safe values or fall back conservatively when metadata is incomplete.
- Refresh safely when a marker change causes the router to publish a new ETag and active physical model.
