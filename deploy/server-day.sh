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
if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git is required for traceable production deployment" >&2
  exit 1
fi
if [ "$(git rev-parse --is-inside-work-tree 2>/dev/null || true)" != "true" ]; then
  echo "ERROR: server-day must run from a git checkout" >&2
  exit 1
fi
DIRTY="$(git status --porcelain --untracked-files=normal)"
if [ -n "$DIRTY" ]; then
  echo "ERROR: production checkout is dirty; commit/stash/remove local source changes before deployment" >&2
  printf '%s\n' "$DIRTY" >&2
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

BUILD_COMMIT="$(git rev-parse --verify HEAD 2>/dev/null || true)"
if ! printf '%s' "$BUILD_COMMIT" | grep -Eq '^[0-9a-fA-F]{40,64}$'; then
  echo "ERROR: deployment requires a full traceable git commit" >&2
  exit 1
fi
BUILD_COMMIT="$(printf '%s' "$BUILD_COMMIT" | tr 'A-F' 'a-f')"
BUILD_TIME="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
RELEASE="$(awk -F'"' '/^[[:space:]]*"version"[[:space:]]*:/{print $4; exit}' package.json)"
if ! printf '%s' "$RELEASE" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$'; then
  echo "ERROR: package.json version is missing or invalid" >&2
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
  EPD_RELEASE="$RELEASE" \
  EPD_BUILD_COMMIT="$BUILD_COMMIT" \
  EPD_BUILD_TIME="$BUILD_TIME" \
  docker compose --env-file "$ENV_FILE" "$@"
}

echo "== EPD Light server-day prechecks =="
echo "Release: $RELEASE"
echo "Deploy commit: $BUILD_COMMIT"
echo "Build time: $BUILD_TIME"
run_node scripts/check-deployment-env.mjs
run_node scripts/check-billing-env.mjs
run_node scripts/preflight-deploy.mjs
run_node scripts/preflight-migrations.mjs
run_node scripts/preflight-backup.mjs
run_node scripts/preflight-billing.mjs
run_node scripts/preflight-runtime.mjs
run_node scripts/preflight.mjs
run_node scripts/test-deployment-env.mjs
run_node scripts/test-billing-env.mjs
run_node scripts/test-build-info.mjs
run_node scripts/test-dependency-check.mjs
run_node scripts/test-readiness.mjs
run_node scripts/test-web-security.mjs
run_node scripts/test-audit.mjs
run_node scripts/test-authorization.mjs
run_node scripts/test-supabase-repository.mjs
run_node scripts/test-operator-attempt-repository.mjs
run_node scripts/test-operator-attempt-client.mjs
run_node scripts/test-idempotency.mjs
run_node scripts/test-billing-foundation.mjs
run_node scripts/test-billing-payment-boundary.mjs
run_node scripts/test-billing-payment-client.mjs
run_node scripts/test-rate-limit.mjs
run_node scripts/test-gateway.mjs
run_node scripts/test-kontur-userdata.mjs
run_node scripts/test-kontur-generation.mjs
run_node scripts/test-kontur-sandbox.mjs

echo "== Production migration registry check =="
sh "$ROOT_DIR/deploy/check-migrations.sh" "$ENV_FILE"

echo "== Production backup readiness =="
sh "$ROOT_DIR/deploy/check-backup-readiness.sh" "$ENV_FILE"

echo "== Production dependency smoke check =="
run_node scripts/check-runtime-dependencies.mjs

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

echo "== Runtime version =="
VERSION="$(dc exec -T web wget -q -O - http://127.0.0.1:8080/api/system/version)"
for EXPECTED in \
  '"traceableBuild":true' \
  '"sensitiveValuesIncluded":false' \
  "\"release\":\"$RELEASE\"" \
  "\"commit\":\"$BUILD_COMMIT\""
do
  if ! printf '%s' "$VERSION" | grep -q "$EXPECTED"; then
    echo "ERROR: runtime version does not match deployment source: $EXPECTED" >&2
    printf '%s\n' "$VERSION" >&2
    exit 1
  fi
done
printf '%s\n' "$VERSION"

echo "== Operator gateway capabilities =="
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

echo "== Billing capabilities =="
BILLING_CAPS="$(dc exec -T web wget -q -O - http://127.0.0.1:8080/api/billing/capabilities)"
for EXPECTED in \
  '"provider":"none"' \
  '"checkoutEnabled":false' \
  '"webhookEnabled":false' \
  '"realMoneyEnabled":false' \
  '"successRedirectAuthoritative":false' \
  '"directRuntimeSubscriptionUpdateAllowed":false' \
  '"entitlementDatabaseFunctionRequired":true'
do
  if ! printf '%s' "$BILLING_CAPS" | grep -q "$EXPECTED"; then
    echo "ERROR: billing capabilities violated fail-closed invariant: $EXPECTED" >&2
    exit 1
  fi
done
printf '%s\n' "$BILLING_CAPS"

echo "== Technical readiness =="
READINESS="$(dc exec -T web wget -q -O - http://127.0.0.1:8080/api/system/readiness)"
for EXPECTED in \
  '"technicalReadinessOnly":true' \
  '"legalReadinessClaimed":false' \
  '"productionBaselineReady":true' \
  '"traceableRuntimeBuild":true' \
  '"sensitiveValuesIncluded":false'
do
  if ! printf '%s' "$READINESS" | grep -q "$EXPECTED"; then
    echo "ERROR: technical readiness invariant failed: $EXPECTED" >&2
    printf '%s\n' "$READINESS" >&2
    exit 1
  fi
done
printf '%s\n' "$READINESS"

echo "== Web security headers =="
HEADERS="$(dc exec -T web wget -S -O /dev/null http://127.0.0.1:8080/ 2>&1 || true)"
printf '%s' "$HEADERS" | grep -qi 'Content-Security-Policy:' || { echo "ERROR: CSP header missing" >&2; exit 1; }
printf '%s' "$HEADERS" | grep -qi 'X-Frame-Options: DENY' || { echo "ERROR: X-Frame-Options header missing" >&2; exit 1; }
printf '%s' "$HEADERS" | grep -qi 'X-Content-Type-Options: nosniff' || { echo "ERROR: nosniff header missing" >&2; exit 1; }

echo "== Deployment started safely =="
echo "Runtime release/commit verified: $RELEASE @ $BUILD_COMMIT"
echo "Production migration registry exactly matches this clean checkout."
echo "A recent encrypted PostgreSQL backup passed checksum, decryption and pg_restore verification."
echo "Supabase Auth JWKS and Data API billing foundation were reachable before launch."
echo "Project HTTP is bound to 127.0.0.1:8080. Put an HTTPS reverse proxy in front of it before public access."
echo "Technical production baseline is ready; this check does not claim legal or operator-production readiness."
echo "Billing provider, checkout, webhook and real money are confirmed disabled."
