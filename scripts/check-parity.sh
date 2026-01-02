#!/usr/bin/env bash
set -euo pipefail

# Parity checklist: web/dev/desktop-prod alignment (whisper.cpp + FastAPI).

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/desktop"
RESOURCE_DIR="$DESKTOP_DIR/dist/mac-arm64/TranscriptAI.app/Contents/Resources"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }

echo "Parity checklist (web/dev/desktop-prod)"

# 1) Env registry presence
[[ -f "$ROOT_DIR/docs/env/ENVIRONMENT.md" ]] && ok "ENVIRONMENT.md exists" || fail "Missing docs/env/ENVIRONMENT.md"

# 2) Desktop resources presence (prod bundle)
if [[ -d "$RESOURCE_DIR" ]]; then
  [[ -f "$RESOURCE_DIR/whisper-server" ]] && ok "whisper-server present in Resources" || fail "Missing whisper-server in Resources"
  [[ -f "$RESOURCE_DIR/models/ggml-base.en.bin" ]] && ok "ggml model present in Resources" || fail "Missing ggml model in Resources"
else
  warn "Desktop Resources not found (build not present): $RESOURCE_DIR"
fi

# 3) Backend start (web/dev) sanity
if curl -fsS "http://127.0.0.1:8001/health" >/dev/null 2>&1; then
  ok "Backend /health reachable on 8001"
  if command -v python3 >/dev/null 2>&1; then
    status=$(python3 - <<'PY'
import json, urllib.request
url="http://127.0.0.1:8001/health"
data=json.loads(urllib.request.urlopen(url, timeout=2).read().decode("utf-8"))
print(data.get("models", {}).get("whisper", {}).get("status", "unknown"))
PY
)
    [[ "$status" == "ready" ]] && ok "Whisper status=ready" || warn "Whisper status=$status (expected ready)"
  fi
else
  warn "Backend /health not reachable on 8001 (start it before running this script)"
fi

echo "Done."
