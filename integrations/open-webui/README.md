# Open WebUI integration

These sources reproduce the terminal-state and unrestricted-output overlay for the qualified Open WebUI 0.11.3 image. They are separate from the router image and are not deployed by `scripts/primary/deploy-router-only.py`.

`Dockerfile.unrestricted` applies the strict source patch while building an image. `router_completion.py` preserves completed versus incomplete results, partial tools, Unicode output and reasoning through the native Ollama bridge. `align-primary.py` reconciles canonical display names while retaining technical IDs and custom preset names.

`test-unrestricted-policy.py` requires the patched Open WebUI Python environment and must run inside that image. It is not part of the standalone router's Node test suite. Operational acceptance chats, captured runtime state and historical deployment evidence stay local and are excluded from Git and Docker build context.
