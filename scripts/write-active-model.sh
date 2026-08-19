#!/usr/bin/env bash
set -euo pipefail

MODEL="${1:-}"
PROFILE="${2:-manual}"
DEFAULT_THINK="${3:-}"
REASONING_CAPABILITIES_FILE="${4:-}"
TARGET="${ACTIVE_MODEL_FILE:-./runtime/active-model.json}"

if [[ -z "$MODEL" ]]; then
  echo "usage: $0 <model> [profile] [default-think] [reasoning-capabilities-json-file]" >&2
  exit 2
fi

node --input-type=module - "$TARGET" "$MODEL" "$PROFILE" "$DEFAULT_THINK" "$REASONING_CAPABILITIES_FILE" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

const [target, model, profile, defaultThink, capabilitiesFile] = process.argv.slice(2);
let reasoningCapabilities = {};
if (capabilitiesFile) {
  const parsed = JSON.parse(fs.readFileSync(capabilitiesFile, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('reasoning capabilities file must contain a JSON object');
  }
  if (!Object.hasOwn(parsed, 'supported_think_levels') || !Object.hasOwn(parsed, 'reasoning_effort_map')) {
    throw new TypeError('reasoning capabilities file must define supported_think_levels and reasoning_effort_map');
  }
  reasoningCapabilities = {
    supported_think_levels: parsed.supported_think_levels,
    reasoning_effort_map: parsed.reasoning_effort_map
  };
}

const payload = {
  profile,
  model,
  keep_alive: -1,
  ...(defaultThink ? { default_think: defaultThink } : {}),
  ...reasoningCapabilities,
  updated_at: new Date().toISOString(),
  source: 'scripts/write-active-model.sh'
};
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
NODE

echo "Wrote $TARGET"
