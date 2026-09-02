#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
ENV_FILE="${1:-}"
BACKUP_DIR="${EPD_BACKUP_DIR:-.backups}"
PASSPHRASE="${EPD_BACKUP_PASSPHRASE:-}"
POSTGRES_IMAGE="${EPD_POSTGRES_CLIENT_IMAGE:-postgres:17-alpine}"
MAX_AGE_HOURS="${EPD_BACKUP_MAX_AGE_HOURS:-30}"

read_env_value() {
  key="$1"
  file="$2"
  awk -v prefix="$key=" 'index($0, prefix) == 1 { sub("^" prefix, ""); sub("\\r$", ""); print; exit }' "$file"
}

strip_outer_quotes() {
  value="$1"
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  printf '%s' "$value"
}

if [ -n "$ENV_FILE" ]; then
  case "$ENV_FILE" in
    /*) ;;
    *) ENV_FILE="$ROOT_DIR/$ENV_FILE" ;;
  esac
  if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: backup readiness env file not found" >&2
    exit 1
  fi
  if [ "${EPD_BACKUP_DIR:-}" = "" ]; then
    value="$(strip_outer_quotes "$(read_env_value EPD_BACKUP_DIR "$ENV_FILE")")"
    [ -z "$value" ] || BACKUP_DIR="$value"
  fi
  if [ -z "$PASSPHRASE" ]; then
    PASSPHRASE="$(strip_outer_quotes "$(read_env_value EPD_BACKUP_PASSPHRASE "$ENV_FILE")")"
  fi
  if [ "${EPD_POSTGRES_CLIENT_IMAGE:-}" = "" ]; then
    value="$(strip_outer_quotes "$(read_env_value EPD_POSTGRES_CLIENT_IMAGE "$ENV_FILE")")"
    [ -z "$value" ] || POSTGRES_IMAGE="$value"
  fi
  if [ "${EPD_BACKUP_MAX_AGE_HOURS:-}" = "" ]; then
    value="$(strip_outer_quotes "$(read_env_value EPD_BACKUP_MAX_AGE_HOURS "$ENV_FILE")")"
    [ -z "$value" ] || MAX_AGE_HOURS="$value"
  fi
fi

case "$MAX_AGE_HOURS" in
  ''|*[!0-9]*) echo "ERROR: EPD_BACKUP_MAX_AGE_HOURS must be an integer" >&2; exit 1 ;;
esac
if [ "$MAX_AGE_HOURS" -lt 1 ] || [ "$MAX_AGE_HOURS" -gt 168 ]; then
  echo "ERROR: EPD_BACKUP_MAX_AGE_HOURS must be between 1 and 168" >&2
  exit 1
fi
if [ -z "$PASSPHRASE" ]; then
  echo "ERROR: EPD_BACKUP_PASSPHRASE is required for backup readiness" >&2
  exit 1
fi
case "$POSTGRES_IMAGE" in
  *[!A-Za-z0-9._:/@-]*|'') echo "ERROR: unsafe EPD_POSTGRES_CLIENT_IMAGE" >&2; exit 1 ;;
esac

case "$BACKUP_DIR" in
  /*) ;;
  *) BACKUP_DIR="$ROOT_DIR/$BACKUP_DIR" ;;
esac
if [ ! -d "$BACKUP_DIR" ]; then
  echo "ERROR: backup directory does not exist; create and verify a production backup first" >&2
  exit 1
fi

NEWEST="$(ls -1t "$BACKUP_DIR"/epd-light-*.dump.enc 2>/dev/null | head -n 1 || true)"
if [ -z "$NEWEST" ] || [ ! -s "$NEWEST" ]; then
  echo "ERROR: no encrypted EPD Light backup found; run npm run backup:create first" >&2
  exit 1
fi
if [ ! -s "$NEWEST.sha256" ]; then
  echo "ERROR: newest backup has no SHA-256 sidecar" >&2
  exit 1
fi

MTIME="$(stat -c %Y "$NEWEST" 2>/dev/null || stat -f %m "$NEWEST" 2>/dev/null || true)"
case "$MTIME" in
  ''|*[!0-9]*) echo "ERROR: cannot determine newest backup modification time" >&2; exit 1 ;;
esac
NOW="$(date +%s)"
AGE_SECONDS=$((NOW - MTIME))
if [ "$AGE_SECONDS" -lt 0 ]; then
  echo "ERROR: newest backup timestamp is in the future" >&2
  exit 1
fi
MAX_AGE_SECONDS=$((MAX_AGE_HOURS * 3600))
if [ "$AGE_SECONDS" -gt "$MAX_AGE_SECONDS" ]; then
  AGE_HOURS=$((AGE_SECONDS / 3600))
  echo "ERROR: newest verified backup is stale (${AGE_HOURS}h > ${MAX_AGE_HOURS}h)" >&2
  exit 1
fi

export EPD_BACKUP_PASSPHRASE="$PASSPHRASE"
export EPD_POSTGRES_CLIENT_IMAGE="$POSTGRES_IMAGE"
sh "$ROOT_DIR/deploy/verify-postgres-backup.sh" "$NEWEST"

AGE_MINUTES=$((AGE_SECONDS / 60))
echo "Backup readiness OK: newest encrypted archive is ${AGE_MINUTES} minutes old and passed SHA-256/decryption/pg_restore verification."
