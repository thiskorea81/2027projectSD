# 학교 알림 (학교 메신저 대체)

교사들에게 일괄로 뿌려지는 메신저 대신, 꼭 필요한 사람에게 필요한 할 일만 전달하기 위한 시스템입니다.

- 웹 앱: Next.js (TypeScript)
- 데이터베이스: PostgreSQL 17
- AI: Ollama (로컬 언어 모델, 외부 AI API 사용 안 함)
- 외부 접속: Caddy (HTTPS 자동 인증서) — 집·휴대폰에서도 접속
- 웹·DB·백업은 Docker 로 실행되므로, 다른 컴퓨터로 옮겨도 같은 환경이 그대로 재현됩니다.

## 서버 구성 (맥미니 24GB 한 대)

맥미니 한 대가 웹·DB·AI·백업을 모두 돌립니다.

```
 집·휴대폰 ──HTTPS──▶ ┌──────────── 맥미니 (macOS) ─────────────┐
                      │  Docker Desktop (VM 메모리 6~8GB)        │
                      │   caddy ─▶ app ─▶ db ◀─ db-backup        │
                      │              │                           │
                      │              └─▶ host.docker.internal    │
                      │  Ollama (맥에 직접 설치, Metal GPU 사용) ◀┘
                      └──────────────────────────────────────────┘
```

**왜 Ollama 만 Docker 밖에 두나요?** 맥용 Docker 는 맥의 GPU(Metal)를 쓰지 못합니다.
컨테이너 안에서 AI 를 돌리면 CPU 로만 돌아 매우 느리기 때문에, Ollama 는 맥에 직접 설치하고
앱 컨테이너가 `host.docker.internal:11434` 로 접속합니다.
(Linux/NVIDIA 서버로 옮길 때는 컨테이너 Ollama 를 켤 수 있습니다. 아래 "다른 컴퓨터로 옮기기" 참고)

### 메모리 배분 (24GB 통합 메모리)

| 용도 | 권장 |
| --- | --- |
| macOS 자체 | 약 4GB |
| Docker Desktop VM (app, db, caddy, db-backup) | **6~8GB** (Docker Desktop → Settings → Resources → Memory) |
| Ollama + 모델 | 나머지 약 10~12GB → `gemma3:12b` 급 모델이 적당 |

더 큰 모델(20B 이상)은 메모리가 부족해 느려지거나 다른 서비스가 밀려날 수 있습니다.

| 서비스 | 역할 | 개발 중 주소 |
| --- | --- | --- |
| `app` | 웹 앱 (개발 모드, 코드 수정 시 자동 반영) | http://localhost:3000 |
| `db` | PostgreSQL | `localhost:5432` (이 컴퓨터에서만) |
| `db-backup` | DB 자동 백업 (기본 24시간마다, 14일 보관) | `./backups` 폴더 |
| Ollama (맥 네이티브) | 로컬 AI | http://localhost:11434 |
| `caddy` | HTTPS 리버스 프록시 (운영 배포 시에만) | https://도메인 |
| `adminer` | 웹 DB 관리 도구 (선택) | http://localhost:8080 |

## 준비물

- Docker Desktop (맥: Apple Silicon 용) — 설치 후 메모리를 6~8GB 로 설정
- Ollama for macOS: https://ollama.com/download
- Git

## 처음 실행하기 (개발)

```bash
# 1) AI 모델 받기 (맥에 Ollama 설치 후, 처음 한 번)
ollama pull gemma3:12b

# 2) 앱·DB 실행
git clone https://github.com/thiskorea81/2027projectSD.git
cd 2027projectSD
cp .env.example .env          # 필요하면 비밀번호·포트 수정
docker compose up -d --build
```

첫 실행은 이미지와 npm 패키지를 받느라 몇 분 걸립니다. 끝나면:

- http://localhost:3000 : 첫 화면
- http://localhost:3000/api/health : DB·AI 연결 상태 (`"status":"ok"`, `"modelReady":true` 면 정상)

## 자주 쓰는 명령

```bash
docker compose up -d                 # 시작 (백그라운드)
docker compose logs -f app           # 앱 로그 보기
docker compose ps                    # 상태 확인
docker compose down                  # 중지 (데이터는 유지됨)
docker compose exec app npm install <패키지>   # 패키지 추가
docker compose --profile tools up -d adminer  # DB 관리 도구 켜기
ollama list                          # 받은 AI 모델 목록
```

> `docker compose down -v` 는 **DB 데이터까지 삭제**합니다. 꼭 백업 후에만 쓰세요.

## 백업과 복원

### 자동 백업
`db-backup` 서비스가 켜질 때 한 번, 그 뒤 `BACKUP_INTERVAL_HOURS`(기본 24) 시간마다
`BACKUP_DIR`(기본 `./backups`)에 `db-날짜-시간.sql.gz` 파일을 만듭니다.
`BACKUP_KEEP_DAYS`(기본 14) 일보다 오래된 파일은 자동으로 지웁니다.

맥미니 자체가 고장 나는 경우에 대비해 `.env` 의 `BACKUP_DIR` 을 **외장 디스크나 NAS, 클라우드 동기화 폴더**로 지정하세요.
(예: `BACKUP_DIR=/Volumes/Backup/school-notice`. Docker Desktop → Settings → Resources → File sharing 에 그 경로가 허용되어 있어야 합니다.)

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

## 운영 배포 (집·휴대폰에서 접속)

### 1. 사전 준비
- **도메인**: 예) `notice.myschool.kr` 을 맥미니의 공인 IP 로 연결 (DNS A 레코드)
- **포트 개방**: 공유기/학교 방화벽에서 80, 443 포트를 맥미니로 포워딩
  (학교 정보부·전산 담당과 협의 필요. 외부 포트 개방이 안 되면 Cloudflare Tunnel 같은 터널 방식을 대안으로 검토)
- `.env` 에서 `DOMAIN=notice.myschool.kr`, `POSTGRES_PASSWORD` 를 강한 값으로 변경

### 2. 실행
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

- Caddy 가 Let's Encrypt 인증서를 자동으로 받고 갱신합니다. http 는 https 로 자동 이동합니다.
- 앱은 최적화된 운영 이미지(일반 사용자 권한)로 실행되고, **앱·DB 포트는 외부에 열지 않습니다** (Caddy 의 80/443 만 열림).
- 자동 백업은 그대로 동작합니다.
- 로그인은 학교 Google Workspace 계정으로 붙일 예정입니다 (별도 작업).

### 3. 맥미니를 24시간 서버로 쓰기 위한 설정
- 시스템 설정 → 에너지: **"디스플레이가 꺼져 있을 때 자동으로 잠자기 방지"** 켜기, **"정전 후 자동으로 시동"** 켜기
- Docker Desktop → Settings → General: **"Start Docker Desktop when you sign in"** 켜기
- Ollama 앱: 로그인 시 자동 실행 (기본값)
- 시스템 설정 → 사용자 및 그룹: 자동 로그인 켜기 (정전 후 재부팅 시 Docker·Ollama 가 다시 뜨도록)
- 모델을 메모리에 오래 유지하려면: `launchctl setenv OLLAMA_KEEP_ALIVE 30m` 후 Ollama 재시작

## 다른 컴퓨터로 옮기기

1. **지금 컴퓨터에서** 최신 상태를 저장합니다.
   ```bash
   git push                          # 코드
   sh scripts/db-backup.sh           # DB → backups/…-manual.sql.gz
   ```
2. 다음 두 가지를 USB·클라우드 등으로 새 컴퓨터에 복사합니다. (Git 에는 올라가지 않는 파일들)
   - `.env`
   - 방금 만든 백업 파일
3. **새 컴퓨터에서** Docker Desktop, Ollama, Git 을 설치하고 (Docker 메모리 6~8GB 설정):
   ```bash
   ollama pull gemma3:12b            # AI 모델은 다시 받기
   git clone https://github.com/thiskorea81/2027projectSD.git
   cd 2027projectSD
   # 복사해 온 .env 를 이 폴더에 넣기
   docker compose up -d --build      # 운영이면 -f docker-compose.prod.yml 도 추가
   sh scripts/db-restore.sh <복사해 온 백업 파일>
   ```
4. `/api/health` 가 `"status":"ok"` 인지 확인하면 끝입니다.

npm 패키지 버전은 `package-lock.json`, Node·PostgreSQL 버전은 `Dockerfile`·`docker-compose.yml` 에 고정되어 있어 두 컴퓨터의 환경이 같게 유지됩니다.
(HTTPS 인증서는 새 서버에서 자동으로 다시 발급됩니다. 도메인의 IP 만 새 서버로 바꾸세요.)

### 새 컴퓨터가 맥이 아닌 경우 (Linux / Windows + NVIDIA)
Ollama 를 컨테이너로 돌릴 수 있습니다. `.env` 에서:
```
COMPOSE_PROFILES=ollama
OLLAMA_URL=http://ollama:11434
```
그리고 GPU 를 쓰려면:
```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
docker compose exec ollama ollama pull gemma3:12b
```
Windows 에서 `scripts/*.sh` 는 Git Bash 또는 WSL 터미널에서 실행하세요.

## 문제 해결

- **`/api/health` 에서 `ai.status` 가 unreachable**: 맥에서 Ollama 앱이 실행 중인지 확인 (`ollama list`).
- **`ai.modelReady` 가 false**: `ollama pull <.env 의 OLLAMA_MODEL>` 을 실행하세요. 앱 자체는 모델 없이도 동작합니다.
- **포트가 이미 사용 중**: `.env` 에서 `APP_PORT`, `DB_PORT` 등을 다른 번호로 바꾸고 `docker compose up -d`.
- **코드를 고쳐도 화면이 안 바뀜**: `.env` 에서 `WATCHPACK_POLLING=true` 후 `docker compose up -d`.
- **패키지가 꼬였을 때**: `docker compose down && docker volume rm school-notice_node_modules && docker compose up -d`
- **HTTPS 인증서 발급 실패**: 도메인이 맥미니 IP 를 가리키는지, 80·443 포트가 외부에서 열려 있는지 확인. `docker compose logs caddy`
