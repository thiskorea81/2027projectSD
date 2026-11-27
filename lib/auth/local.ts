// 1단계 로그인 방식: 아이디(이름) + 비밀번호
// 2단계 Google 로그인은 lib/auth/google.ts 로 추가하고, 성공 시 같은 createSession 을 부르면 됩니다.
import { pool } from "../db.ts";
import { logEvent } from "./accounts.ts";
import { MAX_FAILED_LOGINS } from "./config.ts";
import { normalizeLoginId } from "./login-id.ts";
import { burnVerifyTime, verifyPassword } from "./password.ts";

export type LocalLoginResult =
  | { ok: true; userId: number }
  | { ok: false; reason: "invalid" | "locked" };

export async function authenticateLocal(rawLoginId: string, password: string, ip: string | null): Promise<LocalLoginResult> {
  const loginId = normalizeLoginId(rawLoginId);
  const { rows } = await pool.query(
    `SELECT id::int, password_hash, is_active, locked_at IS NOT NULL AS locked FROM app_user WHERE login_id = $1`,
    [loginId],
  );
  const user = rows[0];
  if (!user || !user.is_active) {
    await burnVerifyTime(password);
    await logEvent(pool, user?.id ?? null, null, user ? "login_failed_inactive" : "login_failed_unknown", undefined, ip);
    return { ok: false, reason: "invalid" };
  }
  if (user.locked) {
    await burnVerifyTime(password);
    await logEvent(pool, user.id, null, "login_failed_locked", undefined, ip);
    return { ok: false, reason: "locked" };
  }
  if (!(await verifyPassword(user.password_hash, password))) {
    const { rows: upd } = await pool.query(
      `UPDATE app_user SET failed_login_count = failed_login_count + 1,
         locked_at = CASE WHEN failed_login_count + 1 >= $2 THEN now() ELSE locked_at END
       WHERE id = $1 RETURNING locked_at IS NOT NULL AS locked`,
      [user.id, MAX_FAILED_LOGINS],
    );
    await logEvent(pool, user.id, null, upd[0].locked ? "account_locked" : "login_failed", undefined, ip);
    return { ok: false, reason: upd[0].locked ? "locked" : "invalid" };
  }
  await pool.query(
    `UPDATE app_user SET failed_login_count = 0, last_login_at = now() WHERE id = $1`,
    [user.id],
  );
  await logEvent(pool, user.id, null, "login", { provider: "local" }, ip);
  return { ok: true, userId: user.id };
}
