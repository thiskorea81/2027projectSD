"use server";

import { redirect } from "next/navigation";
import { pool } from "@/lib/db";
import { logEvent } from "@/lib/auth/accounts";
import { getCurrentUser } from "@/lib/auth/current-user";
import { checkNewPassword, hashPassword, verifyPassword } from "@/lib/auth/password";
import { requestInfo } from "@/lib/auth/session";

export type ChangeState = { error?: string };

export async function changePasswordAction(_prev: ChangeState, form: FormData): Promise<ChangeState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  const confirm = String(form.get("confirm") ?? "");

  const { rows } = await pool.query("SELECT password_hash FROM app_user WHERE id = $1", [user.id]);
  if (!(await verifyPassword(rows[0]?.password_hash ?? null, current))) {
    return { error: "현재 비밀번호가 올바르지 않습니다." };
  }
  if (next !== confirm) return { error: "새 비밀번호 확인이 일치하지 않습니다." };
  const problem = checkNewPassword(next, current);
  if (problem) return { error: problem };

  await pool.query(
    `UPDATE app_user SET password_hash = $2, must_change_password = false, password_changed_at = now(),
       updated_at = now() WHERE id = $1`,
    [user.id, await hashPassword(next)],
  );
  // 다른 기기에 남은 로그인은 끊고, 지금 세션만 유지
  await pool.query("DELETE FROM user_session WHERE user_id = $1 AND id <> $2", [user.id, user.sessionId]);
  await logEvent(pool, user.id, user.id, "password_changed", undefined, (await requestInfo()).ip);
  redirect("/");
}
