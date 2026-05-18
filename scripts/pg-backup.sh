#!/bin/sh
# Nightly Postgres dump. Runs inside the `backup` sidecar in
# docker-compose; also invoked by the dashboard's "Run backup now"
# button from inside the MCP container.
set -eu

: "${POSTGRES_USER:?POSTGRES_USER required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD required}"
: "${POSTGRES_DB:?POSTGRES_DB required}"
: "${BACKUP_PATH:?BACKUP_PATH required}"
HOST="${POSTGRES_HOST:-postgres}"
RETENTION="${BACKUP_RETENTION_DAYS:-30}"

mkdir -p "$BACKUP_PATH"
TS="$(date +%Y-%m-%d_%H%M%S)"
OUT="$BACKUP_PATH/dashboard-$TS.dump"

echo "[backup] $(date -Iseconds) writing $OUT"
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  --format=custom \
  -h "$HOST" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -f "$OUT"

echo "[backup] $(date -Iseconds) done ($(stat -c %s "$OUT" 2>/dev/null || stat -f %z "$OUT") bytes)"

find "$BACKUP_PATH" -name 'dashboard-*.dump' -type f -mtime "+$RETENTION" -print -delete \
  | sed 's/^/[backup] pruned /' || true
