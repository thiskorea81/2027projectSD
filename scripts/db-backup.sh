#!/bin/sh
# 지금 즉시 DB 전체를 백업합니다. (자동 백업과 같은 폴더/형식)
#   사용법: sh scripts/db-backup.sh
set -e
cd "$(dirname "$0")/.."

# .env 의 BACKUP_DIR 을 따릅니다 (기본: ./backups)
BACKUP_DIR=$(grep -E '^BACKUP_DIR=' .env 2>/dev/null | cut -d= -f2- || true)
BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"

FILE="$BACKUP_DIR/db-$(date +%Y%m%d-%H%M%S)-manual.sql.gz"

docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' | gzip > "$FILE"

echo "백업 완료: $FILE"
