# 학교 알림 (학교 메신저 대체)

교사들에게 일괄로 뿌려지는 메신저 대신, 꼭 필요한 사람에게 필요한 할 일만 전달하기 위한 시스템입니다.

- 웹 앱: Next.js (TypeScript)
- 데이터베이스: PostgreSQL 17
- AI: Ollama (로컬 언어 모델, 외부 AI API 사용 안 함)
- 모든 구성 요소는 Docker 로 실행되므로, 다른 컴퓨터로 옮겨도 같은 환경이 그대로 재현됩니다.

## 구성

| 서비스 | 역할 | 주소 (이 컴퓨터에서) |
| --- | --- | --- |
| `app` | 웹 앱 (개발 모드, 코드 수정 시 자동 반영) | http://localhost:3000 |
| `db` | PostgreSQL | `localhost:5432` (이 컴퓨터에서만 접속 가능) |
| `db-backup` | DB 자동 백업 (기본 24시간마다, 14일 보관) | `./backups` 폴더 |
| `ollama` | 로컬 AI 서버 | http://localhost:11434 |
| `adminer` | 웹 DB 관리 도구 (선택) | http://localhost:8080 |

데이터는 Docker 볼륨에 저장됩니다: `db_data`(DB), `ollama_data`(AI 모델).

## 준비물

- Docker Desktop (Windows/Mac) 또는 Docker Engine + Compose 플러그인 (Linux)
- Git
- Windows 에서 `scripts/*.sh` 를 실행할 때는 Git Bash 또는 WSL 터미널을 사용하세요.

## 처음 실행하기

```bash
git clone https://github.com/thiskorea81/2027projectSD.git
cd 2027projectSD
cp .env.example .env          # 필요하면 비밀번호·포트 수정
docker compose up -d --build
```

첫 실행은 이미지와 npm 패키지를 받느라 몇 분 걸립니다. 끝나면:

- http://localhost:3000 : 첫 화면
- http://localhost:3000/api/health : DB·AI 연결 상태 (`"status":"ok"` 이면 정상)

### AI 모델 받기 (처음 한 번)

```bash
docker compose exec ollama ollama pull gemma3:4b    # .env 의 OLLAMA_MODEL 과 같은 이름
```

모델은 `ollama_data` 볼륨에 저장되어 다시 받을 필요가 없습니다. 사양에 맞춰 `.env` 의 `OLLAMA_MODEL` 을 바꾸고 같은 방법으로 받으면 됩니다.
NVIDIA 그래픽카드가 있다면 GPU 로 돌릴 수 있습니다:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
```

## 자주 쓰는 명령

```bash
docker compose up -d                 # 시작 (백그라운드)
docker compose logs -f app           # 앱 로그 보기
docker compose ps                    # 상태 확인
docker compose down                  # 중지 (데이터는 유지됨)
docker compose exec app npm install <패키지>   # 패키지 추가
docker compose --profile tools up -d adminer  # DB 관리 도구 켜기
```

> `docker compose down -v` 는 **DB 와 AI 모델 데이터까지 삭제**합니다. 꼭 백업 후에만 쓰세요.

## 백업과 복원

### 자동 백업
`db-backup` 서비스가 켜질 때 한 번, 그 뒤 `BACKUP_INTERVAL_HOURS`(기본 24) 시간마다
`BACKUP_DIR`(기본 `./backups`)에 `db-날짜-시간.sql.gz` 파일을 만듭니다.
`BACKUP_KEEP_DAYS`(기본 14) 일보다 오래된 파일은 자동으로 지웁니다.

컴퓨터 자체가 고장 나는 경우에 대비해 `.env` 의 `BACKUP_DIR` 을 **외장 디스크나 NAS, 클라우드 동기화 폴더**로 지정하는 것을 권장합니다.

```bash
docker compose logs db-backup        # 백업 기록 확인
```

### 지금 바로 백업
```bash
sh scripts/db-backup.sh              # backups/db-...-manual.sql.gz 생성
```

### 복원
```bash
sh scripts/db-restore.sh backups/db-20261122-130000.sql.gz
```
현재 DB 의 테이블을 백업 시점 내용으로 덮어씁니다.

## 다른 컴퓨터로 옮기기

1. **지금 컴퓨터에서** 최신 상태를 저장합니다.
   ```bash
   git push                          # 코드
   sh scripts/db-backup.sh           # DB → backups/…-manual.sql.gz
   ```
2. 다음 두 가지를 USB·클라우드 등으로 새 컴퓨터에 복사합니다. (Git 에는 올라가지 않는 파일들)
   - `.env`
   - 방금 만든 백업 파일
3. **새 컴퓨터에서** Docker Desktop 과 Git 을 설치하고:
   ```bash
   git clone https://github.com/thiskorea81/2027projectSD.git
   cd 2027projectSD
   # 복사해 온 .env 를 이 폴더에 넣기
   docker compose up -d --build
   sh scripts/db-restore.sh <복사해 온 백업 파일>
   docker compose exec ollama ollama pull gemma3:4b   # AI 모델은 다시 받기
   ```
4. http://localhost:3000/api/health 가 `"status":"ok"` 인지 확인하면 끝입니다.

npm 패키지 버전은 `package-lock.json`, Node·PostgreSQL 버전은 `Dockerfile`·`docker-compose.yml` 에 고정되어 있어 두 컴퓨터의 환경이 같게 유지됩니다.

## 운영(실제 사용) 배포

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

- 앱을 최적화된 운영 이미지로 빌드해 실행합니다 (코드 마운트 없음, 일반 사용자 권한).
- DB 포트는 외부에 열지 않습니다.
- 자동 백업과 로컬 AI 는 그대로 동작합니다.
- 실제 학교에서 쓰기 전에는 `.env` 의 `POSTGRES_PASSWORD` 를 꼭 바꾸세요.

## 문제 해결

- **포트가 이미 사용 중**: `.env` 에서 `APP_PORT`, `DB_PORT` 등을 다른 번호로 바꾸고 `docker compose up -d`.
- **Windows 에서 코드를 고쳐도 화면이 안 바뀜**: `.env` 에서 `WATCHPACK_POLLING=true` 후 `docker compose up -d`.
- **패키지가 꼬였을 때**: `docker compose down && docker volume rm school-notice_node_modules && docker compose up -d`
- **`/api/health` 에서 `ai.modelReady` 가 false**: 위의 "AI 모델 받기"를 실행하세요. 앱 자체는 모델 없이도 동작합니다.
