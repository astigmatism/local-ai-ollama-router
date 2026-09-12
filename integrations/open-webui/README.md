# Open WebUI integration

These sources reproduce the terminal-state and unrestricted-output overlay for the qualified Open WebUI 0.11.3 image. They are separate from the router image and are not deployed by `scripts/primary/deploy-router-only.py`.

`Dockerfile.unrestricted` applies the strict source patch while building an image. `router_completion.py` preserves completed versus incomplete results, partial tools, Unicode output and reasoning through the native Ollama bridge. `align-primary.py` reconciles canonical/service display names and moves preset bases toward discovered stable `daytime`/`nighttime` IDs, preserving custom preset IDs, names, access grants and saved parameters. It must be invoked explicitly by the Open WebUI owner; router deployment never runs it. Its mapping checks run locally with `python3 integrations/open-webui/test-align-primary.py`.

The existing native connection `http://ai-router:11434` discovers service IDs through `/api/tags` and resolves metadata through `/api/show`. Presets should store these service IDs, so replacing the underlying catalog model does not require reconfiguring them. Do not add context overrides, output quotas or thinking budgets to new presets. Existing deliberate saved limits remain unchanged.

`test-unrestricted-policy.py` requires the patched Open WebUI Python environment and must run inside that image. It is not part of the standalone router's Node test suite. Operational acceptance chats, captured runtime state and historical deployment evidence stay local and are excluded from Git and Docker build context.
