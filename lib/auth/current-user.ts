// 화면·서버 액션에서 로그인 사용자 확인
import { cache } from "react";
import { redirect } from "next/navigation";
import { readSession, type SessionUser } from "./session.ts";

export const getCurrentUser = cache(readSession);

// 로그인 필수 화면. 첫 로그인(초기 비밀번호)이면 비밀번호 변경 화면으로 보냅니다.
export async function requireUser(opts: { allowPasswordChange?: boolean } = {}): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword && !opts.allowPasswordChange) redirect("/change-password");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isAdmin) redirect("/");
  return user;
}
