#!/bin/sh
# 지금 즉시 DB 전체를 백업합니다. (자동 백업과 같은 폴더/형식)
# NAS_BACKUP_DIR 이 설정되어 있고 NAS 가 연결되어 있으면 NAS 에도 복사합니다.
#   사용법: sh scripts/db-backup.sh
set -e
cd "$(dirname "$0")/.."

env_get() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true; }

BACKUP_DIR=$(env_get BACKUP_DIR)
BACKUP_DIR="${BACKUP_DIR:-./backups}"
NAS_BACKUP_DIR=$(env_get NAS_BACKUP_DIR)
mkdir -p "$BACKUP_DIR"

FILE="$BACKUP_DIR/db-$(date +%Y%m%d-%H%M%S)-manual.sql.gz"

docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' | gzip > "$FILE"
echo "백업 완료: $FILE"

if [ -n "$NAS_BACKUP_DIR" ]; then
  if [ -f "$NAS_BACKUP_DIR/.school-notice-backup" ]; then
    cp "$FILE" "$NAS_BACKUP_DIR/" && echo "NAS 복사 완료: $NAS_BACKUP_DIR/$(basename "$FILE")"
  else
    echo "⚠️  NAS 미연결: $NAS_BACKUP_DIR 에 표식 파일(.school-notice-backup)이 없어 로컬에만 저장했습니다." >&2
  fi
fi
