# Nighttime vision deployment

The installed `windowsxp811203/Qwen3.8-27B-Abliterated-GGUF` Q6_K supports images. Its [pinned model card](https://huggingface.co/windowsxp811203/Qwen3.8-27B-Abliterated-GGUF/blob/efb07baa690a1bc7beb53ee067b4b57c7025b5e7/README.md) documents vision and preserves the base vision tower. The earlier text-only declaration described an incomplete deployment, not a limitation of the model.

That deployment omitted `mmproj-Qwen3.8-27B-Abliterated-F16.gguf` (927,607,328 bytes, SHA256 `b73b89b52c21e90468f0c61d1190cb22c3f229f9ddd2792e9eafd55302fabdd4`) from the same revision as its main weights. The migration adds this matching projector on CPU using `--mmproj /weights/projector.gguf --no-mmproj-offload --mmproj-device none`. GPU assignments, transformer/KV residency, context, sampling, output and thinking policy remain as qualified.

This is a separately authorized inference migration. It is not part of the router-only publisher. Develop and publish locally, then execute from a clean checkout of that Git revision on the production host:

```sh
python3 -B scripts/primary/deploy-nighttime-vision.py
docker exec -i open-webui python - apply < integrations/open-webui/align-nighttime-tools.py
```

The migration pins the reviewed pre-change manifest, Compose and catalog hashes and refuses drift. It verifies the artifact before maintenance, takes the primary lifecycle lock, backs up the current configuration privately, drains accepted work, checks direct slots, and recreates only Nighttime. It preserves the server-owned fallback configuration. Two different synthetic image layouts must be recognized with natural completion, once with thinking disabled and once enabled. Only then does it publish vision capability and extend the existing qualification receipt with this migration's evidence. The daytime container ID must remain unchanged. On failure it restores the immediately preceding configuration and checks readiness; a failed recovery leaves admission drained. Historical rollback profiles are never selected.

The OpenWebUI alignment then enables vision in both Nighttime presets using router discovery, retaining their saved generation settings and existing tool parity. Verify actual image conversations through both presets, including their final responses and completed router records. Configuration flags alone do not establish image support. The CPU projector adds host work during image encoding; these acceptance checks are not a throughput or interference benchmark.
