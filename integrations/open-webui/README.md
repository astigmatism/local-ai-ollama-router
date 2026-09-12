# Open WebUI integration

These sources reproduce the terminal-state and unrestricted-output overlay for the qualified Open WebUI 0.11.3 image. They are separate from the router image and are not deployed by `scripts/primary/deploy-router-only.py`.

`Dockerfile.unrestricted` applies the strict source patch while building an image. `router_completion.py` preserves completed versus incomplete results, partial tools, Unicode output and reasoning through the native Ollama bridge. `align-primary.py` reconciles canonical/service display names and moves preset bases toward discovered stable `daytime`/`nighttime` IDs, preserving custom preset IDs, names, access grants and saved parameters. It must be invoked explicitly by the Open WebUI owner; router deployment never runs it. Its mapping checks run locally with `python3 integrations/open-webui/test-align-primary.py`.

The existing native connection `http://ai-router:11434` discovers service IDs through `/api/tags` and resolves metadata through `/api/show`. Presets should store these service IDs, so replacing the underlying catalog model does not require reconfiguring them. Do not add context overrides, output quotas or thinking budgets to new presets. Existing deliberate saved limits remain unchanged.

`test-unrestricted-policy.py` requires the patched Open WebUI Python environment and must run inside that image. It is not part of the standalone router's Node test suite. Operational acceptance chats, captured runtime state and historical deployment evidence stay local and are excluded from Git and Docker build context.

## Search reliability and nighttime tool parity

`Dockerfile.search-reliability` layers on the existing unrestricted image. The DDGS adapter serializes calls from both native tools and legacy retrieval, spaces their start times by `DDGS_MIN_REQUEST_INTERVAL` (2 seconds), and sets/restores the DDGS class-level worker limit. This prevents native tools from bypassing the per-batch search concurrency setting. The deployment selects `duckduckgo,yandex,brave` with one DDGS worker so DuckDuckGo can fall back to Yandex and then Brave without a concurrent provider burst. Live acceptance showed that both DuckDuckGo and Brave can reject requests in the same application process, requiring the third independent provider. External providers can still temporarily reject requests; failures remain visible.

Nighttime's native tool support was verified against the installed model. Its source catalog now advertises tools. `align-nighttime-tools.py` copies tool capabilities, tool selections, per-tool controls, and default features from each matching Daytime preset. It retains preset identities, icons, permissions, prompts and saved generation parameters. Vision follows backend discovery. The Nighttime vision migration loads its matching pinned projector on CPU before enabling vision in the catalog and both presets; see [the migration](../../docs/NIGHTTIME_VISION.md). No output limit is copied into its Deep Thinking preset.

After publishing the router release through `docs/RELEASE.md`, build and deploy the companion Open WebUI image from the same clean revision:

```sh
revision=$(git rev-parse HEAD)
image="local/open-webui:search-tools-git-$revision"
docker build --build-arg "VCS_REF=$revision" -f integrations/open-webui/Dockerfile.search-reliability -t "$image" integrations/open-webui
docker run --rm -i -e WEBUI_SECRET_KEY=isolated-search-adapter-test-only --entrypoint python "$image" - < integrations/open-webui/test-search-reliability.py
OPENWEBUI_PUBLICATION_IMAGE="$image" python3 integrations/open-webui/deploy-search-tools.py
```

The deployment requires no active Open WebUI tasks, saves a private snapshot, checks the Compose file, recreates only Open WebUI, applies the authorized settings through its admin API, and verifies parity plus identity/permission/parameter preservation. Router deployment never calls the Open WebUI step implicitly. Run `python3 integrations/open-webui/test-align-nighttime-tools.py` locally for the preset transformation checks.

For a provider-list-only release, deploy the published helper with `docker exec -i open-webui python - apply-search < integrations/open-webui/align-nighttime-tools.py`. This updates the persisted provider list through the admin API without rebuilding or restarting the unchanged image. The checked-in deployment script carries the same defaults for future recreation.
