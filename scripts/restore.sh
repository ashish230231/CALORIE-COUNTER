#!/bin/sh
# Restore a full backup produced by the backup service:  ./scripts/restore.sh backups/calorie-XXXX.dump
# This REPLACES the current database contents with the backup.
set -eu

file="${1:?usage: $0 backups/<file>.dump}"
[ -f "$file" ] || { echo "No such file: $file" >&2; exit 1; }

printf 'This replaces ALL current data with %s. Type "restore" to continue: ' "$file"
read -r answer
[ "$answer" = "restore" ] || { echo "Aborted."; exit 1; }

docker compose stop backend backup
docker compose exec -T db sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$file"
docker compose start backend backup
echo "Restored $file"
