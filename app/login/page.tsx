import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

// 계정 형식·초기 비밀번호 같은 안내는 이 화면에 표시하지 않습니다.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const { next } = await searchParams;
  return (
    <main>
      <div className="card narrow">
        <h1>학교 알림</h1>
        <LoginForm next={next ?? "/"} />
        <p className="muted" style={{ marginTop: 16 }}>
          로그인이 안 되면 관리자에게 문의하세요.
        </p>
      </div>
    </main>
  );
}
