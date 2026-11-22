#!/bin/sh
# DB 자동 백업 루프 (db-backup 컨테이너에서 실행)
#   - 시작 직후 1회, 이후 BACKUP_INTERVAL_HOURS 시간마다 백업
#   - 1차: 맥미니 로컬(/backups), 2차: NAS(/nas) 에 같은 파일을 복사
#   - NAS 는 폴더 안에 표식 파일(.school-notice-backup)이 있을 때만 "연결됨"으로 봅니다.
#     (NAS 가 끊겨 빈 폴더만 남은 상태에서 엉뚱한 곳에 저장되는 것을 막기 위해)
#   - BACKUP_KEEP_DAYS 일보다 오래된 백업은 양쪽 모두 자동 삭제
set -e

INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
NAS_KEEP_DAYS="${NAS_BACKUP_KEEP_DAYS:-$KEEP_DAYS}"
OUT_DIR=/backups
NAS_DIR=/nas
NAS_MARKER="$NAS_DIR/.school-notice-backup"

export PGPASSWORD="$POSTGRES_PASSWORD"

log() { echo "[backup] $(date '+%F %T') $*"; }

prune() { # $1=폴더 $2=보관일수
  find "$1" -maxdepth 1 -name 'db-*.sql.gz' -mtime +"$2" -print -delete \
    | sed 's/^/[backup] 오래된 백업 삭제: /'
}

copy_to_nas() { # $1=로컬 백업 파일
  if [ -z "$NAS_BACKUP_DIR" ]; then
    return 0
  fi
  if [ ! -f "$NAS_MARKER" ]; then
    log "⚠️  NAS 미연결: $NAS_BACKUP_DIR 에 표식 파일(.school-notice-backup)이 없습니다. 로컬에만 저장했습니다." >&2
    return 0
  fi
  NAME=$(basename "$1")
  if cp "$1" "$NAS_DIR/.$NAME.part" && mv "$NAS_DIR/.$NAME.part" "$NAS_DIR/$NAME"; then
    log "NAS 복사 완료: $NAS_BACKUP_DIR/$NAME"
    prune "$NAS_DIR" "$NAS_KEEP_DAYS"
  else
    rm -f "$NAS_DIR/.$NAME.part"
    log "⚠️  NAS 복사 실패: $NAME (로컬 백업은 정상)" >&2
  fi
}

backup_once() {
  TS=$(date +%Y%m%d-%H%M%S)
  TMP="$OUT_DIR/.db-$TS.sql.gz.part"
  FILE="$OUT_DIR/db-$TS.sql.gz"
  if pg_dump -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner | gzip > "$TMP"; then
    mv "$TMP" "$FILE"
    log "완료: $FILE ($(du -h "$FILE" | cut -f1))"
    copy_to_nas "$FILE"
  else
    rm -f "$TMP"
    log "실패" >&2
  fi
  prune "$OUT_DIR" "$KEEP_DAYS"
}

until pg_isready -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
  echo "[backup] DB 대기 중..."
  sleep 3
done

while true; do
  backup_once
  sleep "$((INTERVAL_HOURS * 3600))"
done
