# 로그인·교직원 계정 (F-AUTH 1단계)

1단계(교내망, `http://맥미니IP`)에서 쓰는 임시 계정 로그인입니다. 2단계(도메인·HTTPS)에서 Google Workspace for Education 로그인으로 바꿀 때 계정·데이터를 그대로 이어 쓰도록 만들었습니다.

## 계정 규칙

| 항목 | 규칙 |
| --- | --- |
| 아이디 | 교직원 이름. 같은 이름이 이미 있으면(비활성 계정 포함) 등록 순서대로 `홍길동2`, `홍길동3` … 만든 뒤에는 바뀌지 않습니다. |
| 초기 비밀번호 | 서버 `.env` 의 `INITIAL_PASSWORD`. 저장소·로그인 화면·문서에 적지 않습니다. |
| 첫 로그인 | 비밀번호 변경 화면으로 바로 이동, 바꾸기 전에는 다른 화면을 쓸 수 없습니다. 새 비밀번호는 8자 이상(`PASSWORD_MIN_LENGTH`), 초기 비밀번호와 달라야 합니다. |
| 저장 | 비밀번호는 argon2id 해시로만 저장합니다. |
| 잠금 | 비밀번호 5회 연속 오류 시 잠김 → 관리자가 잠금 해제 또는 비밀번호 초기화. 같은 접속 주소에서 10분에 20회 넘게 틀리면 잠시 차단. |
| 로그인 유지 | `SESSION_HOURS`(기본 12시간). 비밀번호를 바꾸면 다른 기기의 로그인은 끊깁니다. |
| 전출·퇴직 | 삭제하지 않고 **비활성화**. 로그인 불가, 로그인 중이던 세션도 끊깁니다. 과거 기록에는 이름이 남습니다. 돌아오면 같은 계정을 다시 활성화합니다. |
| 로그인 화면 | 아이디 형식이나 초기 비밀번호 같은 계정 안내를 표시하지 않습니다. 오류 메시지도 아이디가 있는지 알 수 없게 같은 문구를 씁니다. |
| 감사 로그 | 로그인 성공·실패, 잠금, 비밀번호 변경·초기화, 활성·비활성, 관리자 지정, 명렬표 반영을 `auth_event` 에 기록합니다. 없는 아이디로 실패한 경우 입력한 아이디는 남기지 않습니다. |

## 명렬표로 계정 만들기

- 읽는 파일: 교직원 부서별 명렬표 `.hwpx`, 또는 엑셀에서 **CSV UTF-8** 로 저장한 파일.
- 표에서 `부서`(또는 소속)와 `담당자`(또는 성명·이름) 머리글 줄을 찾아 아래 줄을 읽습니다. `직책` 열이 있으면 함께 읽습니다. 한 표 안에 머리글이 여러 번 나와도(업무부서·학년부·행정실 묶음) 묶음마다 열 위치를 따로 찾습니다.
- `시간강사1`, `순회교사3` 처럼 숫자가 붙은 자리표시 칸은 건너뜁니다. 이름 뒤 괄호 메모(예: `(기간제)`)는 뺍니다.
- 부서는 공백을 뺀 이름으로 저장하고(`1학년`처럼 학년이면 학년부로 구분), 직책이 `부장`이면 부서장으로 표시합니다.
- 다시 올리면: 기존 계정과 이름으로 짝지어 부서·직책을 파일 내용으로 바꾸고, 새 사람만 계정을 만듭니다. 명단에 없는 계정은 **선택했을 때만** 비활성화합니다(관리자 계정은 제외).
- 같은 이름이 파일 안에 두 번 나오면 서로 다른 사람으로 보고 미리보기에 경고를 띄웁니다. 같은 사람이 두 부서에 적힌 경우라면 파일을 고쳐서 다시 올리세요.
- 명렬표 원본은 서버에 보관하지 않습니다. 관리자 화면 미리보기 내용만 반영 전까지(최대 하루) DB 에 잠시 남습니다.
- 명렬표 원본은 개인정보이므로 저장소에 커밋하지 않습니다(`data/` 폴더 사용, `.gitignore` 처리).

방법은 두 가지입니다.

1. **관리자 화면** `/admin/users` → 파일 선택 → 미리보기 → 반영하기
2. **서버 명령** (처음 설치 때, 관리자가 아직 없을 때)
   ```bash
   docker compose exec app npm run accounts -- import data/명렬표.hwpx            # 미리보기
   docker compose exec app npm run accounts -- import data/명렬표.hwpx --apply    # 반영
   docker compose exec app npm run accounts -- import data/명렬표.hwpx --apply --deactivate-missing
   docker compose exec app npm run accounts -- list
   docker compose exec app npm run accounts -- admin '#12'          # 12번 계정을 관리자로
   docker compose exec app npm run accounts -- reset-password '#12'
   docker compose exec app npm run accounts -- unlock '#12'
   docker compose exec app npm run accounts -- deactivate '#12'
   ```
   Windows PowerShell 처럼 한글 입력이 깨질 수 있는 터미널에서는 `list` 로 번호를 보고 `#번호` 로 지정하세요.

## 구조 (2단계 전환 대비)

```
lib/auth/
  config.ts       AUTH_PROVIDERS (local → google,local → google)
  local.ts        1단계: 아이디·비밀번호 확인 (잠금·감사 로그)
  (google.ts)     2단계: Google OIDC → email/google_sub 로 기존 app_user 찾기
  session.ts      공통 세션: 무작위 토큰 쿠키(httpOnly, SameSite=Lax, HTTPS 면 Secure) ↔ user_session(SHA-256 해시)
  current-user.ts requireUser / requireAdmin
  accounts.ts     초기화·잠금 해제·비활성화·관리자 지정 (화면과 CLI 공용)
lib/staff/        명렬표(hwpx/csv) 읽기와 계정 반영
proxy.ts          로그인 안 한 요청을 /login 으로
db/migrations/    0001_accounts_auth.sql (app_user, department, user_department, role, user_role, user_session, auth_event)
```

어떤 방식으로 로그인하든 마지막에 `createSession(userId, provider)` 하나로 끝나므로, 2단계에서는 `google.ts` 와 로그인 버튼만 추가하면 됩니다. 각 교사가 처음 Google 로 로그인할 때 기존 임시 계정에 연결(`email`, `google_sub`)하고, 전환이 끝나면 `AUTH_PROVIDERS=google` 로 비밀번호 로그인을 끕니다(비상용 로컬 관리자 1개만 유지).

## 1단계 보안상 한계

- `http` 라서 비밀번호가 교내망 안에서 암호화되지 않은 채 오갑니다. 교내망 전용으로만 쓰고 2단계 전환을 너무 늦추지 않습니다.
- 관리자 기능의 재인증(최근 로그인 확인)은 아직 없습니다.
- 마이그레이션은 앱 시작 때 자동 적용됩니다(`node scripts/migrate.ts`, 개발·운영 공통).
