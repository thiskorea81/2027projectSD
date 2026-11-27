import { requireUser } from "@/lib/auth/current-user";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password";
import { logoutAction } from "../login/actions";
import { ChangePasswordForm } from "./form";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const user = await requireUser({ allowPasswordChange: true });
  return (
    <main>
      <div className="card narrow">
        <h1>비밀번호 바꾸기</h1>
        {user.mustChangePassword && (
          <p className="muted">처음 로그인하셨습니다. 계속하려면 새 비밀번호를 정해 주세요.</p>
        )}
        <ChangePasswordForm minLength={PASSWORD_MIN_LENGTH} />
        <form action={logoutAction} style={{ marginTop: 12 }}>
          <button className="secondary full" type="submit">로그아웃</button>
        </form>
      </div>
    </main>
  );
}
