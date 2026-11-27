// 로그인하지 않은 요청은 로그인 화면으로 보냅니다.
// 여기서는 쿠키가 있는지만 보고, 세션이 유효한지는 각 화면의 requireUser() 가 DB 로 확인합니다.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/config";

export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = {
  // 로그인 화면, 상태 확인 API, 정적 파일은 제외
  matcher: ["/((?!login|api/health|_next/static|_next/image|favicon.ico).*)"],
};
