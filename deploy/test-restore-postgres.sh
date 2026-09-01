#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /path/to/epd-light-*.dump.enc" >&2
  exit 2
fi

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
BACKUP_FILE="$1"
TEST_URL="${EPD_RESTORE_TEST_DATABASE_URL:-}"
PROD_URL="${EPD_DATABASE_URL:-}"
CONFIRM="${EPD_RESTORE_TEST_CONFIRM:-}"
PASSPHRASE="${EPD_BACKUP_PASSPHRASE:-}"
POSTGRES_IMAGE="${EPD_POSTGRES_CLIENT_IMAGE:-postgres:17-alpine}"

if [ "$CONFIRM" != "RESTORE_TEST_ONLY" ]; then
  echo "ERROR: set EPD_RESTORE_TEST_CONFIRM=RESTORE_TEST_ONLY" >&2
  exit 1
fi
if [ -z "$TEST_URL" ]; then
  echo "ERROR: EPD_RESTORE_TEST_DATABASE_URL is required" >&2
  exit 1
fi
if [ -n "$PROD_URL" ] && [ "$TEST_URL" = "$PROD_URL" ]; then
  echo "ERROR: restore test URL matches EPD_DATABASE_URL; refusing destructive restore" >&2
  exit 1
fi
if [ -z "$PASSPHRASE" ]; then
  echo "ERROR: EPD_BACKUP_PASSPHRASE is required" >&2
  exit 1
fi
if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: backup file not found" >&2
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1 || ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker and openssl are required" >&2
  exit 1
fi

DB_NAME="$(printf '%s' "$TEST_URL" | sed 's/[?#].*$//' | awk -F/ '{print $NF}' | tr '[:upper:]' '[:lower:]')"
case "$DB_NAME" in
  *test*|*restore*|*staging*) ;;
  *)
    echo "ERROR: test database name must contain test, restore, or staging" >&2
    exit 1
    ;;
esac

EPD_BACKUP_PASSPHRASE="$PASSPHRASE" sh "$ROOT_DIR/deploy/verify-postgres-backup.sh" "$BACKUP_FILE" >/dev/null

BACKUP_DIR="$(CDPATH= cd -- "$(dirname -- "$BACKUP_FILE")" && pwd)"
TMP_FILE="$BACKUP_DIR/.restore-test-$$.dump"
cleanup() { rm -f "$TMP_FILE"; }
trap cleanup EXIT HUP INT TERM

EPD_BACKUP_PASSPHRASE="$PASSPHRASE" openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 \
  -pass env:EPD_BACKUP_PASSPHRASE \
  -in "$BACKUP_FILE" \
  -out "$TMP_FILE"
chmod 600 "$TMP_FILE" 2>/dev/null || true

TMP_BASENAME="$(basename "$TMP_FILE")"

echo "Restoring encrypted backup into dedicated test database: $DB_NAME"
docker run --rm \
  -e EPD_RESTORE_TEST_DATABASE_URL="$TEST_URL" \
  -v "$BACKUP_DIR:/backup:ro" \
  "$POSTGRES_IMAGE" \
  sh -eu -c 'pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error --dbname="$EPD_RESTORE_TEST_DATABASE_URL" "/backup/'"$TMP_BASENAME"'"'

CHECK="$(docker run --rm \
  -e EPD_RESTORE_TEST_DATABASE_URL="$TEST_URL" \
  "$POSTGRES_IMAGE" \
  sh -eu -c 'psql "$EPD_RESTORE_TEST_DATABASE_URL" -Atqc "select (to_regclass('"'"'public.documents'"'"') is not null and to_regclass('"'"'public.profiles'"'"') is not null)::text"')"

if [ "$CHECK" != "true" ]; then
  echo "ERROR: restore completed but required EPD Light tables are missing" >&2
  exit 1
fi

echo "Restore drill OK: archive restored and required tables are present in $DB_NAME"
