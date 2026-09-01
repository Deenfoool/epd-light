#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: EPD_BACKUP_PASSPHRASE=... $0 /path/to/epd-light-*.dump.enc" >&2
  exit 2
fi

BACKUP_FILE="$1"
PASSPHRASE="${EPD_BACKUP_PASSPHRASE:-}"
POSTGRES_IMAGE="${EPD_POSTGRES_CLIENT_IMAGE:-postgres:17-alpine}"

if [ ! -f "$BACKUP_FILE" ] || [ ! -s "$BACKUP_FILE" ]; then
  echo "ERROR: backup file not found or empty: $BACKUP_FILE" >&2
  exit 1
fi
if [ -z "$PASSPHRASE" ]; then
  echo "ERROR: EPD_BACKUP_PASSPHRASE is required" >&2
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl is required" >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required" >&2
  exit 1
fi

BACKUP_DIR="$(CDPATH= cd -- "$(dirname -- "$BACKUP_FILE")" && pwd)"
BASENAME="$(basename "$BACKUP_FILE")"
CHECKSUM_FILE="$BACKUP_FILE.sha256"
TMP_FILE="$BACKUP_DIR/.verify-$$.dump"

cleanup() {
  rm -f "$TMP_FILE"
}
trap cleanup EXIT HUP INT TERM

if [ ! -f "$CHECKSUM_FILE" ]; then
  echo "ERROR: checksum file not found: $CHECKSUM_FILE" >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$BACKUP_DIR" && sha256sum -c "$(basename "$CHECKSUM_FILE")") >/dev/null
elif command -v shasum >/dev/null 2>&1; then
  EXPECTED="$(awk '{print $1}' "$CHECKSUM_FILE")"
  ACTUAL="$(shasum -a 256 "$BACKUP_FILE" | awk '{print $1}')"
  if [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "ERROR: SHA-256 mismatch" >&2
    exit 1
  fi
else
  echo "ERROR: sha256sum or shasum is required" >&2
  exit 1
fi

EPD_BACKUP_PASSPHRASE="$PASSPHRASE" openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 \
  -pass env:EPD_BACKUP_PASSPHRASE \
  -in "$BACKUP_FILE" \
  -out "$TMP_FILE"
chmod 600 "$TMP_FILE" 2>/dev/null || true

if [ ! -s "$TMP_FILE" ]; then
  echo "ERROR: decrypted archive is empty" >&2
  exit 1
fi

docker run --rm \
  -v "$BACKUP_DIR:/backup:ro" \
  "$POSTGRES_IMAGE" \
  pg_restore --list "/backup/$(basename "$TMP_FILE")" >/dev/null

echo "Backup verified: $BASENAME"
