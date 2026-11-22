#!/bin/sh
# 백업 파일(.sql 또는 .sql.gz)을 현재 DB에 복원합니다. 기존 테이블은 덮어씁니다.
#   사용법: sh scripts/db-restore.sh backups/db-20261122-130000.sql.gz
set -e
cd "$(dirname "$0")/.."

if [ -z "$1" ] || [ ! -f "$1" ]; then
  echo "사용법: sh scripts/db-restore.sh <백업파일.sql.gz>"
  exit 1
fi

docker compose up -d --wait db

case "$1" in
  *.gz) READ="gunzip -c" ;;
  *)    READ="cat" ;;
esac

$READ "$1" | docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > /dev/null

echo "복원 완료: $1"
