#!/bin/sh
# package-lock.json 이 바뀌었을 때만 npm ci 를 다시 실행합니다.
# (node_modules 는 named volume 이라 컨테이너를 지워도 유지됩니다)
set -e
cd /app

LOCK_HASH_FILE=node_modules/.package-lock.sha256

if [ -f package-lock.json ]; then
  CURRENT=$(sha256sum package-lock.json | cut -d' ' -f1)
  SAVED=$(cat "$LOCK_HASH_FILE" 2>/dev/null || true)
  if [ ! -d node_modules/.bin ] || [ "$CURRENT" != "$SAVED" ]; then
    echo "[dev] 의존성 설치 중 (npm ci)..."
    npm ci
    echo "$CURRENT" > "$LOCK_HASH_FILE"
  fi
else
  echo "[dev] package-lock.json 이 없어 npm install 을 실행합니다..."
  npm install
fi

# DB 구조 변경(마이그레이션) 적용. 이미 적용된 것은 건너뜁니다.
node scripts/migrate.ts

exec "$@"
