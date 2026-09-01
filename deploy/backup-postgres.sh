#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
DB_URL="${EPD_DATABASE_URL:-}"
BACKUP_DIR="${EPD_BACKUP_DIR:-$ROOT_DIR/.backups}"
RETENTION_DAYS="${EPD_BACKUP_RETENTION_DAYS:-14}"
POSTGRES_IMAGE="${EPD_POSTGRES_CLIENT_IMAGE:-postgres:17-alpine}"
PASSPHRASE="${EPD_BACKUP_PASSPHRASE:-}"

if [ -z "$DB_URL" ]; then
  echo "ERROR: EPD_DATABASE_URL is required" >&2
  exit 1
fi
if [ -z "$PASSPHRASE" ] || [ "${#PASSPHRASE}" -lt 20 ]; then
  echo "ERROR: EPD_BACKUP_PASSPHRASE must contain at least 20 characters" >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is not installed" >&2
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl is required for encrypted backups" >&2
  exit 1
fi
case "$RETENTION_DAYS" in
  ''|*[!0-9]*) echo "ERROR: EPD_BACKUP_RETENTION_DAYS must be an integer" >&2; exit 1 ;;
esac
if [ "$RETENTION_DAYS" -lt 1 ]; then
  echo "ERROR: EPD_BACKUP_RETENTION_DAYS must be >= 1" >&2
  exit 1
fi

case "$BACKUP_DIR" in
  /*) ;;
  *) BACKUP_DIR="$ROOT_DIR/$BACKUP_DIR" ;;
esac
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASENAME="epd-light-${STAMP}.dump.enc"
PLAIN_TMP="$BACKUP_DIR/.epd-light-${STAMP}.dump.tmp"
ENC_TMP="$BACKUP_DIR/.${BASENAME}.tmp"
FINAL_FILE="$BACKUP_DIR/$BASENAME"
CHECKSUM_FILE="$FINAL_FILE.sha256"
META_FILE="$FINAL_FILE.meta"

cleanup() {
  rm -f "$PLAIN_TMP" "$ENC_TMP"
}
trap cleanup EXIT HUP INT TERM

echo "Creating encrypted PostgreSQL backup: $FINAL_FILE"

# The database URL exists only in the temporary pg client container environment.
docker run --rm \
  -e EPD_DATABASE_URL="$DB_URL" \
  -v "$BACKUP_DIR:/backup" \
  "$POSTGRES_IMAGE" \
  sh -eu -c 'pg_dump --format=custom --compress=6 --no-owner --no-acl --file="/backup/.epd-light-pgdump.tmp" "$EPD_DATABASE_URL"'

mv "$BACKUP_DIR/.epd-light-pgdump.tmp" "$PLAIN_TMP"
if [ ! -s "$PLAIN_TMP" ]; then
  echo "ERROR: pg_dump produced an empty file" >&2
  exit 1
fi
chmod 600 "$PLAIN_TMP" 2>/dev/null || true

# Check the PostgreSQL custom archive before encrypting it.
docker run --rm \
  -v "$BACKUP_DIR:/backup:ro" \
  "$POSTGRES_IMAGE" \
  pg_restore --list "/backup/$(basename "$PLAIN_TMP")" >/dev/null

# Store only encrypted backup material at rest. The passphrase is read from env and is never printed.
EPD_BACKUP_PASSPHRASE="$PASSPHRASE" openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -md sha256 \
  -pass env:EPD_BACKUP_PASSPHRASE \
  -in "$PLAIN_TMP" \
  -out "$ENC_TMP"
rm -f "$PLAIN_TMP"

if [ ! -s "$ENC_TMP" ]; then
  echo "ERROR: encryption produced an empty file" >&2
  exit 1
fi
mv "$ENC_TMP" "$FINAL_FILE"
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
  echo "format=postgres-custom+openssl-aes-256-cbc"
  echo "openssl_pbkdf2_iterations=200000"
  echo "postgres_client_image=$POSTGRES_IMAGE"
  echo "filename=$BASENAME"
  echo "contains_database_url=false"
  echo "contains_passphrase=false"
} > "$META_FILE"
chmod 600 "$META_FILE" 2>/dev/null || true

# Verify encrypted artifact end-to-end before announcing success.
EPD_BACKUP_PASSPHRASE="$PASSPHRASE" "$ROOT_DIR/deploy/verify-postgres-backup.sh" "$FINAL_FILE" >/dev/null

echo "Encrypted backup verified."

# Remove only old EPD Light encrypted backup triplets from this dedicated directory.
find "$BACKUP_DIR" -type f \
  \( -name 'epd-light-*.dump.enc' -o -name 'epd-light-*.dump.enc.sha256' -o -name 'epd-light-*.dump.enc.meta' \) \
  -mtime "+$RETENTION_DAYS" -delete 2>/dev/null || true

echo "Backup complete: $FINAL_FILE"
echo "Checksum: $CHECKSUM_FILE"
