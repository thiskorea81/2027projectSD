// 계정 규칙 테스트 (실제 교직원 이름을 쓰지 않습니다)
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextLoginId, normalizeName } from "../lib/auth/login-id.ts";
import { cleanPersonName, parseRoster } from "../lib/staff/roster.ts";
import { planImport, type ExistingUser } from "../lib/staff/import.ts";

test("아이디: 같은 이름이면 등록 순서로 숫자를 붙인다", () => {
  const taken = new Set<string>();
  const ids = ["홍길동", "홍길동", "홍길동"].map((n) => {
    const id = nextLoginId(n, taken);
    taken.add(id);
    return id;
  });
  assert.deepEqual(ids, ["홍길동", "홍길동2", "홍길동3"]);
});

test("이름 정규화: 공백 제거, 자모 분리(NFD) 입력도 같은 아이디", () => {
  assert.equal(normalizeName(" 홍 길동 "), "홍길동");
  assert.equal(normalizeName("홍길동".normalize("NFD")), "홍길동");
});

test("자리표시 칸(시간강사1 등)은 사람 이름으로 보지 않는다", () => {
  assert.equal(cleanPersonName("시간강사1"), null);
  assert.equal(cleanPersonName("홍길동(기간제)"), "홍길동");
  assert.equal(cleanPersonName(""), null);
});

test("CSV 명렬표: 머리글을 찾아 부서·직책·이름을 읽는다", () => {
  const csv = "﻿번,부서,직책,성명\r\n1,교무 기획,부장,홍길동\r\n2,1학년,1반담임,\"김 철수\"\r\n3,강사,,시간강사1\r\n";
  const r = parseRoster(Buffer.from(csv), "list.csv");
  assert.equal(r.skippedPlaceholders, 1);
  assert.deepEqual(
    r.rows.map((x) => [x.name, x.department, x.position]),
    [["홍길동", "교무기획", "부장"], ["김철수", "1학년", "1반담임"]],
  );
});

const user = (id: number, login_id: string, name: string, is_active = true, is_admin = false): ExistingUser =>
  ({ id, login_id, name, is_active, is_admin });
const row = (order: number, name: string, department = "교무기획") => ({ order, name, department, position: null });

test("가져오기: 기존 계정은 이름으로 짝짓고, 새 동명이인은 다음 번호", () => {
  const plan = planImport(
    [row(1, "홍길동"), row(2, "홍길동"), row(3, "김철수")],
    [user(1, "홍길동", "홍길동"), user(2, "이영희", "이영희", true, true)],
  );
  assert.deepEqual(
    plan.items.map((i) => [i.action, i.loginId]),
    [["keep", "홍길동"], ["create", "홍길동2"], ["create", "김철수"]],
  );
  assert.deepEqual(plan.missing.map((m) => [m.loginId, m.isAdmin]), [["이영희", true]]);
  assert.deepEqual(plan.duplicateNamesInFile, ["홍길동"]);
});

test("가져오기: 전출 후 돌아온 교사는 비활성 계정을 다시 활성화, 아이디는 재사용하지 않음", () => {
  const plan = planImport([row(1, "홍길동")], [user(5, "홍길동", "홍길동", false)]);
  assert.deepEqual(plan.items[0], { action: "keep", row: row(1, "홍길동"), userId: 5, loginId: "홍길동", reactivate: true });

  // 비활성 '홍길동' 이 남아 있으면 새로 온 다른 홍길동 두 번째 사람은 홍길동2
  const plan2 = planImport([row(1, "홍길동"), row(2, "홍길동")], [user(5, "홍길동", "홍길동", false)]);
  assert.deepEqual(plan2.items.map((i) => i.loginId), ["홍길동", "홍길동2"]);
});
