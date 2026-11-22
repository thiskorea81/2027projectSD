#!/bin/sh
# DB 자동 백업 루프 (db-backup 컨테이너에서 실행)
#   - 시작 직후 1회, 이후 BACKUP_INTERVAL_HOURS 시간마다 백업
#   - BACKUP_KEEP_DAYS 일보다 오래된 백업은 자동 삭제
set -e

INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
OUT_DIR=/backups

export PGPASSWORD="$POSTGRES_PASSWORD"

backup_once() {
  TS=$(date +%Y%m%d-%H%M%S)
  TMP="$OUT_DIR/.db-$TS.sql.gz.part"
  FILE="$OUT_DIR/db-$TS.sql.gz"
  if pg_dump -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner | gzip > "$TMP"; then
    mv "$TMP" "$FILE"
    echo "[backup] $(date '+%F %T') 완료: $FILE ($(du -h "$FILE" | cut -f1))"
  else
    rm -f "$TMP"
    echo "[backup] $(date '+%F %T') 실패" >&2
  fi
  find "$OUT_DIR" -maxdepth 1 -name 'db-*.sql.gz' -mtime +"$KEEP_DAYS" -print -delete \
    | sed 's/^/[backup] 오래된 백업 삭제: /'
}

until pg_isready -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
  echo "[backup] DB 대기 중..."
  sleep 3
done

while true; do
  backup_once
  sleep "$((INTERVAL_HOURS * 3600))"
done
