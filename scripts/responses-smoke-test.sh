#!/usr/bin/env bash
set -euo pipefail

ROUTER_URL="${ROUTER_URL:-http://192.168.1.21:11434}"
ADMIN_URL="${ADMIN_URL:-http://192.168.1.21:11435}"
ROUTER_URL="${ROUTER_URL%/}"
ADMIN_URL="${ADMIN_URL%/}"
ACTIVE_MODEL="${1:-}"

if [[ -z "$ACTIVE_MODEL" ]]; then
  ACTIVE_MODEL="$(curl -fsS "$ROUTER_URL/health" | jq -er '.activeModel.model | select(type == "string" and length > 0)')"
fi

SMOKE_CLIENT="responses-smoke-$$"
SMOKE_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$SMOKE_DIR"
}
trap cleanup EXIT

BEFORE_ACTIVE="$(curl -fsS "$ROUTER_URL/health" | jq -er '.activeModel.model')"
BEFORE_LOADED="$(curl -fsS "$ROUTER_URL/api/ps" | jq -c '[.models[]? | (.name // .model)] | sort')"

if [[ "$ACTIVE_MODEL" != "$BEFORE_ACTIVE" ]]; then
  echo "Requested smoke model does not match the router active model." >&2
  exit 1
fi

echo "1. Streamed Responses text"
curl -fsS -N "$ROUTER_URL/v1/responses" \
  -H 'content-type: application/json' \
  -H "x-client-name: $SMOKE_CLIENT" \
  -d "$(jq -cn --arg model "$ACTIVE_MODEL" '{model:$model,input:"Reply with a five-word router health check.",stream:true,store:false,max_output_tokens:64}')" \
  > "$SMOKE_DIR/text.sse"
grep -q '"type":"response.output_text.delta"' "$SMOKE_DIR/text.sse"
grep -q '"type":"response.completed"' "$SMOKE_DIR/text.sse"
grep -q '^data: \[DONE\]$' "$SMOKE_DIR/text.sse"

echo "2. Function call"
TOOL_RESPONSE="$(curl -fsS "$ROUTER_URL/v1/responses" \
  -H 'content-type: application/json' \
  -H "x-client-name: $SMOKE_CLIENT" \
  -d "$(jq -cn --arg model "$ACTIVE_MODEL" '{
    model:$model,
    input:"Call get_test_value now with key router_smoke. Do not answer from memory; use the function.",
    store:false,
    tools:[{
      type:"function",
      name:"get_test_value",
      description:"Returns a harmless deterministic test value.",
      parameters:{type:"object",properties:{key:{type:"string"}},required:["key"],additionalProperties:false},
      strict:false
    }],
    tool_choice:"auto"
  }')")"
CALL_ITEM="$(jq -cer '.output[] | select(.type == "function_call" and .name == "get_test_value")' <<< "$TOOL_RESPONSE")"
CALL_ID="$(jq -er '.call_id' <<< "$CALL_ITEM")"

echo "3. Tool result follow-up"
FOLLOW_UP_BODY="$(jq -cn \
  --arg model "$ACTIVE_MODEL" \
  --arg call_id "$CALL_ID" \
  --argjson call "$CALL_ITEM" \
  '{
    model:$model,
    input:[
      {role:"user",content:"Call get_test_value now with key router_smoke. Do not answer from memory; use the function."},
      $call,
      {type:"function_call_output",call_id:$call_id,output:"router-smoke-42"}
    ],
    store:false,
    tools:[{
      type:"function",
      name:"get_test_value",
      description:"Returns a harmless deterministic test value.",
      parameters:{type:"object",properties:{key:{type:"string"}},required:["key"],additionalProperties:false},
      strict:false
    }],
    tool_choice:"auto"
  }')"
FOLLOW_UP_RESPONSE="$(curl -fsS "$ROUTER_URL/v1/responses" \
  -H 'content-type: application/json' \
  -H "x-client-name: $SMOKE_CLIENT" \
  -d "$FOLLOW_UP_BODY")"
FINAL_TEXT="$(jq -r '[.output[]? | select(.type == "message") | .content[]? | select(.type == "output_text") | .text] | join("")' <<< "$FOLLOW_UP_RESPONSE")"
grep -q 'router-smoke-42' <<< "$FINAL_TEXT"

echo "4. Fixed-model invariant"
AFTER_ACTIVE="$(curl -fsS "$ROUTER_URL/health" | jq -er '.activeModel.model')"
AFTER_LOADED="$(curl -fsS "$ROUTER_URL/api/ps" | jq -c '[.models[]? | (.name // .model)] | sort')"
[[ "$AFTER_ACTIVE" == "$BEFORE_ACTIVE" ]]
[[ "$AFTER_LOADED" == "$BEFORE_LOADED" ]]

if curl -fsS "$ADMIN_URL/admin/api/requests?limit=100" > "$SMOKE_DIR/history.json"; then
  jq -e --arg client "$SMOKE_CLIENT" '
    [.requests[] | select(.clientIdentity == $client)] as $smoke
    | ($smoke | length) >= 3
      and ([$smoke[] | select(.forwardedModel != $smoke[0].activeModel)] | length == 0)
      and ([$smoke[] | select(.endpoint | test("^/api/(pull|create|copy|push|delete)$"))] | length == 0)
  ' "$SMOKE_DIR/history.json" > /dev/null
fi

echo "Responses smoke test passed."
echo "Active model remained: $AFTER_ACTIVE"
echo "Tool result incorporated: $FINAL_TEXT"
