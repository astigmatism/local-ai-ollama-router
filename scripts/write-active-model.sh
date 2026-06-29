#!/usr/bin/env bash
set -euo pipefail

MODEL="${1:-}"
PROFILE="${2:-manual}"
TARGET="${ACTIVE_MODEL_FILE:-./runtime/active-model.json}"

if [[ -z "$MODEL" ]]; then
  echo "usage: $0 <model> [profile]" >&2
  exit 2
fi

mkdir -p "$(dirname "$TARGET")"
cat > "$TARGET" <<JSON
{
  "profile": "$PROFILE",
  "model": "$MODEL",
  "keep_alive": -1,
  "updated_at": "$(date -Iseconds)",
  "source": "scripts/write-active-model.sh"
}
JSON

echo "Wrote $TARGET"
