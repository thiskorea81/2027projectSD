// 로그인 세션 (쿠키 ↔ user_session). 어떤 방식으로 로그인했든 createSession 으로 끝납니다.
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { pool } from "../db.ts";
import { SESSION_COOKIE, SESSION_HOURS, type AuthProvider } from "./config.ts";

const tokenHash = (token: string) => createHash("sha256").update(token).digest();

export async function requestInfo() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || null;
  return { ip, userAgent: h.get("user-agent")?.slice(0, 300) ?? null, https: h.get("x-forwarded-proto") === "https" };
}

export async function createSession(userId: number, provider: AuthProvider) {
  const token = randomBytes(32).toString("base64url");
  const { ip, userAgent, https } = await requestInfo();
  await pool.query(
    `INSERT INTO user_session (token_hash, user_id, provider, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, now() + make_interval(hours => $4), $5, $6)`,
    [tokenHash(token), userId, provider, SESSION_HOURS, ip, userAgent],
  );
  // 오래된 세션 정리 (가끔만)
  if (Math.random() < 0.05) await pool.query("DELETE FROM user_session WHERE expires_at < now()");
  const secureSetting = process.env.COOKIE_SECURE ?? "auto";
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: secureSetting === "true" || (secureSetting === "auto" && https),
    maxAge: SESSION_HOURS * 3600,
  });
}

export type SessionUser = {
  id: number;
  loginId: string;
  name: string;
  mustChangePassword: boolean;
  isAdmin: boolean;
  sessionId: number;
};

export async function readSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT s.id::int AS session_id, u.id::int AS id, u.login_id, u.name, u.must_change_password,
            EXISTS (SELECT 1 FROM user_role ur JOIN role r ON r.id = ur.role_id
                    WHERE ur.user_id = u.id AND r.code = 'sys_admin') AS is_admin,
            s.last_seen_at < now() - interval '5 minutes' AS stale
     FROM user_session s JOIN app_user u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active`,
    [tokenHash(token)],
  );
  const r = rows[0];
  if (!r) return null;
  if (r.stale) await pool.query("UPDATE user_session SET last_seen_at = now() WHERE id = $1", [r.session_id]);
  return {
    id: r.id,
    loginId: r.login_id,
    name: r.name,
    mustChangePassword: r.must_change_password,
    isAdmin: r.is_admin,
    sessionId: r.session_id,
  };
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await pool.query("DELETE FROM user_session WHERE token_hash = $1", [tokenHash(token)]);
  jar.delete(SESSION_COOKIE);
}
