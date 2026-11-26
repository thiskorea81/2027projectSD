import { requireUser } from "@/lib/auth/current-user";
import { logoutAction } from "./login/actions";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  return (
    <main>
      <div className="row">
        <h1>학교 알림</h1>
        <form action={logoutAction}>
          <span className="muted" style={{ marginRight: 8 }}>{user.name} 선생님</span>
          <button className="secondary small" type="submit">로그아웃</button>
        </form>
      </div>
      <div className="card">
        <p>로그인되었습니다. 안내·할 일 기능은 준비 중입니다.</p>
        <p>
          <a href="/change-password">비밀번호 바꾸기</a>
          {user.isAdmin && (
            <>
              {" · "}
              <a href="/admin/users">계정 관리</a>
            </>
          )}
        </p>
      </div>
    </main>
  );
}
