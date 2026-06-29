#!/usr/bin/env bash
set -euo pipefail

ROUTER_URL="${ROUTER_URL:-http://192.168.1.21:11435}"
RAW_URL="${RAW_URL:-http://192.168.1.21:11434}"
ADMIN_TOKEN="${ADMIN_TOKEN:-change-me-before-lan-exposure}"

echo "Router version:"
curl -fsS "$ROUTER_URL/api/version" || true
printf '\n\nRouter admin summary:\n'
curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" "$ROUTER_URL/admin/api/summary" | jq '{activeModel, activeLoadedState, upstream, metrics}' || true
printf '\n\nRaw Ollama direct LAN exposure check:\n'
if curl -fsS --max-time 3 "$RAW_URL/api/version" >/tmp/raw-ollama-version.json; then
  echo "WARNING: raw Ollama still appears reachable at $RAW_URL"
  cat /tmp/raw-ollama-version.json
else
  echo "OK: raw Ollama direct endpoint not reachable at $RAW_URL"
fi
