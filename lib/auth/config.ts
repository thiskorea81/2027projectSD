// 인증 설정. 로그인 방식(provider)을 바꿔도 세션·계정 구조는 그대로입니다.
//   AUTH_PROVIDERS=local         1단계: 교내망 IP 접속, 임시 계정(아이디·비밀번호)
//   AUTH_PROVIDERS=google,local  2단계 전환기: Google Workspace 로그인 + (비상용) 로컬 로그인
//   AUTH_PROVIDERS=google        2단계: Google 로그인만 (비상용 관리자 로컬 로그인은 별도 정책)
export type AuthProvider = "local" | "google";

export function enabledProviders(): AuthProvider[] {
  const raw = process.env.AUTH_PROVIDERS ?? "local";
  return raw.split(",").map((s) => s.trim()).filter((s): s is AuthProvider => s === "local" || s === "google");
}

export const SESSION_COOKIE = "sn_session";
export const SESSION_HOURS = Number(process.env.SESSION_HOURS ?? "12");
export const MAX_FAILED_LOGINS = 5;
