"use server";

import { redirect } from "next/navigation";
import { enabledProviders } from "@/lib/auth/config";
import { authenticateLocal } from "@/lib/auth/local";
import { isIpBlocked, recordIpFailure } from "@/lib/auth/rate-limit";
import { createSession, destroySession, requestInfo } from "@/lib/auth/session";

export type LoginState = { error?: string; loginId?: string };

// 로그인 뒤 돌아갈 주소는 이 사이트 안 경로만 허용 (외부 주소로 튕기는 것 방지)
function safeNext(raw: FormDataEntryValue | null): string {
  const next = typeof raw === "string" ? raw : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  if (!enabledProviders().includes("local")) return { error: "이 로그인 방식은 사용하지 않습니다." };
  const loginId = String(form.get("loginId") ?? "");
  const password = String(form.get("password") ?? "");
  if (!loginId.trim() || !password) return { error: "아이디와 비밀번호를 입력하세요." };

  const { ip } = await requestInfo();
  if (isIpBlocked(ip)) return { loginId, error: "로그인 시도가 너무 많습니다. 10분 뒤에 다시 시도하세요." };

  const result = await authenticateLocal(loginId, password, ip);
  if (!result.ok) {
    recordIpFailure(ip);
    return {
      loginId,
      error:
        result.reason === "locked"
          ? "비밀번호를 여러 번 틀려 잠겼습니다. 관리자에게 잠금 해제를 요청하세요."
          : "아이디 또는 비밀번호가 올바르지 않습니다.",
    };
  }
  await createSession(result.userId, "local");
  redirect(safeNext(form.get("next")));
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
