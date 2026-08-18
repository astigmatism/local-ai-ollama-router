#!/usr/bin/env bash
set -euo pipefail

MODEL="${1:-}"
PROFILE="${2:-manual}"
DEFAULT_THINK="${3:-}"
TARGET="${ACTIVE_MODEL_FILE:-./runtime/active-model.json}"

if [[ -z "$MODEL" ]]; then
  echo "usage: $0 <model> [profile] [default-think]" >&2
  exit 2
fi

mkdir -p "$(dirname "$TARGET")"
DEFAULT_THINK_LINE=""
if [[ -n "$DEFAULT_THINK" ]]; then
  DEFAULT_THINK_LINE="  \"default_think\": \"$DEFAULT_THINK\","
fi
cat > "$TARGET" <<JSON
{
  "profile": "$PROFILE",
  "model": "$MODEL",
  "keep_alive": -1,
$DEFAULT_THINK_LINE
  "updated_at": "$(date -Iseconds)",
  "source": "scripts/write-active-model.sh"
}
JSON

echo "Wrote $TARGET"
