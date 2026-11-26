import { pool } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/current-user";
import { loadExistingUsers, planImport } from "@/lib/staff/import";
import type { RosterRow } from "@/lib/staff/roster";
import { applyImportAction, cancelImportAction, previewImportAction, userAction } from "./actions";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, [string, boolean]> = {
  reset: ["비밀번호를 초기 비밀번호로 되돌렸습니다. 다음 로그인 때 새 비밀번호를 정하게 됩니다.", true],
  unlocked: ["잠금을 풀었습니다.", true],
  deactivated: ["비활성화했습니다. (전출·퇴직, 기록은 남습니다)", true],
  activated: ["다시 활성화했습니다.", true],
  admin_granted: ["관리자로 지정했습니다.", true],
  admin_revoked: ["관리자 지정을 해제했습니다.", true],
  imported: ["명렬표를 반영했습니다.", true],
  cancelled: ["가져오기를 취소했습니다.", true],
  self: ["자기 계정은 비활성화할 수 없습니다.", false],
  last_admin: ["자기 자신이나 마지막 관리자는 해제할 수 없습니다.", false],
  no_file: ["파일을 선택하세요.", false],
  parse_failed: ["명렬표를 읽지 못했습니다. 표에 '부서'와 '담당자(또는 성명)' 머리글이 있는 .hwpx 또는 .csv 인지 확인하세요.", false],
  batch_gone: ["미리보기가 만료되었습니다. 파일을 다시 올려 주세요.", false],
  no_initial_password: ["서버 설정(.env)에 INITIAL_PASSWORD 가 없습니다. 설정 후 다시 시작하세요.", false],
  bad: ["잘못된 요청입니다.", false],
};

type UserRow = {
  id: number;
  login_id: string;
  name: string;
  depts: string;
  is_active: boolean;
  locked: boolean;
  must_change_password: boolean;
  is_admin: boolean;
  last_login_at: Date | null;
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await requireAdmin();
  const sp = await searchParams;
  const msg = sp.msg ? MESSAGES[sp.msg] : undefined;

  const { rows: users } = await pool.query<UserRow>(`
    SELECT u.id::int, u.login_id, u.name, u.is_active, u.locked_at IS NOT NULL AS locked,
           u.must_change_password, u.last_login_at,
           EXISTS (SELECT 1 FROM user_role ur JOIN role r ON r.id = ur.role_id
                   WHERE ur.user_id = u.id AND r.code = 'sys_admin') AS is_admin,
           coalesce(string_agg(d.name || coalesce(' ' || ud.position_title, ''), ', ' ORDER BY ud.sort_order), '') AS depts
    FROM app_user u
    LEFT JOIN user_department ud ON ud.user_id = u.id
    LEFT JOIN department d ON d.id = ud.department_id
    GROUP BY u.id
    ORDER BY u.is_active DESC, min(ud.sort_order) NULLS LAST, u.id`);

  let preview: { batchId: number; rows: RosterRow[]; plan: ReturnType<typeof planImport> } | null = null;
  if (sp.batch) {
    const { rows } = await pool.query("SELECT rows FROM staff_import_batch WHERE id = $1", [Number(sp.batch)]);
    if (rows[0]) {
      const client = await pool.connect();
      try {
        preview = {
          batchId: Number(sp.batch),
          rows: rows[0].rows,
          plan: planImport(rows[0].rows, await loadExistingUsers(client)),
        };
      } finally {
        client.release();
      }
    }
  }

  return (
    <main>
      <div className="row">
        <h1>계정 관리</h1>
        <a href="/">← 처음으로</a>
      </div>
      {msg && (
        <p className={msg[1] ? "ok" : "error"} role="status">
          {msg[0]}
          {sp.msg === "imported" &&
            ` 새 계정 ${sp.c ?? 0} · 갱신 ${sp.u ?? 0} · 재활성 ${sp.r ?? 0} · 비활성 ${sp.d ?? 0}`}
        </p>
      )}

      {preview ? (
        <ImportPreview {...preview} />
      ) : (
        <div className="card">
          <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>명렬표로 계정 만들기·갱신</h2>
          <p className="muted">
            교직원 부서별 명렬표(.hwpx, 또는 엑셀에서 저장한 CSV UTF-8)를 올리면 미리보기를 보여 줍니다. 올린 파일은
            서버에 보관하지 않습니다. 새 계정의 아이디는 이름(같은 이름이 있으면 이름2, 이름3 …), 비밀번호는 서버에
            설정된 초기 비밀번호이며 첫 로그인 때 바꾸게 됩니다.
          </p>
          <form action={previewImportAction}>
            <input type="file" name="roster" accept=".hwpx,.csv" required />
            <button type="submit" style={{ marginTop: 12 }}>미리보기</button>
          </form>
        </div>
      )}

      <div className="card table-wrap">
        <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>
          계정 {users.filter((u) => u.is_active).length}명
          <span className="muted"> (비활성 {users.filter((u) => !u.is_active).length})</span>
        </h2>
        <table>
          <thead>
            <tr>
              <th>아이디</th>
              <th>부서·직책</th>
              <th>상태</th>
              <th>최근 로그인</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={u.is_active ? undefined : { opacity: 0.55 }}>
                <td>{u.login_id}</td>
                <td>{u.depts}</td>
                <td>
                  {u.is_admin && <span className="tag">관리자</span>}
                  {!u.is_active && <span className="tag warn">비활성</span>}
                  {u.locked && <span className="tag warn">잠김</span>}
                  {u.is_active && u.must_change_password && <span className="tag">첫 로그인 전</span>}
                </td>
                <td className="muted">
                  {u.last_login_at
                    ? new Date(u.last_login_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" })
                    : "-"}
                </td>
                <td className="actions">
                  {u.locked && <Op id={u.id} op="unlock" label="잠금 해제" />}
                  {u.is_active && <Op id={u.id} op="reset" label="비밀번호 초기화" />}
                  {u.is_active && u.id !== me.id && <Op id={u.id} op="deactivate" label="비활성화" danger />}
                  {!u.is_active && <Op id={u.id} op="activate" label="활성화" />}
                  {u.is_active && !u.is_admin && <Op id={u.id} op="grant_admin" label="관리자 지정" />}
                  {u.is_admin && u.id !== me.id && <Op id={u.id} op="revoke_admin" label="관리자 해제" />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function Op({ id, op, label, danger }: { id: number; op: string; label: string; danger?: boolean }) {
  return (
    <form action={userAction}>
      <input type="hidden" name="userId" value={id} />
      <input type="hidden" name="op" value={op} />
      <button type="submit" className={`small ${danger ? "danger" : "secondary"}`}>{label}</button>
    </form>
  );
}

function ImportPreview({
  batchId,
  rows,
  plan,
}: {
  batchId: number;
  rows: RosterRow[];
  plan: ReturnType<typeof planImport>;
}) {
  const creates = plan.items.filter((i) => i.action === "create");
  const keeps = plan.items.filter((i) => i.action === "keep");
  return (
    <div className="card">
      <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>가져오기 미리보기 ({rows.length}명)</h2>
      <p>
        새 계정 <b>{creates.length}</b> · 기존 계정 갱신 <b>{keeps.length}</b>
        {keeps.some((k) => k.action === "keep" && k.reactivate) && " (비활성 계정 재활성 포함)"} · 명단에 없는 활성 계정{" "}
        <b>{plan.missing.length}</b>
      </p>
      {plan.duplicateNamesInFile.length > 0 && (
        <p className="error">
          파일 안에 같은 이름이 여러 번 나옵니다: {plan.duplicateNamesInFile.join(", ")}. 서로 다른 사람으로 보고
          아이디에 숫자를 붙입니다. 같은 사람이 두 부서에 적힌 것이면 파일을 고친 뒤 다시 올려 주세요.
        </p>
      )}
      <div className="table-wrap" style={{ maxHeight: 360, overflowY: "auto" }}>
        <table>
          <thead>
            <tr><th>처리</th><th>아이디</th><th>부서</th><th>직책</th></tr>
          </thead>
          <tbody>
            {plan.items.map((i) => (
              <tr key={i.row.order}>
                <td>{i.action === "create" ? "새로 만듦" : i.reactivate ? "다시 활성화" : "갱신"}</td>
                <td>{i.loginId}{i.loginId !== i.row.name && <span className="tag warn">같은 이름</span>}</td>
                <td>{i.row.department}</td>
                <td>{i.row.position ?? ""}</td>
              </tr>
            ))}
            {plan.missing.map((m) => (
              <tr key={`m${m.userId}`} className="muted">
                <td>명단에 없음</td>
                <td>{m.loginId}</td>
                <td colSpan={2}>{m.isAdmin ? "관리자라 비활성화하지 않음" : "아래에서 선택하면 비활성화"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form action={applyImportAction} style={{ marginTop: 12 }}>
        <input type="hidden" name="batchId" value={batchId} />
        {plan.missing.length > 0 && (
          <label style={{ color: "inherit" }}>
            <input type="checkbox" name="deactivateMissing" /> 명단에 없는 계정 {plan.missing.length}개를 비활성화 (전출·퇴직)
          </label>
        )}
        <div className="row" style={{ justifyContent: "flex-start", marginTop: 8 }}>
          <button type="submit">반영하기</button>
        </div>
      </form>
      <form action={cancelImportAction} style={{ marginTop: 8 }}>
        <input type="hidden" name="batchId" value={batchId} />
        <button type="submit" className="secondary">취소</button>
      </form>
    </div>
  );
}
