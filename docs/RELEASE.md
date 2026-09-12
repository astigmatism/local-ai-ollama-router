# Reviewed router publication

Commit and push reviewed router source before production builds. Use a clean checkout of that published revision, retaining the previous production checkout and its uncommitted historical artifacts separately. Do not apply source patches inside a running production container.

This release preserves the two resident services, unrestricted output/reasoning policy, formatted-context admission and cancellable FIFO queues. It restores the configured stable alias as an additional OpenAI discovery row. Native/admin resident counts stay canonical-only. Harness must also publish its consumer companion; an alias row does not make historical capacity/default/finite-output assertions valid.

From a clean release checkout on the deployment host:

```sh
revision=$(git rev-parse HEAD)
image="local-ai-ollama-router:git-$revision"
docker build --build-arg "VCS_REF=$revision" -t "$image" .
ROUTER_PUBLICATION_IMAGE="$image" python3 scripts/primary/deploy-router-only.py
```

The publisher refuses a dirty checkout or an image whose `org.opencontainers.image.revision` label differs from the checkout. It runs all Node tests sequentially in the image, checks the installed controller against the reviewed source, and captures private backups. It drains accepted active and queued work before replacing only `ai-router` with `--no-deps`. It then republishes the canonical catalog and verifies both inference container IDs are unchanged before reopening admission. The receipt records source commit, image ID and configuration hashes.

Coordinate this step with the owner of any simultaneous service rename or Harness acceptance. Do not overwrite server-owned inference manifests, Compose variants, qualification receipts or running backend arguments. A drain timeout must not stop an inference process. If readiness fails, inspect the failed release while admission remains drained; do not restore historical backend profiles.

Validate public `/v1/models` alias/target metadata, canonical native/admin counts, queue completion/cancellation and client acceptance after publication. The production Harness update and restart belongs to its existing updater and deployment owner. Keep private prompts, journals, runtime settings, raw logs and operational evidence outside Git; source tests use synthetic fixtures.

Local source checks:

```sh
node --test --test-concurrency=1 test/*.test.js
npm run lint:syntax
python3 scripts/primary/test_primary.py
python3 scripts/primary/test_deploy_router_only.py
```
