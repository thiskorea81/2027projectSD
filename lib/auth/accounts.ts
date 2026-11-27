// 계정 관리 동작 (관리자 화면과 CLI 가 함께 씁니다). 모든 변경은 auth_event 에 남깁니다.
import type { ClientBase } from "pg";
import { hashPassword, initialPassword } from "./password.ts";

type Db = Pick<ClientBase, "query">;

export async function logEvent(
  db: Db,
  userId: number | null,
  actorId: number | null | undefined,
  event: string,
  detail?: Record<string, unknown>,
  ip?: string | null,
) {
  await db.query(
    `INSERT INTO auth_event (user_id, actor_id, event, ip, detail) VALUES ($1, $2, $3, $4, $5)`,
    [userId, actorId ?? null, event, ip ?? null, detail ? JSON.stringify(detail) : null],
  );
}

// 전출·퇴직: 삭제하지 않고 비활성화. 로그인 중인 세션도 끊습니다.
export async function deactivateUser(db: Db, userId: number, actorId: number | null, source: string) {
  await db.query(
    `UPDATE app_user SET is_active = false, deactivated_at = now(), updated_at = now() WHERE id = $1`,
    [userId],
  );
  await db.query("DELETE FROM user_session WHERE user_id = $1", [userId]);
  await logEvent(db, userId, actorId, "account_deactivated", { source });
}

export async function reactivateUser(db: Db, userId: number, actorId: number | null) {
  await db.query(
    `UPDATE app_user SET is_active = true, deactivated_at = NULL, updated_at = now() WHERE id = $1`,
    [userId],
  );
  await logEvent(db, userId, actorId, "account_reactivated", { source: "admin" });
}

// 비밀번호를 초기 비밀번호로 되돌리고 잠금도 풉니다. 다음 로그인 때 변경을 강제합니다.
export async function resetPassword(db: Db, userId: number, actorId: number | null) {
  await db.query(
    `UPDATE app_user SET password_hash = $2, must_change_password = true, failed_login_count = 0,
       locked_at = NULL, updated_at = now() WHERE id = $1`,
    [userId, await hashPassword(initialPassword())],
  );
  await db.query("DELETE FROM user_session WHERE user_id = $1", [userId]);
  await logEvent(db, userId, actorId, "password_reset");
}

export async function unlockUser(db: Db, userId: number, actorId: number | null) {
  await db.query(
    `UPDATE app_user SET failed_login_count = 0, locked_at = NULL, updated_at = now() WHERE id = $1`,
    [userId],
  );
  await logEvent(db, userId, actorId, "account_unlocked");
}

export async function setAdmin(db: Db, userId: number, isAdmin: boolean, actorId: number | null) {
  if (isAdmin) {
    await db.query(
      `INSERT INTO user_role (user_id, role_id) SELECT $1, id FROM role WHERE code = 'sys_admin'
       ON CONFLICT DO NOTHING`,
      [userId],
    );
  } else {
    await db.query(
      `DELETE FROM user_role WHERE user_id = $1 AND scope_department_id IS NULL AND scope_grade IS NULL
         AND role_id = (SELECT id FROM role WHERE code = 'sys_admin')`,
      [userId],
    );
  }
  await logEvent(db, userId, actorId, isAdmin ? "admin_granted" : "admin_revoked");
}

export async function countActiveAdmins(db: Db): Promise<number> {
  const { rows } = await db.query(`
    SELECT count(DISTINCT u.id)::int AS n FROM app_user u
    JOIN user_role ur ON ur.user_id = u.id JOIN role r ON r.id = ur.role_id
    WHERE r.code = 'sys_admin' AND u.is_active`);
  return rows[0].n;
}
