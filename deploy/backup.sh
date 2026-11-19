#!/bin/sh
# Runs inside the "backup" container: one compressed database dump a day,
# at BACKUP_HOUR_UTC (default 21:00 UTC = 02:30 IST), keeping BACKUP_KEEP_DAYS days.
#
# Restore one (this replaces the current data, so stop the api first):
#   docker compose stop api
#   gunzip -c backups/labos-YYYY-MM-DD.sql.gz | docker compose exec -T postgres psql -U labos -d labos
#   docker compose start api
set -eu

KEEP="${BACKUP_KEEP_DAYS:-14}"
HOUR="${BACKUP_HOUR_UTC:-21}"

backup() {
  day=$(date -u +%Y-%m-%d)
  file="/backups/labos-$day.sql.gz"
  echo "$(date -u) backing up to $file"
  # --clean so a restore replaces tables instead of failing on existing ones.
  if pg_dump --clean --if-exists --no-owner | gzip > "$file.tmp"; then
    mv "$file.tmp" "$file"
    echo "$(date -u) backup done ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.tmp"
    echo "$(date -u) BACKUP FAILED" >&2
  fi
  find /backups -name 'labos-*.sql.gz' -mtime +"$KEEP" -delete
}

# One straight away, so a fresh server has a backup from day one.
backup
while true; do
  now_h=$(date -u +%H)
  if [ "$now_h" = "$(printf '%02d' "$HOUR")" ] && [ ! -f "/backups/labos-$(date -u +%Y-%m-%d).sql.gz" ]; then
    backup
  fi
  sleep 600
done
