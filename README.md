# 학교 알림 (학교 메신저 대체)

교사들에게 일괄로 뿌려지는 메신저 대신, 꼭 필요한 사람에게 필요한 할 일만 전달하기 위한 시스템입니다.

- 웹 앱: Next.js (TypeScript)
- 데이터베이스: PostgreSQL 17
- AI: Ollama (로컬 언어 모델, 외부 AI API 사용 안 함)
- 외부 접속: Cloudflare Tunnel 또는 Caddy (HTTPS) — 학교 안 서버에 집·휴대폰에서도 접속
- 웹·DB·백업은 Docker 로 실행되므로, 다른 컴퓨터로 옮겨도 같은 환경이 그대로 재현됩니다.

## 서버 구성 (맥미니 24GB 한 대)

맥미니 한 대가 웹·DB·AI·백업을 모두 돌립니다.

- **Docker Desktop** (VM 메모리 6~8GB): `cloudflared` 또는 `caddy` → `app` → `db` ← `db-backup`
- **맥에 직접 설치한 Ollama** (Metal GPU 사용): `app` 이 `host.docker.internal:11434` 로 접속
- 집·휴대폰 → (HTTPS) → `cloudflared`/`caddy` → `app`

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
| `cloudflared` / `caddy` | 외부 접속 (운영 배포 시에만, 둘 중 하나) | https://도메인 |
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

### 자동 백업 (맥미니 + NAS 이중 저장)
`db-backup` 서비스가 켜질 때 한 번, 그 뒤 `BACKUP_INTERVAL_HOURS`(기본 24) 시간마다 백업합니다.

| 위치 | 설정 | 보관 기간 |
| --- | --- | --- |
| 1차: 맥미니 안 | `BACKUP_DIR` (기본 `./backups`) | `BACKUP_KEEP_DAYS` (기본 14일) |
| 2차: NAS | `NAS_BACKUP_DIR` | `NAS_BACKUP_KEEP_DAYS` (기본 90일) |

맥미니가 고장 나도 NAS 에 백업이 남아 있도록, 운영 서버에서는 꼭 NAS 를 연결하세요.

```bash
docker compose logs db-backup        # 백업 기록 확인 (NAS 복사 성공/실패도 여기 표시)
```

### NAS 연결하기 (맥미니, 처음 한 번)
1. NAS 에 백업용 공유 폴더를 만듭니다. (예: 공유 폴더 `backup` 안에 `school-notice` 폴더)
2. 맥 Finder → 이동 → **서버에 연결**(⌘K) → `smb://NAS주소/backup` 접속, "이 암호를 키체인에 저장" 체크
3. 재부팅 후에도 자동 연결되도록: 시스템 설정 → 일반 → **로그인 항목**에 마운트된 `backup` 공유 폴더를 추가
4. 표식 파일을 한 번 만듭니다. 이 파일이 있을 때만 NAS 가 "연결됨"으로 인식됩니다.
   ```bash
   mkdir -p /Volumes/backup/school-notice
   touch /Volumes/backup/school-notice/.school-notice-backup
   ```
5. `.env` 에 경로를 넣고 백업 서비스를 다시 시작합니다.
   ```
   NAS_BACKUP_DIR=/Volumes/backup/school-notice
   ```
   ```bash
   docker compose up -d db-backup
   docker compose logs db-backup     # "NAS 복사 완료" 가 보이면 성공
   ```
6. Docker Desktop → Settings → Resources → **File sharing** 에 `/Volumes` 가 포함되어 있는지 확인하세요.

> NAS 가 꺼지거나 연결이 끊겨도 맥미니 쪽 백업은 계속 쌓이고, 로그에 `⚠️ NAS 미연결` 경고가 남습니다.
> (표식 파일 확인 덕분에 NAS 가 끊긴 상태에서 엉뚱한 빈 폴더에 저장되는 일은 없습니다.)

### 지금 바로 백업
```bash
sh scripts/db-backup.sh              # backups/db-...-manual.sql.gz 생성 (NAS 연결 시 NAS 에도 복사)
```

### 복원
```bash
sh scripts/db-restore.sh backups/db-20261122-130000.sql.gz
```
현재 DB 의 테이블을 백업 시점 내용으로 덮어씁니다.

## 운영 배포 (학교 안 맥미니, 집·휴대폰에서 접속)

서버는 학교 안에 둡니다. 외부에서 접속하는 방법은 두 가지이고, `.env` 의 `COMPOSE_PROFILES` 로 고릅니다.
어느 쪽이든 앱·DB 포트는 외부에 열지 않고, `POSTGRES_PASSWORD` 는 강한 값으로 바꾸세요.

### 방법 A: Cloudflare Tunnel (권장 — 학교 방화벽 포트 개방 불필요)

맥미니가 Cloudflare 쪽으로 **밖으로 나가는 연결**만 맺기 때문에, 학교 전산망에 포트를 열어 달라고 요청하지 않아도 됩니다. HTTPS 인증서도 Cloudflare 가 처리합니다.

1. 도메인 하나를 준비해 Cloudflare(무료 요금제)에 등록합니다.
2. Cloudflare 대시보드 → Zero Trust → Networks → Tunnels → **Create a tunnel** (Cloudflared 선택)
3. 설치 화면에 나오는 **토큰**을 복사해 `.env` 에 넣습니다.
   ```
   COMPOSE_PROFILES=tunnel
   CLOUDFLARE_TUNNEL_TOKEN=eyJ...
   ```
4. 같은 화면의 **Public Hostname** 에 `notice.내도메인` → Service `HTTP` / `app:3000` 을 추가합니다.
5. 실행:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
   docker compose logs cloudflared    # "Registered tunnel connection" 이 보이면 연결 완료
   ```

> 학교 망이 외부 터널 연결 자체를 막는 경우도 있으니, 정보부·전산 담당에게 한 번 확인하세요.

### 방법 B: Caddy + 포트 개방 (학교에서 80/443 포트를 열어 줄 때)

1. 도메인을 학교 공인 IP 로 연결(DNS A 레코드)하고, 학교 방화벽에서 80·443 포트를 맥미니로 포워딩합니다.
2. `.env`:
   ```
   COMPOSE_PROFILES=caddy
   DOMAIN=notice.myschool.kr
   ```
3. 실행: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`
   Caddy 가 Let's Encrypt 인증서를 자동으로 받고 갱신하며, http 는 https 로 자동 이동합니다.

### 공통
- 앱은 최적화된 운영 이미지(일반 사용자 권한)로 실행됩니다.
- 모든 컨테이너는 `restart: unless-stopped` 라 Docker 가 다시 켜지면 자동으로 올라옵니다.
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
2. 다음 두 가지를 새 컴퓨터로 가져갑니다. (Git 에는 올라가지 않는 파일들)
   - `.env`
   - 방금 만든 백업 파일 (NAS 에도 복사되어 있으므로 새 컴퓨터에서 NAS 를 연결해 바로 가져와도 됩니다)
3. **새 컴퓨터에서** Docker Desktop, Ollama, Git 을 설치하고 (Docker 메모리 6~8GB 설정), 위 "NAS 연결하기"의 2~3단계를 해 둡니다:
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
(Cloudflare Tunnel 은 같은 토큰을 쓰면 새 서버로 그대로 이어집니다. 기존 서버의 cloudflared 는 먼저 끄세요. Caddy 방식이면 도메인의 IP 만 새 서버로 바꾸면 인증서는 자동 재발급됩니다.)

### 새 컴퓨터가 맥이 아닌 경우 (Linux / Windows + NVIDIA)
Ollama 를 컨테이너로 돌릴 수 있습니다. `.env` 에서:
```
COMPOSE_PROFILES=ollama          # 운영이면 tunnel,ollama 처럼 이어 쓰기
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
- **로그에 `NAS 미연결` 경고**: Finder 에서 NAS 공유 폴더가 마운트되어 있는지, `NAS_BACKUP_DIR` 안에 `.school-notice-backup` 파일이 있는지 확인.
- **맥미니가 고장 났을 때**: 새 컴퓨터에서 NAS 의 가장 최근 `db-*.sql.gz` 로 `sh scripts/db-restore.sh` 를 실행하세요.
- **포트가 이미 사용 중**: `.env` 에서 `APP_PORT`, `DB_PORT` 등을 다른 번호로 바꾸고 `docker compose up -d`.
- **코드를 고쳐도 화면이 안 바뀜**: `.env` 에서 `WATCHPACK_POLLING=true` 후 `docker compose up -d`.
- **패키지가 꼬였을 때**: `docker compose down && docker volume rm school-notice_node_modules && docker compose up -d`
- **터널이 연결되지 않음**: `docker compose logs cloudflared` 에서 토큰 오류인지, 학교 망이 연결을 막는지 확인.
- **HTTPS 인증서 발급 실패 (Caddy)**: 도메인이 맥미니 IP 를 가리키는지, 80·443 포트가 외부에서 열려 있는지 확인. `docker compose logs caddy`
