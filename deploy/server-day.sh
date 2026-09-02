#!/usr/bin/env sh
set -eu

ENV_FILE="${1:-.env.production}"
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: env file not found: $ENV_FILE" >&2
  echo "Create it from .env.example and fill production values first." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is not installed" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: docker compose plugin is not available" >&2
  exit 1
fi

run_node() {
  docker run --rm \
    --env-file "$ENV_FILE" \
    -v "$ROOT_DIR:/app:ro" \
    -w /app \
    node:22-alpine node "$@"
}

dc() {
  docker compose --env-file "$ENV_FILE" "$@"
}

echo "== EPD Light server-day prechecks =="
run_node scripts/check-deployment-env.mjs
run_node scripts/preflight-deploy.mjs
run_node scripts/preflight-runtime.mjs
run_node scripts/preflight.mjs
run_node scripts/test-deployment-env.mjs
run_node scripts/test-web-security.mjs
run_node scripts/test-audit.mjs
run_node scripts/test-authorization.mjs
run_node scripts/test-supabase-repository.mjs
run_node scripts/test-operator-attempt-repository.mjs
run_node scripts/test-operator-attempt-client.mjs
run_node scripts/test-idempotency.mjs
run_node scripts/test-billing-foundation.mjs
run_node scripts/test-rate-limit.mjs
run_node scripts/test-gateway.mjs
run_node scripts/test-kontur-userdata.mjs
run_node scripts/test-kontur-generation.mjs
run_node scripts/test-kontur-sandbox.mjs

echo "== Docker Compose config =="
dc config >/dev/null

echo "== Build and start =="
dc up -d --build

echo "== Wait for web health =="
i=0
while [ "$i" -lt 40 ]; do
  if dc exec -T web wget -q -O /dev/null http://127.0.0.1:8080/healthz 2>/dev/null; then
    break
  fi
  i=$((i + 1))
  sleep 2
done
if [ "$i" -ge 40 ]; then
  echo "ERROR: web did not become healthy" >&2
  dc ps >&2 || true
  exit 1
fi

echo "== Gateway capabilities =="
CAPS="$(dc exec -T web wget -q -O - http://127.0.0.1:8080/api/operator/capabilities)"
if ! printf '%s' "$CAPS" | grep -q '"externalSendEnabled":false'; then
  echo "ERROR: gateway does not report externalSendEnabled=false" >&2
  exit 1
fi
if printf '%s' "$CAPS" | grep -q '"mode":"sandbox"'; then
  if ! printf '%s' "$CAPS" | grep -q '"persistentAttemptJournal"'; then
    echo "ERROR: sandbox capabilities do not expose persistent journal status" >&2
    exit 1
  fi
fi
printf '%s\n' "$CAPS"

echo "== Web security headers =="
HEADERS="$(dc exec -T web wget -S -O /dev/null http://127.0.0.1:8080/ 2>&1 || true)"
printf '%s' "$HEADERS" | grep -qi 'Content-Security-Policy:' || { echo "ERROR: CSP header missing" >&2; exit 1; }
printf '%s' "$HEADERS" | grep -qi 'X-Frame-Options: DENY' || { echo "ERROR: X-Frame-Options header missing" >&2; exit 1; }
printf '%s' "$HEADERS" | grep -qi 'X-Content-Type-Options: nosniff' || { echo "ERROR: nosniff header missing" >&2; exit 1; }

echo "== Deployment started safely =="
echo "Project HTTP is bound to 127.0.0.1:8080. Put an HTTPS reverse proxy in front of it before public access."
