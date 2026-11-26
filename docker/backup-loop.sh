#!/bin/sh
# DB 자동 백업 루프 (db-backup 컨테이너에서 실행)
#   - 시작 직후 1회, 이후 매일 BACKUP_TIME(기본 03:00, 업무시간 외)에 백업
#     (BACKUP_TIME 을 비우면 BACKUP_INTERVAL_HOURS 시간마다)
#   - 1차: 맥미니 로컬(/backups), 2차: NAS(/nas) 에 같은 파일을 복사
#   - NAS 는 폴더 안에 표식 파일(.school-notice-backup)이 있을 때만 "연결됨"으로 봅니다.
#     (NAS 가 끊겨 빈 폴더만 남은 상태에서 엉뚱한 곳에 저장되는 것을 막기 위해)
#   - DB 백업은 일간·주간·월간 규칙으로 양쪽 모두 자동 정리 (아래 prune 참고)
#   - 첨부파일(/uploads)·부서 공문 폴더(/documents)는 NAS 의 uploads/, documents/ 로 동기화
#     (새로 생기거나 바뀐 파일만 복사, 원본에서 지워진 파일은 <이름>-deleted/날짜/ 에 일정 기간 보관)
set -e

INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"
# 원본에서 삭제된 첨부파일·공문을 NAS 에 남겨 두는 기간
NAS_KEEP_DAYS="${NAS_DELETED_KEEP_DAYS:-90}"
OUT_DIR=/backups
NAS_DIR=/nas
NAS_MARKER="$NAS_DIR/.school-notice-backup"

export PGPASSWORD="$POSTGRES_PASSWORD"

log() { echo "[backup] $(date '+%F %T') $*"; }

# DB 백업 보관 규칙 (일간·주간·월간):
#   최근 BACKUP_KEEP_DAILY 일치는 모두, 일요일 백업은 BACKUP_KEEP_WEEKLY 주,
#   매달 1일 백업은 BACKUP_KEEP_MONTHLY 개월 보관 → 기본 7·4·3 (최대 약 90일)
KEEP_DAILY="${BACKUP_KEEP_DAILY:-7}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-4}"
KEEP_MONTHLY="${BACKUP_KEEP_MONTHLY:-3}"

prune() { # $1=폴더
  NOW=$(date +%s)
  for f in "$1"/db-*.sql.gz; do
    [ -e "$f" ] || continue
    D=$(basename "$f" | sed -n 's/^db-\([0-9]\{8\}\)-.*/\1/p')
    [ -n "$D" ] || continue
    T=$(date -d "$D" +%s 2>/dev/null) || continue
    AGE=$(( (NOW - T) / 86400 ))
    DOW=$(date -d "$D" +%u)   # 7 = 일요일
    DOM=$(date -d "$D" +%d)
    if [ "$AGE" -lt "$KEEP_DAILY" ]; then continue; fi
    if [ "$DOW" = 7 ] && [ "$AGE" -lt $((KEEP_WEEKLY * 7)) ]; then continue; fi
    if [ "$DOM" = 01 ] && [ "$AGE" -lt $((KEEP_MONTHLY * 31)) ]; then continue; fi
    rm -f "$f" && log "보관 기간이 지난 백업 삭제: $f"
  done
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
    prune "$NAS_DIR"
  else
    rm -f "$NAS_DIR/.$NAME.part"
    log "⚠️  NAS 복사 실패: $NAME (로컬 백업은 정상)" >&2
  fi
}

# 폴더를 NAS 로 동기화: $1=원본 폴더(컨테이너 안) $2=NAS 안 폴더 이름 $3=로그용 이름
#   새로 생기거나 바뀐 파일만 복사하고, 원본에서 지워진 파일은 NAS 의 <이름>-deleted/날짜/ 로 옮겨
#   NAS_DELETED_KEEP_DAYS 동안 보관한 뒤 지웁니다.
sync_dir() {
  SRC="$1"; NAME="$2"; LABEL="$3"
  if [ -z "$NAS_BACKUP_DIR" ] || [ ! -f "$NAS_MARKER" ] || [ ! -d "$SRC" ]; then
    return 0
  fi
  TS=$(date +%Y%m%d-%H%M%S)
  DST="$NAS_DIR/$NAME"
  DEL="$NAS_DIR/$NAME-deleted/$TS"
  mkdir -p "$DST"

  # 1) 새로 생기거나 바뀐 파일 복사 (NAS(SMB)는 소유자 정보를 못 담으므로 시간 정보만 보존)
  if ! cp -r -u --preserve=timestamps "$SRC/." "$DST/"; then
    log "⚠️  $LABEL NAS 동기화 중 오류 (일부 파일이 복사되지 않았을 수 있음)" >&2
  fi

  # 2) 원본에서 지워진 파일은 바로 지우지 않고 <이름>-deleted/날짜/ 로 옮김
  (cd "$DST" && find . -type f) | while IFS= read -r f; do
    if [ ! -e "$SRC/$f" ]; then
      mkdir -p "$DEL/$(dirname "$f")"
      mv "$DST/$f" "$DEL/$f"
    fi
  done
  MOVED=0
  if [ -d "$DEL" ]; then MOVED=$(find "$DEL" -type f | wc -l); fi
  find "$DST" -mindepth 1 -type d -empty -delete 2>/dev/null || true

  COUNT=$(find "$DST" -type f | wc -l)
  log "$LABEL NAS 동기화 완료: ${COUNT}개 (원본에서 삭제되어 보관 처리: ${MOVED}개)"

  # 3) 오래된 삭제 보관분 정리
  find "$NAS_DIR/$NAME-deleted" -mindepth 1 -maxdepth 1 -type d -mtime +"$NAS_KEEP_DAYS" \
    -exec rm -rf {} + 2>/dev/null || true
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
  prune "$OUT_DIR"
  sync_dir /uploads uploads "첨부파일"
  sync_dir /documents documents "부서 공문 폴더"
}

until pg_isready -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
  echo "[backup] DB 대기 중..."
  sleep 3
done

# 다음 BACKUP_TIME(예: 03:00, 서울 시각)까지 남은 초
seconds_until() {
  NOW=$(date +%s)
  NEXT=$(date -d "today $1" +%s)
  [ "$NEXT" -le "$NOW" ] && NEXT=$(date -d "tomorrow $1" +%s)
  echo $((NEXT - NOW))
}

backup_once   # 컨테이너가 켜질 때 한 번
while true; do
  if [ -n "$BACKUP_TIME" ]; then
    WAIT=$(seconds_until "$BACKUP_TIME")
    log "다음 백업: 매일 $BACKUP_TIME ($((WAIT / 60))분 뒤)"
    sleep "$WAIT"
  else
    sleep "$((INTERVAL_HOURS * 3600))"
  fi
  backup_once
done
