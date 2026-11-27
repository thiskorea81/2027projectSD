-- 교직원 계정·부서·역할·세션 (1단계 임시 계정 로그인)
-- 설계: docs/auth.md, docs/db-design.md §4.1
-- 로그인 방식(비밀번호/Google)은 user_session.provider 로만 구분하고, 계정(app_user)은 공유합니다.
-- 2단계에서 Google 로그인을 켜면 기존 계정에 email/google_sub 를 연결하므로 데이터가 그대로 이어집니다.

CREATE TABLE department (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  kind        text NOT NULL DEFAULT 'admin' CHECK (kind IN ('admin', 'grade', 'subject', 'other')),
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_user (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- 1단계 아이디 = 한글 이름, 같은 이름이 있으면 등록 순서로 이름2, 이름3 … (만든 뒤 바꾸지 않음)
  login_id              text NOT NULL UNIQUE,
  name                  text NOT NULL,
  -- 로컬(비밀번호) 로그인용 argon2id 해시. 2단계에선 비상용 관리자만 남깁니다.
  password_hash         text,
  must_change_password  boolean NOT NULL DEFAULT true,
  password_changed_at   timestamptz,
  failed_login_count    smallint NOT NULL DEFAULT 0,
  locked_at             timestamptz,
  last_login_at         timestamptz,
  -- 2단계 Google Workspace 연결용
  email                 text UNIQUE,
  google_sub            text UNIQUE,
  phone                 text,
  -- 전출·퇴직 시 false (삭제하지 않음). 비활성 계정은 로그인 불가
  is_active             boolean NOT NULL DEFAULT true,
  deactivated_at        timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_user_name_idx ON app_user (name);

CREATE TABLE user_department (
  user_id         bigint NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  department_id   bigint NOT NULL REFERENCES department(id),
  position_title  text,          -- 명렬표의 직책 (부장, 1반담임, 주무관 …)
  is_head         boolean NOT NULL DEFAULT false,
  sort_order      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, department_id)
);

CREATE TABLE role (
  id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code  text NOT NULL UNIQUE,
  name  text NOT NULL
);
INSERT INTO role (code, name) VALUES
  ('sys_admin', '시스템 관리자'),
  ('approver', '승인 담당자'),
  ('timetable_admin', '시간표 담당자'),
  ('dept_staff', '부서 담당자'),
  ('teacher', '교사');

CREATE TABLE user_role (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id              bigint NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role_id              bigint NOT NULL REFERENCES role(id),
  scope_department_id  bigint REFERENCES department(id),
  scope_grade          smallint
);
CREATE UNIQUE INDEX user_role_unscoped_uq ON user_role (user_id, role_id)
  WHERE scope_department_id IS NULL AND scope_grade IS NULL;

-- 로그인 세션. 쿠키에는 무작위 토큰만, DB 에는 그 SHA-256 해시만 저장합니다.
CREATE TABLE user_session (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token_hash    bytea NOT NULL UNIQUE,
  user_id       bigint NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  provider      text NOT NULL,   -- 'local' (1단계), 'google' (2단계)
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  ip            text,
  user_agent    text
);
CREATE INDEX user_session_user_idx ON user_session (user_id);
CREATE INDEX user_session_expires_idx ON user_session (expires_at);

-- 계정 감사 로그 (로그인 성공/실패, 비밀번호 변경·초기화, 잠금, 활성/비활성, 명단 가져오기)
-- 없는 아이디로 실패한 경우에도 입력한 아이디는 남기지 않습니다.
CREATE TABLE auth_event (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id   bigint REFERENCES app_user(id) ON DELETE SET NULL,
  actor_id  bigint REFERENCES app_user(id) ON DELETE SET NULL,
  event     text NOT NULL,
  ip        text,
  detail    jsonb,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_event_user_idx ON auth_event (user_id, at DESC);

-- 관리자 화면의 명단 가져오기 미리보기 (적용하거나 하루가 지나면 지웁니다)
CREATE TABLE staff_import_batch (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_by  bigint REFERENCES app_user(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  rows        jsonb NOT NULL
);
