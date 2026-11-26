// 교직원 계정 관리 (서버에서 실행). 관리자 화면을 쓸 수 없을 때(처음 설치, 관리자 잠김 등)에 씁니다.
//
//   docker compose exec app npm run accounts -- <명령> …
//
//   import <파일> [--apply] [--deactivate-missing]
//       명렬표(.hwpx/.csv)로 계정을 만들거나 부서를 갱신합니다. --apply 가 없으면 미리보기만.
//       파일 대신 '-' 를 주면 표준입력에서 읽습니다(이때 --format hwpx|csv 필요).
//         예) docker compose exec -T app npm run accounts -- import - --format hwpx --apply < 명렬표.hwpx
//   add <이름> [--login-id <아이디>] 한 명 추가 (아이디 생략 시 이름 규칙, 비밀번호는 INITIAL_PASSWORD)
//   set-password <아이디|#번호>     표준입력 한 줄을 새 비밀번호로 (변경 강제 없음, 잠금 해제)
//         예) echo 새비밀번호 | docker compose exec -T app npm run accounts -- set-password '#12'
//   list                         계정 목록 (번호·아이디·부서·상태)
//   admin <아이디|#번호> [--revoke] 시스템 관리자 지정/해제
//   reset-password <아이디|#번호>  비밀번호를 초기 비밀번호로 (다음 로그인 때 변경 강제)
//   unlock <아이디|#번호>          로그인 5회 실패 잠금 해제
//   deactivate <아이디|#번호>      전출·퇴직 처리 (삭제하지 않음)
//   activate <아이디|#번호>        다시 활성화
//
// 한글 아이디 입력이 어려운 터미널(Windows PowerShell 등)에서는 list 로 번호를 보고 #번호 로 지정하세요.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import pg from "pg";
import { parseRoster } from "../lib/staff/roster.ts";
import { applyImport, loadExistingUsers, planImport } from "../lib/staff/import.ts";
import {
  countActiveAdmins, deactivateUser, logEvent, reactivateUser, resetPassword, setAdmin, unlockUser,
} from "../lib/auth/accounts.ts";
import { nextLoginId, normalizeLoginId } from "../lib/auth/login-id.ts";
import { hashPassword, initialPassword, PASSWORD_MIN_LENGTH } from "../lib/auth/password.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const VALUE_OPTIONS = ["--format", "--login-id"];
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && VALUE_OPTIONS.includes(args[i - 1])));
const [command, target] = positional;

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function findUser(ref: string | undefined): Promise<{ id: number; login_id: string }> {
  if (!ref) throw new Error("대상 아이디(또는 #번호)를 적어 주세요.");
  const byId = ref.match(/^#?(\d+)$/);
  const { rows } = byId
    ? await db.query("SELECT id::int, login_id FROM app_user WHERE id = $1", [Number(byId[1])])
    : await db.query("SELECT id::int, login_id FROM app_user WHERE login_id = $1", [normalizeLoginId(ref)]);
  if (!rows[0]) throw new Error("그런 계정이 없습니다.");
  return rows[0];
}

async function main() {
  await db.connect();
  switch (command) {
    case "import": {
      if (!target) throw new Error("명렬표 파일 경로를 적어 주세요.");
      const name = target === "-" ? `stdin.${option("--format") ?? ""}` : basename(target);
      const buf = target === "-" ? await readStdin() : await readFile(target);
      const roster = parseRoster(buf, name);
      const deactivateMissing = flag("--deactivate-missing");
      if (!flag("--apply")) {
        const plan = planImport(roster.rows, await loadExistingUsers(db));
        const creates = plan.items.filter((i) => i.action === "create");
        console.log(`명렬표 ${roster.rows.length}명 (이름이 아닌 칸 ${roster.skippedPlaceholders}개 건너뜀)`);
        console.log(`- 새 계정: ${creates.length}명`);
        for (const c of creates.filter((c) => c.loginId !== c.row.name)) {
          console.log(`    같은 이름이 있어 아이디를 '${c.loginId}' 로 만듭니다 (${c.row.department})`);
        }
        console.log(`- 기존 계정 갱신: ${plan.items.length - creates.length}명`);
        console.log(`- 명단에 없는 활성 계정: ${plan.missing.length}명` +
          (deactivateMissing ? " → 비활성화 (관리자 제외)" : " (그대로 둠, --deactivate-missing 으로 비활성화)"));
        if (plan.duplicateNamesInFile.length) {
          console.log(`! 파일 안에 같은 이름이 여러 번 나옵니다: ${plan.duplicateNamesInFile.join(", ")} — 서로 다른 사람으로 처리합니다.`);
        }
        console.log("\n미리보기입니다. 반영하려면 --apply 를 붙여 다시 실행하세요.");
        return;
      }
      const { summary } = await applyImport(db, roster.rows, { deactivateMissing, actorId: null });
      console.log(
        `반영 완료: 새 계정 ${summary.created}, 갱신 ${summary.updated}, 재활성 ${summary.reactivated}, ` +
          `비활성 ${summary.deactivated}` + (summary.keptAdmins ? `, 관리자라 유지 ${summary.keptAdmins}` : ""),
      );
      return;
    }
    case "add": {
      const name = target ? normalizeLoginId(target) : "";
      if (!name) throw new Error("이름을 적어 주세요.");
      const taken = new Set((await db.query("SELECT login_id FROM app_user")).rows.map((r) => r.login_id as string));
      const requested = option("--login-id");
      const loginId = requested ? normalizeLoginId(requested) : nextLoginId(name, taken);
      if (taken.has(loginId)) throw new Error("이미 있는 아이디입니다.");
      const { rows } = await db.query(
        `INSERT INTO app_user (login_id, name, password_hash, must_change_password) VALUES ($1, $2, $3, true) RETURNING id::int`,
        [loginId, name, await hashPassword(initialPassword())],
      );
      await db.query(
        `INSERT INTO user_role (user_id, role_id) SELECT $1, id FROM role WHERE code = 'teacher' ON CONFLICT DO NOTHING`,
        [rows[0].id],
      );
      await logEvent(db, rows[0].id, null, "account_created", { source: "cli" });
      console.log(`#${rows[0].id} 계정을 만들었습니다 (초기 비밀번호, 첫 로그인 때 변경).`);
      return;
    }
    case "set-password": {
      const u = await findUser(target);
      // Windows PowerShell 은 파이프 입력 앞에 BOM 을 붙이므로 지웁니다
      const password = (await readStdin()).toString("utf8").replace(/^\uFEFF/, "").replace(/\r?\n$/, "");
      if (!password) throw new Error("표준입력으로 새 비밀번호를 주세요.");
      if (password.length < PASSWORD_MIN_LENGTH) console.log(`주의: ${PASSWORD_MIN_LENGTH}자보다 짧은 비밀번호입니다(테스트용으로만 쓰세요).`);
      await db.query(
        `UPDATE app_user SET password_hash = $2, must_change_password = false, password_changed_at = now(),
           failed_login_count = 0, locked_at = NULL, updated_at = now() WHERE id = $1`,
        [u.id, await hashPassword(password)],
      );
      await logEvent(db, u.id, null, "password_set", { source: "cli" });
      console.log(`#${u.id} 비밀번호를 설정했습니다.`);
      return;
    }
    case "list": {
      const { rows } = await db.query(`
        SELECT u.id, u.login_id, u.is_active, u.locked_at IS NOT NULL AS locked, u.must_change_password,
          EXISTS (SELECT 1 FROM user_role ur JOIN role r ON r.id = ur.role_id
                  WHERE ur.user_id = u.id AND r.code = 'sys_admin') AS admin,
          coalesce(string_agg(d.name || coalesce(' ' || ud.position_title, ''), ', ' ORDER BY ud.sort_order), '') AS depts
        FROM app_user u
        LEFT JOIN user_department ud ON ud.user_id = u.id LEFT JOIN department d ON d.id = ud.department_id
        GROUP BY u.id ORDER BY u.id`);
      for (const r of rows) {
        const flags = [r.admin && "관리자", !r.is_active && "비활성", r.locked && "잠김", r.must_change_password && "초기비번"]
          .filter(Boolean).join(",");
        console.log(`#${r.id}\t${r.login_id}\t${r.depts}\t${flags}`);
      }
      return;
    }
    case "admin": {
      const u = await findUser(target);
      if (flag("--revoke") && (await countActiveAdmins(db)) <= 1) throw new Error("마지막 관리자는 해제할 수 없습니다.");
      await setAdmin(db, u.id, !flag("--revoke"), null);
      console.log(`#${u.id} ${flag("--revoke") ? "관리자 해제" : "관리자 지정"} 완료`);
      return;
    }
    case "reset-password": {
      const u = await findUser(target);
      await resetPassword(db, u.id, null);
      console.log(`#${u.id} 비밀번호를 초기 비밀번호로 되돌렸습니다 (다음 로그인 때 변경).`);
      return;
    }
    case "unlock": {
      const u = await findUser(target);
      await unlockUser(db, u.id, null);
      console.log(`#${u.id} 잠금 해제`);
      return;
    }
    case "deactivate": {
      const u = await findUser(target);
      await deactivateUser(db, u.id, null, "cli");
      console.log(`#${u.id} 비활성화`);
      return;
    }
    case "activate": {
      const u = await findUser(target);
      await reactivateUser(db, u.id, null);
      console.log(`#${u.id} 활성화`);
      return;
    }
    default:
      console.log("사용법은 scripts/accounts.ts 맨 위 설명을 보세요. 명령: import, add, set-password, list, admin, reset-password, unlock, deactivate, activate");
      process.exitCode = command ? 1 : 0;
  }
}

main()
  .catch((err) => {
    console.error(`오류: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(() => db.end());
