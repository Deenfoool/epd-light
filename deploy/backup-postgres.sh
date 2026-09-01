#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
DB_URL="${EPD_DATABASE_URL:-}"
BACKUP_DIR="${EPD_BACKUP_DIR:-$ROOT_DIR/.backups}"
RETENTION_DAYS="${EPD_BACKUP_RETENTION_DAYS:-14}"
POSTGRES_IMAGE="${EPD_POSTGRES_CLIENT_IMAGE:-postgres:17-alpine}"

if [ -z "$DB_URL" ]; then
  echo "ERROR: EPD_DATABASE_URL is required" >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is not installed" >&2
  exit 1
fi
case "$RETENTION_DAYS" in
  ''|*[!0-9]*) echo "ERROR: EPD_BACKUP_RETENTION_DAYS must be an integer" >&2; exit 1 ;;
esac
if [ "$RETENTION_DAYS" -lt 1 ]; then
  echo "ERROR: EPD_BACKUP_RETENTION_DAYS must be >= 1" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASENAME="epd-light-${STAMP}.dump"
TMP_FILE="$BACKUP_DIR/.${BASENAME}.tmp"
FINAL_FILE="$BACKUP_DIR/$BASENAME"
CHECKSUM_FILE="$FINAL_FILE.sha256"
META_FILE="$FINAL_FILE.meta"

cleanup() {
  rm -f "$TMP_FILE"
}
trap cleanup EXIT HUP INT TERM

echo "Creating PostgreSQL backup: $FINAL_FILE"
# The database URL is passed only as an environment variable into the temporary client container.
# It is never printed by this script and is not embedded into the backup metadata.
docker run --rm \
  -e EPD_DATABASE_URL="$DB_URL" \
  -v "$BACKUP_DIR:/backup" \
  "$POSTGRES_IMAGE" \
  sh -eu -c 'pg_dump --format=custom --compress=6 --no-owner --no-acl --file="/backup/.backup.tmp" "$EPD_DATABASE_URL"'

mv "$BACKUP_DIR/.backup.tmp" "$TMP_FILE"
if [ ! -s "$TMP_FILE" ]; then
  echo "ERROR: pg_dump produced an empty file" >&2
  exit 1
fi
mv "$TMP_FILE" "$FINAL_FILE"
chmod 600 "$FINAL_FILE" 2>/dev/null || true

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$BACKUP_DIR" && sha256sum "$BASENAME") > "$CHECKSUM_FILE"
elif command -v shasum >/dev/null 2>&1; then
  (cd "$BACKUP_DIR" && shasum -a 256 "$BASENAME") > "$CHECKSUM_FILE"
else
  echo "ERROR: sha256sum or shasum is required" >&2
  exit 1
fi
chmod 600 "$CHECKSUM_FILE" 2>/dev/null || true

{
  echo "created_at_utc=$STAMP"
  echo "format=postgres-custom"
  echo "postgres_client_image=$POSTGRES_IMAGE"
  echo "filename=$BASENAME"
  echo "contains_database_url=false"
} > "$META_FILE"
chmod 600 "$META_FILE" 2>/dev/null || true

# Verify that pg_restore can read the custom archive directory-of-contents.
docker run --rm \
  -v "$BACKUP_DIR:/backup:ro" \
  "$POSTGRES_IMAGE" \
  pg_restore --list "/backup/$BASENAME" >/dev/null

echo "Backup archive verified."

# Remove only old EPD Light backup triplets from this dedicated directory.
find "$BACKUP_DIR" -type f \
  \( -name 'epd-light-*.dump' -o -name 'epd-light-*.dump.sha256' -o -name 'epd-light-*.dump.meta' \) \
  -mtime "+$RETENTION_DAYS" -delete 2>/dev/null || true

echo "Backup complete: $FINAL_FILE"
echo "Checksum: $CHECKSUM_FILE"
