// 명렬표 → 계정 반영 (CLI 와 관리자 화면이 함께 씁니다)
//
// 규칙
// - 아이디 = 이름. 같은 이름이 이미 있으면(비활성 계정 포함) 등록 순서로 이름2, 이름3 …
// - 이미 있는 계정과는 이름으로 맞춥니다. 같은 이름이 여럿이면 먼저 만든 계정부터 파일 순서대로 짝짓습니다.
//   (전출했다 돌아온 교사는 비활성 계정을 다시 활성화)
// - 파일에 있는 사람의 부서·직책은 파일 내용으로 바꿉니다.
// - 파일에 없는 활성 계정은 deactivateMissing 일 때만 비활성화합니다(삭제하지 않음). 시스템 관리자는 제외.
// - 새 계정의 비밀번호는 INITIAL_PASSWORD, 첫 로그인 때 변경을 강제합니다.
import type { ClientBase } from "pg";
import { hashPassword, initialPassword } from "../auth/password.ts";
import { nextLoginId } from "../auth/login-id.ts";
import { deactivateUser, logEvent } from "../auth/accounts.ts";
import type { RosterRow } from "./roster.ts";

export type ExistingUser = {
  id: number;
  login_id: string;
  name: string;
  is_active: boolean;
  is_admin: boolean;
};

export type PlanItem =
  | { action: "create"; row: RosterRow; loginId: string }
  | { action: "keep"; row: RosterRow; userId: number; loginId: string; reactivate: boolean };

export type ImportPlan = {
  items: PlanItem[];
  missing: { userId: number; loginId: string; name: string; isAdmin: boolean }[];
  duplicateNamesInFile: string[];
};

export function planImport(rows: RosterRow[], existing: ExistingUser[]): ImportPlan {
  const taken = new Set(existing.map((u) => u.login_id));
  // 활성 계정 먼저, 그다음 먼저 만든 순서
  const byName = new Map<string, ExistingUser[]>();
  for (const u of [...existing].sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.id - b.id)) {
    if (!byName.has(u.name)) byName.set(u.name, []);
    byName.get(u.name)!.push(u);
  }
  const matched = new Set<number>();
  const counts = new Map<string, number>();
  const items: PlanItem[] = [];
  for (const row of [...rows].sort((a, b) => a.order - b.order)) {
    counts.set(row.name, (counts.get(row.name) ?? 0) + 1);
    const candidate = byName.get(row.name)?.find((u) => !matched.has(u.id));
    if (candidate) {
      matched.add(candidate.id);
      items.push({ action: "keep", row, userId: candidate.id, loginId: candidate.login_id, reactivate: !candidate.is_active });
    } else {
      const loginId = nextLoginId(row.name, taken);
      taken.add(loginId);
      items.push({ action: "create", row, loginId });
    }
  }
  const missing = existing
    .filter((u) => u.is_active && !matched.has(u.id))
    .map((u) => ({ userId: u.id, loginId: u.login_id, name: u.name, isAdmin: u.is_admin }));
  const duplicateNamesInFile = [...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name);
  return { items, missing, duplicateNamesInFile };
}

export async function loadExistingUsers(db: ClientBase): Promise<ExistingUser[]> {
  const { rows } = await db.query(`
    SELECT u.id::int AS id, u.login_id, u.name, u.is_active,
           EXISTS (SELECT 1 FROM user_role ur JOIN role r ON r.id = ur.role_id
                   WHERE ur.user_id = u.id AND r.code = 'sys_admin') AS is_admin
    FROM app_user u ORDER BY u.id`);
  return rows;
}

export type ImportSummary = {
  created: number;
  updated: number;
  reactivated: number;
  deactivated: number;
  keptAdmins: number; // 명단에 없지만 관리자라 비활성화하지 않은 계정
};

export async function applyImport(
  db: ClientBase,
  rows: RosterRow[],
  opts: { deactivateMissing: boolean; actorId?: number | null },
): Promise<{ plan: ImportPlan; summary: ImportSummary }> {
  const password = initialPassword(); // 설정이 없으면 여기서 멈춥니다
  await db.query("BEGIN");
  try {
    // 동시에 두 번 가져오기를 막습니다
    await db.query("LOCK TABLE app_user IN SHARE ROW EXCLUSIVE MODE");
    const plan = planImport(rows, await loadExistingUsers(db));
    const summary: ImportSummary = { created: 0, updated: 0, reactivated: 0, deactivated: 0, keptAdmins: 0 };

    const deptIds = new Map<string, number>();
    const deptNames = [...new Set(rows.map((r) => r.department).filter(Boolean))];
    for (const [i, name] of deptNames.entries()) {
      const kind = /^\d+학년$/.test(name) ? "grade" : "admin";
      const { rows: d } = await db.query(
        `INSERT INTO department (name, kind, sort_order) VALUES ($1, $2, $3)
         ON CONFLICT (name) DO UPDATE SET sort_order = EXCLUDED.sort_order, is_active = true
         RETURNING id::int`,
        [name, kind, i + 1],
      );
      deptIds.set(name, d[0].id);
    }

    for (const item of plan.items) {
      let userId: number;
      if (item.action === "create") {
        const { rows: u } = await db.query(
          `INSERT INTO app_user (login_id, name, password_hash, must_change_password)
           VALUES ($1, $2, $3, true) RETURNING id::int`,
          [item.loginId, item.row.name, await hashPassword(password)],
        );
        userId = u[0].id;
        await db.query(
          `INSERT INTO user_role (user_id, role_id) SELECT $1, id FROM role WHERE code = 'teacher'
           ON CONFLICT DO NOTHING`,
          [userId],
        );
        await logEvent(db, userId, opts.actorId, "account_created", { source: "roster_import" });
        summary.created++;
      } else {
        userId = item.userId;
        if (item.reactivate) {
          await db.query(
            `UPDATE app_user SET is_active = true, deactivated_at = NULL, updated_at = now() WHERE id = $1`,
            [userId],
          );
          await logEvent(db, userId, opts.actorId, "account_reactivated", { source: "roster_import" });
          summary.reactivated++;
        } else summary.updated++;
        await db.query("DELETE FROM user_department WHERE user_id = $1", [userId]);
      }
      const deptId = deptIds.get(item.row.department);
      if (deptId) {
        await db.query(
          `INSERT INTO user_department (user_id, department_id, position_title, is_head, sort_order)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, department_id) DO UPDATE
           SET position_title = EXCLUDED.position_title, is_head = EXCLUDED.is_head, sort_order = EXCLUDED.sort_order`,
          [userId, deptId, item.row.position, item.row.position === "부장", item.row.order],
        );
      }
    }

    if (opts.deactivateMissing) {
      for (const m of plan.missing) {
        if (m.isAdmin) {
          summary.keptAdmins++;
          continue;
        }
        await deactivateUser(db, m.userId, opts.actorId ?? null, "roster_import");
        summary.deactivated++;
      }
    }
    await logEvent(db, null, opts.actorId, "roster_imported", { ...summary });
    await db.query("COMMIT");
    return { plan, summary };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}
