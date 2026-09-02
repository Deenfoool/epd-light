#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
MIGRATIONS_DIR="$ROOT_DIR/supabase/migrations"
DB_URL="${EPD_DATABASE_URL:-}"
POSTGRES_IMAGE="${EPD_POSTGRES_CLIENT_IMAGE:-postgres:17-alpine}"

if [ -z "$DB_URL" ]; then
  echo "ERROR: EPD_DATABASE_URL is required for migration status check" >&2
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

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# Keep the database URL out of process arguments. libpq receives it via PGDATABASE inside the container.
export EPD_DATABASE_URL="$DB_URL"
psql_exec() {
  docker run --rm \
    -e EPD_DATABASE_URL \
    "$POSTGRES_IMAGE" \
    sh -eu -c 'PGDATABASE="$EPD_DATABASE_URL" exec psql -X -v ON_ERROR_STOP=1 "$@"' sh "$@"
}

FILES="$(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' -print | sort)"
if [ -z "$FILES" ]; then
  echo "ERROR: no SQL migrations found" >&2
  exit 1
fi

REGISTRY_EXISTS="$(psql_exec -Atq -c "select case when to_regclass('public.epd_light_schema_migrations') is null then '0' else '1' end" | tr -d '\r\n')"
if [ "$REGISTRY_EXISTS" != "1" ]; then
  echo "ERROR: migration registry is missing; apply migrations with the guarded runner first" >&2
  exit 1
fi

LOCAL_COUNT=0
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
  if [ -z "$existing" ]; then
    echo "ERROR: production DB is missing migration: $version" >&2
    exit 1
  fi
  if [ "$existing" != "$hash" ]; then
    echo "ERROR: production migration checksum differs from checkout: $version" >&2
    exit 1
  fi
  echo "OK $version"
  LOCAL_COUNT=$((LOCAL_COUNT + 1))
done

DB_COUNT="$(psql_exec -Atq -c "select count(*) from public.epd_light_schema_migrations" | tr -d '\r\n')"
case "$DB_COUNT" in
  ''|*[!0-9]*) echo "ERROR: invalid migration registry count" >&2; exit 1 ;;
esac
if [ "$DB_COUNT" -ne "$LOCAL_COUNT" ]; then
  echo "ERROR: migration set mismatch: checkout=$LOCAL_COUNT database=$DB_COUNT" >&2
  echo "Refusing to deploy code against a DB with missing or extra registered migrations." >&2
  exit 1
fi

echo "Migration status OK: $LOCAL_COUNT migration files exactly match production registry and SHA-256 checksums."
