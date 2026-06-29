#!/usr/bin/env bash
set -euo pipefail

OUT="${1:-router-logs-$(date +%Y%m%d-%H%M%S).tar.gz}"
tar -czf "$OUT" data runtime
printf 'Wrote %s\n' "$OUT"
