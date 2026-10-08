#!/bin/sh
# Periodic full backups of the database into ./backups (pg_dump custom format, compressed).
# Laptop-friendly: the schedule survives restarts, because it is based on the age of the newest
# backup rather than on how long this container has been running.
# Restore with:  ./scripts/restore.sh backups/<file>.dump
set -eu

INTERVAL=$(( ${BACKUP_INTERVAL_HOURS:-24} * 3600 ))
KEEP="${BACKUP_KEEP:-7}"

echo "backup: every ${BACKUP_INTERVAL_HOURS:-24}h, keeping the newest ${KEEP} files in ./backups"
sleep 120  # let the app finish migrations / first-run import

while true; do
  newest="$(ls -1t /backups/calorie-*.dump 2>/dev/null | head -n 1 || true)"
  age=$INTERVAL
  [ -n "$newest" ] && age=$(( $(date +%s) - $(stat -c %Y "$newest") ))
  if [ "$age" -lt "$INTERVAL" ]; then
    sleep $(( INTERVAL - age ))
    continue
  fi

  target="/backups/calorie-$(date -u +%Y%m%dT%H%M%SZ).dump"
  if pg_dump --format=custom --compress=9 --no-owner -d "$POSTGRES_DB" -U "$POSTGRES_USER" -f "$target.tmp"; then
    mv "$target.tmp" "$target"
    echo "backup: wrote $target ($(du -h "$target" | cut -f1))"
  else
    echo "backup: pg_dump failed, retrying in 10 minutes" >&2
    rm -f "$target.tmp"
    sleep 600
    continue
  fi
  ls -1t /backups/calorie-*.dump | tail -n +"$((KEEP + 1))" | xargs -r rm -f
done
