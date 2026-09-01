#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
MIGRATIONS_DIR="$ROOT_DIR/supabase/migrations"
DB_URL="${EPD_DATABASE_URL:-}"
CONFIRM="${EPD_MIGRATION_CONFIRM:-}"
POSTGRES_IMAGE="${EPD_POSTGRES_CLIENT_IMAGE:-postgres:17-alpine}"
LOCK_DIR="$ROOT_DIR/.epd-light-migration.lock"

if [ "$CONFIRM" != "APPLY_MIGRATIONS" ]; then
  echo "ERROR: set EPD_MIGRATION_CONFIRM=APPLY_MIGRATIONS" >&2
  exit 1
fi
if [ -z "$DB_URL" ]; then
  echo "ERROR: EPD_DATABASE_URL is required" >&2
  exit 1
fi
if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "ERROR: migrations directory not found" >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required" >&2
  exit 1
fi
if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
  echo "ERROR: sha256sum or shasum is required" >&2
  exit 1
fi
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "ERROR: another migration runner appears to be active" >&2
  exit 1
fi
cleanup() { rmdir "$LOCK_DIR" 2>/dev/null || true; }
trap cleanup EXIT HUP INT TERM

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# Pass the secret URL by inherited environment name only. Inside the container
# libpq receives it through PGDATABASE, so the URL is not placed in psql argv.
export EPD_DATABASE_URL="$DB_URL"

psql_exec() {
  docker run --rm \
    -e EPD_DATABASE_URL \
    "$POSTGRES_IMAGE" \
    sh -eu -c 'PGDATABASE="$EPD_DATABASE_URL" exec psql -X -v ON_ERROR_STOP=1 "$@"' sh "$@"
}

psql_file() {
  rel="$1"
  export EPD_MIGRATION_FILE="$rel"
  docker run --rm \
    -e EPD_DATABASE_URL \
    -e EPD_MIGRATION_FILE \
    -v "$ROOT_DIR:/app:ro" \
    "$POSTGRES_IMAGE" \
    sh -eu -c 'PGDATABASE="$EPD_DATABASE_URL" exec psql -X -v ON_ERROR_STOP=1 --single-transaction -f "/app/$EPD_MIGRATION_FILE"'
}

FILES="$(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' -print | sort)"
if [ -z "$FILES" ]; then
  echo "ERROR: no SQL migrations found" >&2
  exit 1
fi

echo "== Pre-migration encrypted backup =="
sh "$ROOT_DIR/deploy/backup-postgres.sh"

psql_exec -q -c "
create table if not exists public.epd_light_schema_migrations (
  version text primary key,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz not null default now()
);
revoke all on public.epd_light_schema_migrations from anon, authenticated;
" >/dev/null

APPLIED=0
for file in $FILES; do
  version="$(basename "$file")"
  case "$version" in
    *[!A-Za-z0-9_.-]*) echo "ERROR: unsafe migration filename: $version" >&2; exit 1 ;;
  esac
  hash="$(checksum "$file")"
  case "$hash" in
    ''|*[!0-9a-f]*) echo "ERROR: failed to calculate SHA-256 for $version" >&2; exit 1 ;;
  esac
  if [ "${#hash}" -ne 64 ]; then
    echo "ERROR: invalid SHA-256 length for $version" >&2
    exit 1
  fi

  existing="$(psql_exec -Atq -c "select sha256 from public.epd_light_schema_migrations where version = '$version'" | tr -d '\r\n')"
  if [ -n "$existing" ]; then
    if [ "$existing" != "$hash" ]; then
      echo "ERROR: applied migration checksum changed: $version" >&2
      exit 1
    fi
    echo "SKIP $version (already applied, checksum matches)"
    continue
  fi

  rel="supabase/migrations/$version"
  echo "APPLY $version"
  psql_file "$rel"
  psql_exec -q -c "insert into public.epd_light_schema_migrations(version, sha256) values ('$version', '$hash')" >/dev/null
  APPLIED=1
done

if [ "$APPLIED" -eq 1 ]; then
  echo "== Post-migration encrypted backup =="
  sh "$ROOT_DIR/deploy/backup-postgres.sh"
else
  echo "No schema changes were required."
fi

echo "Migration runner complete."
